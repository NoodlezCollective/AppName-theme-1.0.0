/* Somna content pages: policy "On this page" menu, policy pill menu,
 * Do Not Sell switch, contact-form states, Support topics, FAQ and search.
 * Loaded (deferred) by the sections that need it; safe to include twice.
 */
(function () {
  'use strict';
  if (window.SomnaPages) return;
  window.SomnaPages = true;

  function each(selector, fn, root) {
    Array.prototype.forEach.call((root || document).querySelectorAll(selector), fn);
  }

  /* true the first time an element is seen (sections reload in the editor) */
  function once(element, key) {
    var name = 'somna' + key;
    if (element.dataset[name]) return false;
    element.dataset[name] = '1';
    return true;
  }

  function slugify(text) {
    return (text || '')
      .toLowerCase()
      .replace(/&[a-z]+;/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section';
  }

  /* Policy article: tidy merchant-written tables, build the menu from h2s */
  function initPolicies() {
    each('[data-somna-policy]', function (article) {
      each('table', function (table) {
        if (table.closest('.s-table-box') && table.classList.contains('s-pol-table')) return;
        if (table.classList.contains('s-table') || table.classList.contains('s-pol-table')) return;
        table.classList.add('s-pol-table');
        var parent = table.parentElement;
        if (!parent.classList.contains('s-table-box')) {
          var box = document.createElement('div');
          box.className = 's-table-box';
          parent.insertBefore(box, table);
          box.appendChild(table);
        }
      }, article);
    });

    each('[data-somna-toc-auto]', function (toc) {
      if (!once(toc, 'Toc')) return;
      var article = toc.parentElement.querySelector('[data-somna-policy]');
      if (!article) return;
      var used = {};
      var count = 0;
      each('h2', function (heading) {
        if (heading.closest('.s-glance, .s-pol-cta')) return;
        var text = heading.textContent.trim();
        if (!text) return;
        var id = heading.id;
        if (!id) {
          id = slugify(text);
          var base = id;
          var n = 2;
          while (used[id] || document.getElementById(id)) id = base + '-' + n++;
          heading.id = id;
        }
        used[id] = true;
        var link = document.createElement('a');
        link.href = '#' + id;
        link.textContent = text;
        toc.appendChild(link);
        count++;
      }, article);
      if (count > 0) toc.hidden = false;
    });
  }

  /* Policy pill menu: bring the current pill into view on small screens */
  function initPolicyNav() {
    each('[data-somna-pnav]', function (list) {
      var current = list.querySelector('[aria-current="page"]');
      if (!current || list.scrollWidth <= list.clientWidth) return;
      var left = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
      list.scrollLeft = Math.max(0, left);
    });
  }

  /* Do Not Sell: targeted advertising switch (Shopify Customer Privacy API) */
  function withPrivacy(callback) {
    var shopify = window.Shopify;
    if (shopify && shopify.customerPrivacy) {
      callback(shopify.customerPrivacy);
      return;
    }
    if (shopify && typeof shopify.loadFeatures === 'function') {
      try {
        shopify.loadFeatures([{name: 'consent-tracking-api', version: '0.1'}], function (error) {
          if (!error && window.Shopify.customerPrivacy) callback(window.Shopify.customerPrivacy);
        });
      } catch (e) { /* consent API unavailable */ }
    }
  }

  function initAdSwitch() {
    var KEY = 'somna-ads-opt-out';
    each('[data-somna-adswitch]', function (box) {
      if (!once(box, 'Switch')) return;
      var button = box.querySelector('[role="switch"]');
      var status = box.querySelector('.s-dns__status');
      if (!button) return;
      var stored = null;
      try { stored = window.localStorage.getItem(KEY); } catch (e) { stored = null; }
      var gpc = navigator.globalPrivacyControl === true;

      function render(on) {
        button.setAttribute('aria-checked', on ? 'true' : 'false');
        if (status) status.textContent = on ? status.getAttribute('data-on') : status.getAttribute('data-off');
      }

      render(!(gpc || stored === '1'));
      withPrivacy(function (privacy) {
        try {
          if (gpc) {
            privacy.setTrackingConsent({sale_of_data: false}, function () {});
          } else if (stored === null && typeof privacy.saleOfDataAllowed === 'function') {
            render(privacy.saleOfDataAllowed());
          }
        } catch (e) { /* ignore */ }
      });

      button.addEventListener('click', function () {
        var on = button.getAttribute('aria-checked') !== 'true';
        render(on);
        try { window.localStorage.setItem(KEY, on ? '0' : '1'); } catch (e) { /* private mode */ }
        withPrivacy(function (privacy) {
          try { privacy.setTrackingConsent({sale_of_data: on}, function () {}); } catch (e) { /* ignore */ }
        });
      });
    });
  }

  /* Shopify contact forms: success state only for the form that was sent,
     and "send another" resets it. */
  function initForms() {
    each('[data-somna-form]', function (form) {
      if (!once(form, 'Form')) return;
      var fields = form.querySelector('[data-somna-fields]');
      var done = form.querySelector('[data-somna-done]');
      if (!fields || !done) return;
      function show(sent) {
        fields.hidden = sent;
        done.hidden = !sent;
      }
      if (!done.hidden && form.id && window.location.hash && window.location.hash !== '#' + form.id) {
        show(false);
      }
      each('[data-somna-reset]', function (button) {
        button.addEventListener('click', function () {
          show(false);
          var first = fields.querySelector('input:not([type="hidden"]), select, textarea');
          if (first) first.focus();
        });
      }, form);
    });
  }

  /* Exclusive FAQ accordions (one answer open at a time) */
  function initFaq(root) {
    each('details[data-somna-faq]', function (item) {
      if (item.dataset.somnaFaqBound) return;
      item.dataset.somnaFaqBound = '1';
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        var group = item.parentElement;
        each('details[data-somna-faq]', function (other) {
          if (other !== item && other.open) other.open = false;
        }, group);
      });
    }, root);
  }

  /* Support: topic cards switch the FAQ list below */
  function initTopics() {
    each('[data-somna-help]', function (help) {
      if (!once(help, 'Help')) return;
      var buttons = help.querySelectorAll('[data-topic]');
      var title = help.querySelector('[data-somna-faq-title]');
      var panels = help.querySelectorAll('[data-topic-panel]');

      function select(id, label) {
        Array.prototype.forEach.call(buttons, function (button) {
          button.setAttribute('aria-pressed', button.getAttribute('data-topic') === id ? 'true' : 'false');
        });
        Array.prototype.forEach.call(panels, function (panel) {
          var match = panel.getAttribute('data-topic-panel') === id;
          panel.hidden = !match;
          if (match) {
            var items = panel.querySelectorAll('details[data-somna-faq]');
            Array.prototype.forEach.call(items, function (item, index) { item.open = index === 0; });
          }
        });
        if (title && label) title.textContent = label;
      }

      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener('click', function () {
          select(button.getAttribute('data-topic'), button.getAttribute('data-title'));
        });
      });

      help.somnaSelect = select;
    });
  }

  /* Support: search the FAQ answers in place; falls back to store search */
  function initHelpSearch() {
    each('[data-somna-help-search]', function (form) {
      if (!once(form, 'Search')) return;
      var input = form.querySelector('input[type="search"]');
      var help = document.querySelector('[data-somna-help]');
      if (!input || !help) return;
      var results = help.querySelector('[data-topic-panel="search"]');
      var note = form.parentElement.querySelector('[data-somna-help-note]');

      form.addEventListener('submit', function (event) {
        var query = input.value.trim().toLowerCase();
        if (!query || !results) return;
        var words = query.split(/\s+/).filter(function (word) { return word.length > 2; });
        if (!words.length) words = [query];
        var matches = [];
        each('[data-topic-panel]:not([data-topic-panel="search"]) details[data-somna-faq]', function (item) {
          var text = item.textContent.toLowerCase();
          var score = 0;
          words.forEach(function (word) { if (text.indexOf(word) !== -1) score++; });
          if (score > 0) matches.push({item: item, score: score});
        }, help);
        if (!matches.length) return; /* let the store search handle it */
        event.preventDefault();
        matches.sort(function (a, b) { return b.score - a.score; });
        results.innerHTML = '';
        matches.slice(0, 8).forEach(function (match, index) {
          var clone = match.item.cloneNode(true);
          delete clone.dataset.somnaFaqBound;
          clone.open = index === 0;
          results.appendChild(clone);
        });
        initFaq(results);
        var label = (results.getAttribute('data-label') || 'Results for “{q}”').replace('{q}', input.value.trim());
        if (help.somnaSelect) help.somnaSelect('search', label);
        if (note) {
          note.hidden = false;
          note.textContent = matches.length + (matches.length === 1 ? ' answer found.' : ' answers found.');
        }
        var target = help.querySelector('#faq') || results;
        target.scrollIntoView({behavior: 'smooth', block: 'start'});
      });
    });
  }

  function init() {
    initPolicies();
    initPolicyNav();
    initAdSwitch();
    initForms();
    initFaq();
    initTopics();
    initHelpSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', init);
})();
