/*
 * Collection listing, collections index, search page and predictive search
 * (collection/search task). Ported from app/components/collection/*,
 * PaginatedResourceSection.tsx, SearchForm.tsx, SearchFormPredictive.tsx and
 * SearchResultsPredictive.tsx.
 *
 * - Filters, sorting, chips: fetch the section through the Section Rendering
 *   API, swap `.collection-layout`, keep the URL in sync (pushState).
 * - "Load more" / "Load previous": fetch the next page, append/prepend the
 *   cards, replace the nav, replaceState.
 * - Mobile filter sheet: modal dialog (inert page, focus trap, Escape).
 * - Predictive search: ARIA combobox in the search drawer; debounced fetch of
 *   sections/predictive-search (products, collections, query suggestions)
 *   into the drawer's [data-ps-live] panel.
 */
(function () {
  'use strict';

  if (window.theme && window.theme.collectionInit) return;
  window.theme = window.theme || {};
  window.theme.collectionInit = true;

  var DESKTOP_MEDIA_QUERY = '(min-width: 64em)';
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  var NON_RENDERED = {SCRIPT: 1, STYLE: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1};
  var SEARCH_UNAVAILABLE = 'Search is unavailable right now. Please try again.';
  var PREDICTIVE_LIMIT = 6;
  var PREDICTIVE_DEBOUNCE = 200;
  var PREDICTIVE_FIELDS = 'title,product_type,variants.title,vendor,tag';

  /* ---------- helpers ---------- */

  function routes() {
    return (window.theme && window.theme.routes) || {};
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('en-US').format(n);
  }

  function toUrl(href) {
    return new URL(href, window.location.origin);
  }

  function stripSectionParam(href) {
    var url = toUrl(href);
    url.searchParams.delete('section_id');
    url.searchParams.delete('sections');
    return url.pathname + url.search;
  }

  function fetchSection(href, sectionId) {
    var url = toUrl(href);
    url.searchParams.set('section_id', sectionId);
    return fetch(url.toString(), {
      headers: {Accept: 'text/html'},
      credentials: 'same-origin',
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (html) {
        return new DOMParser().parseFromString(html, 'text/html');
      });
  }

  function skeletonCard() {
    var card = document.createElement('div');
    card.className = 'skeleton-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML =
      '<div class="skeleton skeleton--media"></div>' +
      '<div class="skeleton skeleton--line" style="width:38%"></div>' +
      '<div class="skeleton skeleton--line" style="width:72%"></div>' +
      '<div class="skeleton skeleton--line" style="width:92%"></div>' +
      '<div class="skeleton skeleton--line skeleton--button"></div>';
    return card;
  }

  function getFocusable(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll(FOCUSABLE),
      function (element) {
        return element.offsetParent !== null || element === document.activeElement;
      },
    );
  }

  /** Everything outside `dialog`'s own branch of the document (useModalDialog.ts). */
  function getElementsOutside(dialog) {
    var outside = [];
    var node = dialog;
    while (node !== document.body && node.parentElement) {
      var siblings = node.parentElement.children;
      for (var i = 0; i < siblings.length; i += 1) {
        var sibling = siblings[i];
        if (sibling !== node && !NON_RENDERED[sibling.tagName]) {
          outside.push(sibling);
        }
      }
      node = node.parentElement;
    }
    return outside;
  }

  function focusElement(element) {
    if (!element) return;
    try {
      element.focus({preventScroll: true});
    } catch (error) {
      element.focus();
    }
  }

  function closeDrawer() {
    var theme = window.theme;
    if (theme && theme.drawer && typeof theme.drawer.close === 'function') {
      theme.drawer.close();
      return;
    }
    var overlay = document.querySelector('.overlay[data-drawer="search"]');
    if (overlay) {
      overlay.classList.remove('expanded');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  /* ---------- Load more / load previous (PaginatedResourceSection.tsx) ---------- */

  function regionOf(section) {
    return section ? section.querySelector(':scope > [role="region"]') : null;
  }

  function updateCount(sectionRoot, region, hasNextPage) {
    var count = sectionRoot.querySelector('.collection-toolbar__count');
    // A count of the whole (filtered) collection does not change per page.
    if (!count || count.hasAttribute('data-count-static')) return;
    var n = region.children.length;
    var noun = n === 1 && !hasNextPage ? ' product' : ' products';
    count.textContent = formatNumber(n) + (hasNextPage ? '+' : '') + noun;
  }

  function loadPage(link) {
    if (link.getAttribute('aria-disabled') === 'true') return;
    var sectionRoot = link.closest('[data-section-id]');
    var section = link.closest('.paginated-section');
    var region = regionOf(section);
    if (!sectionRoot || !section || !region) {
      window.location.href = link.href;
      return;
    }
    var sectionId = sectionRoot.getAttribute('data-section-id');
    var direction = link.getAttribute('data-load-more') === 'previous' ? 'previous' : 'next';
    var href = link.getAttribute('href');
    var countBefore = region.children.length;
    var nav = link.closest('.paginated-section__nav');
    var label = link.querySelector('.btn__label');
    var labelText = label ? label.textContent : '';

    link.classList.add('is-loading');
    link.setAttribute('aria-disabled', 'true');
    var spinner = document.createElement('span');
    spinner.className = 'btn__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    link.insertBefore(spinner, link.firstChild);
    if (label) label.textContent = 'Loading…';

    var skeletons = [];
    region.setAttribute('aria-busy', 'true');
    for (var i = 0; i < 3; i += 1) {
      var skeleton = skeletonCard();
      skeletons.push(skeleton);
      if (direction === 'next') region.appendChild(skeleton);
      else region.insertBefore(skeleton, region.firstChild);
    }

    function restore() {
      skeletons.forEach(function (node) {
        node.remove();
      });
      region.removeAttribute('aria-busy');
      spinner.remove();
      link.classList.remove('is-loading');
      link.removeAttribute('aria-disabled');
      if (label) label.textContent = labelText;
    }

    fetchSection(href, sectionId)
      .then(function (doc) {
        var newSection = doc.querySelector('.paginated-section');
        var newRegion = regionOf(newSection);
        if (!newRegion) {
          window.location.href = stripSectionParam(href);
          return;
        }
        skeletons.forEach(function (node) {
          node.remove();
        });
        var items = Array.prototype.slice.call(newRegion.children);
        if (direction === 'next') {
          items.forEach(function (item) {
            region.appendChild(item);
          });
        } else {
          var first = region.firstChild;
          items.forEach(function (item) {
            region.insertBefore(item, first);
          });
        }
        var newNav = newSection.querySelector(
          ':scope > .paginated-section__nav--' + direction,
        );
        if (newNav) nav.replaceWith(newNav);
        else nav.remove();
        region.removeAttribute('aria-busy');
        window.history.replaceState(window.history.state, '', stripSectionParam(href));
        updateCount(
          sectionRoot,
          region,
          Boolean(newSection.querySelector(':scope > .paginated-section__nav--next')),
        );
        // The clicked link unmounted (no further page): hand focus to the first
        // newly loaded resource instead of dropping it on <body>.
        var active = document.activeElement;
        if (!active || active === document.body) {
          var target = region.children[direction === 'next' ? countBefore : 0];
          var focusable =
            target &&
            target.querySelector(
              'a[href]:not([aria-hidden="true"]):not([tabindex="-1"]), button',
            );
          focusElement(focusable || target);
        }
      })
      .catch(function () {
        restore();
      });
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-load-more]');
    if (!link) return;
    event.preventDefault();
    loadPage(link);
  });

  /* ---------- Collection listing (ProductListing.tsx, FilterPanel.tsx, SortSelect.tsx) ---------- */

  function initListing(root) {
    var sectionId = root.getAttribute('data-section-id');
    var desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);
    var sheetOpen = false;
    var inerted = [];
    var requestId = 0;
    var pushed = false;
    var pendingFocus = null;

    function sidebar() {
      return root.querySelector('.collection-layout__sidebar');
    }

    function setPending(on) {
      var count = root.querySelector('.collection-toolbar__count');
      var grid = root.querySelector('[data-product-grid], .product-grid');
      if (count && on) count.textContent = 'Updating…';
      if (grid) grid.classList.toggle('is-loading', on);
    }

    /* Mobile filter sheet: useModalDialog() behaviour. */
    function releaseInert() {
      inerted.forEach(function (element) {
        element.removeAttribute('inert');
      });
      inerted = [];
    }

    function applySheet(focusInitial) {
      var panel = sidebar();
      if (!panel) return;
      panel.classList.add('is-open');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      var toggle = root.querySelector('.filters-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      document.documentElement.classList.add('filter-sheet-open');
      inerted = getElementsOutside(panel).filter(function (element) {
        return !element.hasAttribute('inert');
      });
      inerted.forEach(function (element) {
        element.setAttribute('inert', '');
      });
      if (!focusInitial) return;
      var attempts = 0;
      var tryFocus = function () {
        var target = panel.querySelector('.filters__close') || getFocusable(panel)[0] || panel;
        focusElement(target);
        if (!panel.contains(document.activeElement) && attempts++ < 10) {
          window.requestAnimationFrame(tryFocus);
        }
      };
      window.requestAnimationFrame(tryFocus);
    }

    function onSheetKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      var panel = sidebar();
      if (!panel) return;
      var focusable = getFocusable(panel);
      if (!focusable.length) {
        event.preventDefault();
        focusElement(panel);
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;
      var inside = active && panel.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        focusElement(first);
      }
    }

    function onMediaChange(event) {
      if (event.matches) closeSheet();
    }

    function openSheet() {
      if (sheetOpen) return;
      sheetOpen = true;
      applySheet(true);
      document.addEventListener('keydown', onSheetKeydown);
      if (desktop.addEventListener) desktop.addEventListener('change', onMediaChange);
      else desktop.addListener(onMediaChange);
    }

    function closeSheet() {
      if (!sheetOpen) return;
      sheetOpen = false;
      releaseInert();
      var panel = sidebar();
      if (panel) {
        panel.classList.remove('is-open');
        panel.setAttribute('role', 'complementary');
        panel.removeAttribute('aria-modal');
      }
      document.documentElement.classList.remove('filter-sheet-open');
      document.removeEventListener('keydown', onSheetKeydown);
      if (desktop.removeEventListener) desktop.removeEventListener('change', onMediaChange);
      else desktop.removeListener(onMediaChange);
      var toggle = root.querySelector('.filters-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        focusElement(toggle);
      }
    }

    /* Focus restoration after the layout is swapped (ActiveFilters.tsx, FilterPanel.tsx). */
    function rememberFocus(element) {
      var active = element || document.activeElement;
      if (!active || active === document.body) {
        pendingFocus = null;
        return;
      }
      var chips = Array.prototype.slice.call(root.querySelectorAll('.active-filters .chip'));
      pendingFocus = {
        id: active.id || '',
        chipIndex: chips.indexOf(active),
        clearAll: active.classList.contains('active-filters__clear'),
        panelClear: active.classList.contains('filters__clear'),
      };
    }

    function restoreFocus() {
      var pending = pendingFocus;
      pendingFocus = null;
      if (!pending) return;
      var target = null;
      if (pending.id) target = document.getElementById(pending.id);
      if (!target && pending.chipIndex >= 0) {
        var chips = root.querySelectorAll('.active-filters .chip');
        target =
          chips[pending.chipIndex] ||
          root.querySelector('.active-filters__clear') ||
          root.querySelector('.collection-toolbar__count');
      }
      if (!target && pending.clearAll) {
        target = root.querySelector('.collection-toolbar__count');
      }
      if (!target && pending.panelClear) {
        target = root.querySelector('.filters__title');
      }
      var active = document.activeElement;
      if (active && active !== document.body && root.contains(active)) return;
      focusElement(target);
    }

    function navigate(href, options) {
      options = options || {};
      var target = stripSectionParam(href);
      var request = ++requestId;
      setPending(true);
      fetchSection(target, sectionId)
        .then(function (doc) {
          if (request !== requestId) return;
          var next = doc.querySelector('.collection-layout');
          var current = root.querySelector('.collection-layout');
          if (!next || !current) {
            window.location.href = target;
            return;
          }
          if (options.push !== false) {
            window.history.pushState({listing: sectionId}, '', target);
            pushed = true;
          }
          if (sheetOpen) releaseInert();
          current.replaceWith(next);
          if (sheetOpen) applySheet(false);
          restoreFocus();
        })
        .catch(function () {
          if (request === requestId) window.location.href = target;
        });
    }

    /* FilterPanel.submitForm(): the GET form's fields become the URL; empty
       price fields are dropped and an inverted range is swapped. */
    function formUrl(form) {
      var params = new URLSearchParams();
      var min = null;
      var max = null;
      var minName = '';
      var maxName = '';
      new FormData(form).forEach(function (value, name) {
        if (typeof value !== 'string') return;
        if (/\.gte$/.test(name)) {
          minName = name;
          min = value.trim();
        } else if (/\.lte$/.test(name)) {
          maxName = name;
          max = value.trim();
        } else if (value !== '') {
          params.append(name, value);
        }
      });
      var minNumber = min !== null && min !== '' ? Number(min) : NaN;
      var maxNumber = max !== null && max !== '' ? Number(max) : NaN;
      var hasMin = Number.isFinite(minNumber) && minNumber >= 0;
      var hasMax = Number.isFinite(maxNumber) && maxNumber >= 0;
      if (hasMin && hasMax && minNumber > maxNumber) {
        var swap = minNumber;
        minNumber = maxNumber;
        maxNumber = swap;
      }
      if (hasMin) params.set(minName, String(minNumber));
      if (hasMax) params.set(maxName, String(maxNumber));
      var action = form.getAttribute('action') || window.location.pathname;
      var search = params.toString();
      return action + (search ? '?' + search : '');
    }

    /* SortSelect.handleChange(): the default option clears `sort_by`. */
    function sortUrl(select) {
      var option = select.options[select.selectedIndex];
      var value = option ? option.getAttribute('data-sort-by') : '';
      var url = toUrl(window.location.href);
      url.searchParams.delete('page');
      url.searchParams.delete('sort_by');
      if (value && value !== select.getAttribute('data-default')) {
        url.searchParams.set('sort_by', value);
      }
      return url.pathname + url.search;
    }

    root.addEventListener('change', function (event) {
      var target = event.target;
      if (target.matches('[data-sort-select]')) {
        rememberFocus(target);
        navigate(sortUrl(target));
      } else if (target.matches('[data-filter-form] input[type="checkbox"]') && target.form) {
        rememberFocus(target);
        navigate(formUrl(target.form));
      }
    });

    root.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form.matches('[data-filter-form]')) return;
      event.preventDefault();
      rememberFocus(
        document.activeElement && form.contains(document.activeElement)
          ? document.activeElement
          : form.querySelector('.price-filter__apply'),
      );
      navigate(formUrl(form));
    });

    root.addEventListener('click', function (event) {
      var link = event.target.closest('[data-listing-link]');
      if (link) {
        event.preventDefault();
        rememberFocus(link);
        navigate(link.getAttribute('href'));
        return;
      }
      if (event.target.closest('.filters-toggle')) {
        openSheet();
        return;
      }
      if (event.target.closest('.filters__close, [data-filters-close]')) {
        closeSheet();
      }
    });

    window.addEventListener('popstate', function () {
      if (!pushed) return;
      navigate(window.location.href, {push: false});
    });
  }

  /* ---------- Search page (SearchForm.tsx: Cmd+K focuses, Escape blurs) ---------- */

  function initSearchPage(input) {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'k' && event.metaKey) {
        event.preventDefault();
        focusElement(input);
      }
      if (event.key === 'Escape') input.blur();
    });
  }

  /* ---------- Predictive search (SearchFormPredictive.tsx, SearchResultsPredictive.tsx) ----------
   * ARIA combobox: the input keeps focus; ArrowDown/ArrowUp move
   * aria-activedescendant through the visible listbox's role="option" rows,
   * Enter opens the active option (or submits the search), Escape clears the
   * active option, then the text, then lets the drawer close.
   * Panels (sections/search-drawer.liquid): [data-ps-initial] (popular
   * searches + bestsellers, server-rendered) and [data-ps-live] (fetched
   * sections/predictive-search -> snippets/predictive-results.liquid).
   */

  function initPredictive(drawer) {
    var wrap =
      drawer.querySelector('[data-predictive-search]') ||
      drawer.querySelector('.predictive-search') ||
      drawer;
    var form = wrap.querySelector('form');
    var input =
      wrap.querySelector('[data-predictive-search-input]') ||
      wrap.querySelector('input[type="search"]');
    if (!input) return;
    var panels = wrap.querySelector('[data-predictive-results]');
    if (!panels) {
      panels = document.createElement('div');
      panels.setAttribute('data-predictive-results', '');
      (form || input).insertAdjacentElement('afterend', panels);
    }
    var initial = panels.querySelector('[data-ps-initial]');
    var live = panels.querySelector('[data-ps-live]');
    if (!live) {
      live = document.createElement('div');
      live.className = 'ss-panel ss-panel--live';
      live.setAttribute('data-ps-live', '');
      live.hidden = true;
      panels.appendChild(live);
    }
    var loading = panels.querySelector('[data-ps-loading]');
    var status = wrap.querySelector('[data-ps-status]') || wrap.querySelector('[aria-live]');
    if (!status) {
      status = document.createElement('div');
      status.className = 's-sr';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      wrap.appendChild(status);
    }
    var overlay = input.closest('.overlay');
    var submitButton = wrap.querySelector('[data-predictive-search-submit]');
    var endpoint = routes().predictiveSearch || '/search/suggest';
    var searchUrl = routes().search || '/search';
    var timer = null;
    var controller = null;
    var term = '';
    var activeIndex = -1;
    var cache = {};
    var cacheSize = 0;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    function isOpen() {
      return !overlay || overlay.classList.contains('expanded');
    }

    function setStatus(text) {
      if (status.textContent !== text) status.textContent = text;
    }

    function currentPanel() {
      return live.hidden ? initial : live;
    }

    function currentListbox() {
      var panel = currentPanel();
      return panel ? panel.querySelector('[role="listbox"]') : null;
    }

    function getOptions() {
      var listbox = currentListbox();
      return listbox ? Array.prototype.slice.call(listbox.querySelectorAll('[role="option"]')) : [];
    }

    function syncCombobox() {
      var listbox = currentListbox();
      if (listbox && listbox.id) input.setAttribute('aria-controls', listbox.id);
      var expanded = isOpen() && getOptions().length > 0;
      input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function setActive(index) {
      var options = getOptions();
      options.forEach(function (option) {
        option.setAttribute('aria-selected', 'false');
      });
      if (index < 0 || index >= options.length) {
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      activeIndex = index;
      var option = options[index];
      option.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', option.id);
      if (typeof option.scrollIntoView === 'function') option.scrollIntoView({block: 'nearest'});
    }

    function setLoading(on) {
      wrap.classList.toggle('is-loading', on);
      var listbox = currentListbox();
      if (listbox) listbox.setAttribute('aria-busy', on ? 'true' : 'false');
      if (!on) {
        live.classList.remove('is-stale');
        if (loading) loading.hidden = true;
        return;
      }
      if (live.hidden) {
        // First query after the empty state: skeleton rows instead of the
        // popular searches.
        if (initial) initial.hidden = true;
        if (loading) loading.hidden = false;
      } else {
        live.classList.add('is-stale');
      }
    }

    function showInitial() {
      setLoading(false);
      live.hidden = true;
      live.innerHTML = '';
      if (initial) initial.hidden = false;
      setActive(-1);
      syncCombobox();
      setStatus('');
    }

    function showLive(html) {
      setLoading(false);
      live.innerHTML = html;
      live.hidden = false;
      if (initial) initial.hidden = true;
      setActive(-1);
      syncCombobox();
    }

    function showResults(q, html) {
      showLive(html);
      var payload = live.querySelector('[data-ps-payload]');
      var count = payload ? parseInt(payload.getAttribute('data-count'), 10) || 0 : 0;
      if (!payload) count = live.querySelectorAll('.ss-option--product').length;
      setStatus(
        count > 0
          ? formatNumber(count) + (count === 1 ? ' result' : ' results') + ' for ' + q
          : 'No results for ' + q,
      );
    }

    function showError() {
      showLive('<div class="ss-empty"><p class="ss-empty__title"></p></div>');
      live.querySelector('.ss-empty__title').textContent = SEARCH_UNAVAILABLE;
      setStatus(SEARCH_UNAVAILABLE);
    }

    function goToSearch() {
      var value = input.value.trim();
      if (!value) return;
      window.location.href = searchUrl + '?q=' + encodeURIComponent(value) + '&type=product';
      closeDrawer();
    }

    function reset() {
      window.clearTimeout(timer);
      if (controller) controller.abort();
      input.value = '';
      term = '';
      showInitial();
    }

    function closeSearch() {
      input.blur();
      reset();
      closeDrawer();
    }

    function navigate(href) {
      closeSearch();
      window.location.href = href;
    }

    function fetchResults(value) {
      var q = value.trim();
      window.clearTimeout(timer);
      if (controller) controller.abort();
      controller = null;
      term = q;
      if (!q) {
        showInitial();
        return;
      }
      var key = q.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(cache, key)) {
        showResults(q, cache[key]);
        return;
      }
      setLoading(true);
      var request = new AbortController();
      controller = request;
      var url = toUrl(endpoint);
      url.searchParams.set('q', q);
      url.searchParams.set('resources[type]', 'product,collection,query');
      url.searchParams.set('resources[limit]', String(PREDICTIVE_LIMIT));
      url.searchParams.set('resources[limit_scope]', 'each');
      url.searchParams.set('resources[options][fields]', PREDICTIVE_FIELDS);
      url.searchParams.set('resources[options][unavailable_products]', 'last');
      url.searchParams.set('section_id', 'predictive-search');
      fetch(url.toString(), {
        signal: request.signal,
        headers: {Accept: 'text/html'},
        credentials: 'same-origin',
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var section =
            doc.getElementById('shopify-section-predictive-search') ||
            doc.querySelector('.shopify-section') ||
            doc.body;
          if (cacheSize > 40) {
            cache = {};
            cacheSize = 0;
          }
          cache[key] = section.innerHTML;
          cacheSize += 1;
          if (q !== term) return;
          controller = null;
          showResults(q, cache[key]);
        })
        .catch(function (error) {
          if (error && error.name === 'AbortError') return;
          if (q !== term) return;
          controller = null;
          showError();
        });
    }

    /** Opens an option: popular/suggested terms search in place, links navigate. */
    function activate(option) {
      var searchTerm = option.getAttribute('data-search-term');
      if (searchTerm !== null) {
        input.value = searchTerm;
        fetchResults(searchTerm);
        focusElement(input);
        return;
      }
      var link = option.querySelector('a[href]');
      if (link) navigate(link.href);
    }

    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      setActive(-1);
      if (!input.value.trim()) {
        fetchResults('');
        return;
      }
      timer = window.setTimeout(function () {
        fetchResults(input.value);
      }, PREDICTIVE_DEBOUNCE);
    });

    input.addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      var options = getOptions();
      switch (event.key) {
        case 'ArrowDown':
          if (!options.length) return;
          event.preventDefault();
          setActive(activeIndex + 1 >= options.length ? 0 : activeIndex + 1);
          break;
        case 'ArrowUp':
          if (!options.length) return;
          event.preventDefault();
          if (activeIndex === -1) setActive(options.length - 1);
          else setActive(activeIndex - 1);
          break;
        case 'Enter':
          event.preventDefault();
          if (activeIndex >= 0 && options[activeIndex]) {
            activate(options[activeIndex]);
          } else {
            window.clearTimeout(timer);
            goToSearch();
          }
          break;
        case 'Escape':
          if (activeIndex >= 0) {
            event.preventDefault();
            event.stopPropagation();
            setActive(-1);
          } else if (input.value) {
            event.preventDefault();
            event.stopPropagation();
            reset();
          }
          // Otherwise the drawer's own Escape handler closes it.
          break;
        default:
      }
    });

    input.addEventListener('focus', function () {
      var value = input.value.trim();
      if (value && value !== term) fetchResults(value);
    });

    input.addEventListener('blur', function () {
      setActive(-1);
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        event.stopPropagation();
        goToSearch();
      });
    }

    if (submitButton) {
      submitButton.addEventListener('click', function () {
        goToSearch();
      });
    }

    // Keep focus in the input when pointing at options.
    panels.addEventListener('mousedown', function (event) {
      if (event.target.closest('[role="option"]')) event.preventDefault();
    });

    panels.addEventListener('click', function (event) {
      var option = event.target.closest('[role="option"]');
      if (option && option.hasAttribute('data-search-term')) {
        event.preventDefault();
        activate(option);
        return;
      }
      var link = event.target.closest('a[href]');
      if (!link) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      closeSearch();
    });

    document.addEventListener('theme:drawer:open', function (event) {
      if (!event.detail || event.detail.name !== 'search') return;
      if (!input.value.trim()) showInitial();
      syncCombobox();
      // theme.js focuses the close button once the drawer is visible; move
      // focus on to the search field as soon as that has happened.
      var dialog = input.closest('[role="dialog"]') || overlay;
      var attempts = 0;
      (function focusInput() {
        var active = document.activeElement;
        if (active === input) return;
        if (dialog && dialog.contains(active)) {
          focusElement(input);
          return;
        }
        if (attempts++ < 20) requestAnimationFrame(focusInput);
      })();
    });

    document.addEventListener('theme:drawer:close', function (event) {
      if (!event.detail || event.detail.name !== 'search') return;
      setActive(-1);
      input.setAttribute('aria-expanded', 'false');
    });

    syncCombobox();
  }

  /* ---------- boot ---------- */

  function init() {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-collection-listing]'),
      initListing,
    );
    var searchInput = document.getElementById('search-page-input');
    if (searchInput) initSearchPage(searchInput);
    var drawer =
      document.querySelector('.drawer--search') ||
      document.querySelector('[data-drawer="search"]');
    if (drawer) initPredictive(drawer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
