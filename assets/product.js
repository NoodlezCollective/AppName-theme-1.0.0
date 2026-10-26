/*
 * Product page behaviour, ported from app/components/product/*.tsx,
 * ProductForm.tsx and AddToCartButton.tsx:
 * gallery, variant selection, pack tiers, quantity, add-on, add to cart,
 * savings note, reviews carousel and product recommendations.
 *
 * Expects assets/theme.js (window.theme):
 *   theme.cart.add(items, {open: true}) -> Promise (resolves once the lines
 *     are in the cart and the drawer is open; rejects with an Error whose
 *     message is shown next to the button)
 *   theme.money(cents) -> formatted price
 * Without theme.js the add-to-cart form posts to routes.cart_add_url.
 */
(function () {
  'use strict';

  // Three sections load this file; run it once.
  if (window.theme && window.theme.productScriptLoaded) return;
  window.theme = window.theme || {};
  window.theme.productScriptLoaded = true;

  var DESKTOP_MEDIA_QUERY = '(min-width: 64em)';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  var FALLBACK_ERROR =
    'We couldn’t add this item to your cart. Please try again.';
  var BUSY_LABEL = 'Adding…';

  function matches(query) {
    return Boolean(window.matchMedia && window.matchMedia(query).matches);
  }

  function scrollBehavior() {
    return matches(REDUCED_MOTION_QUERY) ? 'auto' : 'smooth';
  }

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  function money(cents) {
    if (window.theme && typeof window.theme.money === 'function') {
      return window.theme.money(cents);
    }
    return '$' + (cents / 100).toFixed(2);
  }

  /* `money_without_trailing_zeros`: "$100.00" -> "$100". */
  function moneyWithoutTrailingZeros(cents) {
    return money(cents).replace(/([.,])00(?=\D*$)/, '');
  }

  /* ---------- Gallery (ProductGallery.tsx) ---------- */

  function initGallery(root) {
    if (root.galleryApi) return root.galleryApi;
    var track = root.querySelector('[data-gallery-track]');
    if (!track) return null;
    var slides = toArray(track.querySelectorAll('.gallery__slide'));
    var thumbStrip = root.querySelector('[data-gallery-thumbs]');
    var thumbs = thumbStrip
      ? toArray(thumbStrip.querySelectorAll('.gallery__thumb'))
      : [];
    var count = slides.length;
    var active = Math.max(
      0,
      slides.findIndex(function (slide) {
        return slide.classList.contains('is-active');
      }),
    );
    // Target of a scroll we started ourselves; scroll events are ignored
    // until the track arrives there.
    var pending = null;
    var frame = 0;

    function paint() {
      track.style.setProperty('--gallery-index', String(active));
      slides.forEach(function (slide, index) {
        slide.classList.toggle('is-active', index === active);
      });
      thumbs.forEach(function (thumb, index) {
        thumb.classList.toggle('is-active', index === active);
        thumb.setAttribute('aria-pressed', index === active ? 'true' : 'false');
      });
      scrollThumbIntoView();
    }

    function settlePendingScroll() {
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pending = null;
    }

    function syncActiveFromScroll() {
      if (!track.clientWidth) return;
      var index = Math.round(track.scrollLeft / track.clientWidth);
      if (index >= 0 && index < count && index !== active) {
        active = index;
        paint();
      }
    }

    // Keep the mobile scroll-snap track aligned with the active slide.
    function syncTrack() {
      if (matches(DESKTOP_MEDIA_QUERY)) return;
      var left = active * track.clientWidth;
      if (Math.abs(track.scrollLeft - left) < 2) return;
      settlePendingScroll();
      pending = {
        target: left,
        timer: window.setTimeout(function () {
          pending = null;
          syncActiveFromScroll();
        }, 1000),
      };
      track.scrollTo({left: left, behavior: scrollBehavior()});
    }

    // Keep the active thumbnail visible inside the strip (horizontal only).
    function scrollThumbIntoView() {
      var thumb = thumbs[active];
      if (!thumbStrip || !thumb) return;
      var start = thumb.offsetLeft - thumbStrip.offsetLeft;
      var end = start + thumb.offsetWidth;
      if (start < thumbStrip.scrollLeft) {
        thumbStrip.scrollTo({left: start - 8, behavior: scrollBehavior()});
      } else if (end > thumbStrip.scrollLeft + thumbStrip.clientWidth) {
        thumbStrip.scrollTo({
          left: end - thumbStrip.clientWidth + 8,
          behavior: scrollBehavior(),
        });
      }
    }

    function setActive(index) {
      if (!count) return;
      var next = ((index % count) + count) % count;
      if (next === active) return;
      active = next;
      paint();
      syncTrack();
    }

    track.addEventListener('scroll', function () {
      if (matches(DESKTOP_MEDIA_QUERY)) return;
      if (pending) {
        if (Math.abs(track.scrollLeft - pending.target) < 2) {
          settlePendingScroll();
        }
        return;
      }
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncActiveFromScroll);
    });
    track.addEventListener('scrollend', function () {
      settlePendingScroll();
      syncActiveFromScroll();
    });

    var prev = root.querySelector('[data-gallery-prev]');
    var next = root.querySelector('[data-gallery-next]');
    if (prev) prev.addEventListener('click', function () { setActive(active - 1); });
    if (next) next.addEventListener('click', function () { setActive(active + 1); });
    thumbs.forEach(function (thumb, index) {
      thumb.addEventListener('click', function () { setActive(index); });
    });

    syncTrack();

    root.galleryApi = {
      setActive: setActive,
      showMedia: function (mediaId) {
        if (mediaId == null) return;
        var index = slides.findIndex(function (slide) {
          return slide.getAttribute('data-media-id') === String(mediaId);
        });
        if (index >= 0) setActive(index);
      },
    };
    return root.galleryApi;
  }

  /* ---------- Savings note (SavingsNote.tsx) ---------- */

  function initSavingsNote(root) {
    var toggle = root.querySelector('[data-savings-toggle]');
    var panel = root.querySelector('[data-savings-panel]');
    if (!toggle || !panel) return;
    var controller = null;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.hidden = !open;
      if (controller) {
        controller.abort();
        controller = null;
      }
      if (!open) return;
      controller = new AbortController();
      document.addEventListener(
        'keydown',
        function (event) {
          if (event.key === 'Escape') setOpen(false);
        },
        {signal: controller.signal},
      );
      document.addEventListener(
        'pointerdown',
        function (event) {
          if (!root.contains(event.target)) setOpen(false);
        },
        {signal: controller.signal},
      );
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
  }

  /* ---------- Quantity (QuantitySelector.tsx) ---------- */

  function initQuantity(root, onChange) {
    var input = root.querySelector('[data-quantity-input]');
    var decrease = root.querySelector('[data-quantity-decrease]');
    var increase = root.querySelector('[data-quantity-increase]');
    if (!input || !decrease || !increase) return null;
    var min = parseInt(input.min, 10) || 1;
    var max = input.max ? parseInt(input.max, 10) : Infinity;
    var value = clamp(parseInt(input.value, 10) || min);

    function clamp(next) {
      return Math.min(max, Math.max(min, next));
    }

    // `aria-disabled` at the bounds instead of `disabled`, so the button
    // keeps focus when the limit is reached from the keyboard.
    function paint() {
      input.value = String(value);
      if (value <= min) decrease.setAttribute('aria-disabled', 'true');
      else decrease.removeAttribute('aria-disabled');
      if (value >= max) increase.setAttribute('aria-disabled', 'true');
      else increase.removeAttribute('aria-disabled');
    }

    function set(next, silent) {
      value = clamp(next);
      paint();
      if (!silent) onChange(value);
    }

    function commit() {
      var parsed = parseInt(input.value, 10);
      set(Number.isFinite(parsed) ? parsed : min);
    }

    decrease.addEventListener('click', function () {
      if (value > min) set(value - 1);
    });
    increase.addEventListener('click', function () {
      if (value < max) set(value + 1);
    });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    paint();

    return {
      get: function () { return value; },
      set: function (next) { set(next, true); },
    };
  }

  /* ---------- Pack tiers (PackTiers.tsx) ---------- */

  function initPackTiers(root, onChange) {
    var tiers = toArray(root.querySelectorAll('[data-pack-tier]')).map(
      function (label) {
        var input = label.querySelector('.pack-tier__input');
        return {label: label, input: input, quantity: parseInt(input.value, 10)};
      },
    );
    tiers.forEach(function (tier) {
      tier.input.addEventListener('change', function () {
        if (tier.input.checked) onChange(tier.quantity);
      });
    });

    return {
      sync: function (quantity) {
        tiers.forEach(function (tier) {
          var selected = tier.quantity === quantity;
          tier.input.checked = selected;
          tier.label.classList.toggle('is-selected', selected);
        });
      },
      updatePrices: function (price, compareAtPrice) {
        var hasCompare = compareAtPrice != null && compareAtPrice > price;
        tiers.forEach(function (tier) {
          var total = tier.label.querySelector('[data-pack-total]');
          var compare = tier.label.querySelector('[data-pack-compare]');
          if (total) total.textContent = money(price * tier.quantity);
          if (!compare) return;
          compare.hidden = !hasCompare;
          var amount = compare.querySelector('[data-pack-compare-amount]');
          if (amount) {
            amount.textContent = hasCompare
              ? moneyWithoutTrailingZeros(compareAtPrice * tier.quantity)
              : '';
          }
        });
      },
    };
  }

  /* ---------- Add-on (AddonOffer.tsx) ---------- */

  function initAddon(root) {
    var label = root.querySelector('[data-addon]');
    var input = label && label.querySelector('[data-addon-input]');
    if (!label || !input) return null;
    function paint() {
      label.classList.toggle('is-selected', input.checked);
    }
    input.addEventListener('change', paint);
    paint();
    return {
      line: function () {
        if (!input.checked) return null;
        var id = parseInt(input.getAttribute('data-variant-id'), 10);
        return id ? {id: id, quantity: 1} : null;
      },
    };
  }

  /* ---------- Price (Price.tsx / price snippet) ---------- */

  function renderPrice(container, price, compareAtPrice, size) {
    var onSale = compareAtPrice != null && compareAtPrice > price;
    var classes = ['price', 'price--' + size];
    if (onSale) classes.push('price--sale');
    toArray(container.classList).forEach(function (name) {
      if (name !== 'price' && name.indexOf('price--') !== 0) classes.push(name);
    });
    container.className = classes.join(' ');
    var html = '<span class="price__current">' + money(price) + '</span>';
    if (onSale) {
      html +=
        '<s class="price__compare"><span class="sr-only">Regular price </span>' +
        moneyWithoutTrailingZeros(compareAtPrice) +
        '</s>';
    }
    container.innerHTML = html;
  }

  /* ---------- Variant selection (VariantSelector.tsx, getProductOptions) ---------- */

  function readProductJson(root) {
    var script = root.querySelector('[data-product-json]');
    if (!script) return null;
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      return null;
    }
  }

  function sameOptions(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function findVariant(variants, options) {
    for (var i = 0; i < variants.length; i += 1) {
      if (sameOptions(variants[i].options, options)) return variants[i];
    }
    return null;
  }

  function firstSelectableVariant(variants, index, name) {
    for (var i = 0; i < variants.length; i += 1) {
      if (variants[i].options[index] === name) return variants[i];
    }
    return null;
  }

  function writeVariantToUrl(variant) {
    if (!window.history || !window.history.replaceState) return;
    var url = new URL(window.location.href);
    url.searchParams.set('variant', String(variant.id));
    window.history.replaceState(window.history.state, '', url.toString());
  }

  /* ---------- Add to cart (AddToCartButton.tsx) ---------- */

  function initAddToCart(form, getLines) {
    var wrap = form.querySelector('[data-add-to-cart]');
    var button = form.querySelector('[data-add-to-cart-button]');
    var label = form.querySelector('[data-add-to-cart-label]');
    var status = form.querySelector('[data-add-to-cart-status]');
    if (!wrap || !button || !label || !status) return null;
    var busy = false;
    var idleLabel = label.textContent;
    var errors = null;

    function setErrors(messages) {
      if (errors) {
        errors.remove();
        errors = null;
      }
      if (!messages.length) return;
      errors = document.createElement('ul');
      errors.className = 'form-message form-message--error add-to-cart__errors';
      errors.setAttribute('role', 'alert');
      messages.forEach(function (message) {
        var item = document.createElement('li');
        item.textContent = message;
        errors.appendChild(item);
      });
      wrap.appendChild(errors);
    }

    function setBusy(next) {
      busy = next;
      button.classList.toggle('is-loading', busy);
      if (busy) {
        button.setAttribute('aria-busy', 'true');
        button.disabled = true;
        var spinner = document.createElement('span');
        spinner.className = 'btn__spinner';
        spinner.setAttribute('aria-hidden', 'true');
        button.insertBefore(spinner, label);
        label.textContent = BUSY_LABEL;
        status.textContent = BUSY_LABEL;
      } else {
        button.removeAttribute('aria-busy');
        var old = button.querySelector('.btn__spinner');
        if (old) old.remove();
        label.textContent = idleLabel;
      }
    }

    form.addEventListener('submit', function (event) {
      var cart = window.theme && window.theme.cart;
      if (!cart || typeof cart.add !== 'function') return; // plain post
      event.preventDefault();
      if (busy || button.disabled) return;
      var lines = getLines();
      if (!lines.length) return;
      var hadFocus = document.activeElement === button;
      setErrors([]);
      setBusy(true);
      Promise.resolve()
        .then(function () {
          return cart.add(lines, {open: true});
        })
        .then(
          function (result) {
            if (result && result.status >= 400) {
              throw new Error(result.description || result.message || '');
            }
            status.textContent = 'Added to cart.';
          },
          function (error) {
            status.textContent = 'Could not add to cart.';
            var message = error && error.message ? error.message : '';
            setErrors([message || FALLBACK_ERROR]);
          },
        )
        .then(function () {
          setBusy(false);
          button.disabled = !form.available;
          // A disabled button cannot keep focus: put it back unless the
          // shopper moved on.
          var active = document.activeElement;
          if (hadFocus && (!active || active === document.body)) button.focus();
        });
    });

    form.available = !button.disabled;

    return {
      setVariant: function (variant) {
        var available = Boolean(variant && variant.available);
        form.available = available;
        idleLabel = available ? 'Add to cart' : 'Sold out';
        if (!busy) {
          label.textContent = idleLabel;
          button.disabled = !available;
        }
      },
    };
  }

  /* ---------- Product form wiring (ProductForm.tsx) ---------- */

  function initProduct(page) {
    if (page.productInitialised) return;
    page.productInitialised = true;

    var data = readProductJson(page);
    var variants = data && Array.isArray(data.variants) ? data.variants : [];
    var current = null;
    for (var i = 0; i < variants.length; i += 1) {
      if (data && variants[i].id === data.selectedVariantId) current = variants[i];
    }

    var galleryRoot = page.querySelector('[data-gallery]');
    var gallery = galleryRoot ? initGallery(galleryRoot) : null;
    var savings = page.querySelector('[data-savings-note]');
    if (savings) initSavingsNote(savings);

    var packTiersRoot = page.querySelector('[data-pack-tiers]');
    var quantityRoot = page.querySelector('[data-quantity]');
    var packTiers = null;
    var quantity = null;
    if (quantityRoot) {
      quantity = initQuantity(quantityRoot, function (value) {
        if (packTiers) packTiers.sync(value);
      });
    }
    if (packTiersRoot) {
      packTiers = initPackTiers(packTiersRoot, function (value) {
        if (quantity) quantity.set(value);
        packTiers.sync(value);
      });
    }
    var addon = initAddon(page);

    var form = page.querySelector('[data-product-form]');
    var variantInput = form && form.querySelector('[data-variant-input]');
    var addToCart = form
      ? initAddToCart(form, function () {
          if (!current || !current.available) return [];
          var lines = [
            {id: current.id, quantity: quantity ? quantity.get() : 1},
          ];
          var extra = addon && addon.line();
          if (extra) lines.push(extra);
          return lines;
        })
      : null;

    var priceEl = page.querySelector('.product-info__price');
    var options = toArray(page.querySelectorAll('.product-option'));

    function paintOptions(variant) {
      options.forEach(function (option) {
        var index = parseInt(option.getAttribute('data-option-index'), 10);
        var selectedName = variant.options[index];
        var valueEl = option.querySelector('[data-option-selected]');
        if (valueEl) valueEl.textContent = selectedName;
        toArray(option.querySelectorAll('[data-option-value]')).forEach(
          function (control) {
            var name = control.getAttribute('data-option-value');
            var target = variant.options.slice();
            target[index] = name;
            var match = findVariant(variants, target);
            var exists = Boolean(match);
            var available = Boolean(match && match.available);
            var selected = name === selectedName;
            control.classList.toggle('is-selected', selected);
            control.classList.toggle('is-unavailable', !available);
            control.setAttribute('aria-pressed', selected ? 'true' : 'false');
            control.setAttribute('aria-label', available ? name : name + ' (sold out)');
            control.disabled = !exists;
            var fallback = match || firstSelectableVariant(variants, index, name);
            if (fallback) control.setAttribute('data-variant-id', String(fallback.id));
          },
        );
      });
    }

    function applyVariant(variant, writeUrl) {
      if (!variant) return;
      current = variant;
      paintOptions(variant);
      if (priceEl) {
        renderPrice(priceEl, variant.price, variant.compare_at_price, 'lg');
      }
      if (savings) {
        savings.hidden = !(
          variant.compare_at_price != null &&
          variant.compare_at_price > variant.price
        );
      }
      if (packTiers) packTiers.updatePrices(variant.price, variant.compare_at_price);
      if (gallery && variant.featured_media) gallery.showMedia(variant.featured_media.id);
      if (variantInput) variantInput.value = String(variant.id);
      if (addToCart) addToCart.setVariant(variant);
      if (writeUrl) writeVariantToUrl(variant);
    }

    options.forEach(function (option) {
      option.addEventListener('click', function (event) {
        var control = event.target.closest('[data-option-value]');
        if (!control || control.disabled || !current) return;
        var index = parseInt(option.getAttribute('data-option-index'), 10);
        var name = control.getAttribute('data-option-value');
        if (name === current.options[index]) return;
        var target = current.options.slice();
        target[index] = name;
        var next =
          findVariant(variants, target) ||
          firstSelectableVariant(variants, index, name);
        if (next) applyVariant(next, true);
      });
    });

    if (current && variants.length) {
      applyVariant(current, false);
    }
  }

  /* ---------- Reviews carousel (ReviewsCarousel.tsx) ---------- */

  function initReviews(root) {
    if (root.reviewsInitialised) return;
    root.reviewsInitialised = true;
    var viewport = root.querySelector('[data-reviews-viewport]');
    var template = root.querySelector('[data-reviews-slides]');
    if (!viewport || !template) return;
    var slides = toArray(template.content.children);
    var count = slides.length;
    if (count < 2) return;
    var dots = toArray(root.querySelectorAll('[data-reviews-dot]'));
    var index = 0;

    function show(next) {
      index = ((next % count) + count) % count;
      viewport.replaceChildren(document.importNode(slides[index], true));
      dots.forEach(function (dot, dotIndex) {
        var active = dotIndex === index;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    }

    var prev = root.querySelector('[data-reviews-prev]');
    var next = root.querySelector('[data-reviews-next]');
    if (prev) prev.addEventListener('click', function () { show(index - 1); });
    if (next) next.addEventListener('click', function () { show(index + 1); });
    dots.forEach(function (dot, dotIndex) {
      dot.addEventListener('click', function () { show(dotIndex); });
    });
  }

  /* ---------- Recommendations (RecommendedProducts.tsx) ---------- */

  function initRecommendations(section) {
    var url = section.getAttribute('data-url');
    if (!url || section.recommendationsLoading) return;
    section.recommendationsLoading = true;
    fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error(response.statusText);
        return response.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = doc.querySelector('[data-recommended]');
        if (fresh && fresh.querySelector('.product-card')) {
          section.replaceWith(document.importNode(fresh, true));
        } else {
          section.remove();
        }
      })
      .catch(function () {
        section.remove();
      });
  }

  /* ---------- Boot ---------- */

  function init(scope) {
    scope = scope || document;
    toArray(scope.querySelectorAll('[data-product-page]')).forEach(initProduct);
    toArray(scope.querySelectorAll('[data-reviews]')).forEach(initReviews);
    toArray(scope.querySelectorAll('[data-recommended][data-url]')).forEach(
      initRecommendations,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });
})();
