/*
 * Product page behaviour, ported from app/components/product/*.tsx,
 * ProductForm.tsx and AddToCartButton.tsx:
 * gallery, variant selection, pack tiers, quantity, add-on, add to cart,
 * savings note, reviews carousel and product recommendations; Somna
 * redesign: tier-total price row, free-gift progress, sticky add-to-cart
 * bar, review list (topic pills + load more) and the product video player.
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

  // Several product-page sections load this file; run it once.
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
    var slides = toArray(
      track.querySelectorAll('.gallery__slide, [data-gallery-slide]'),
    );
    var thumbStrip = root.querySelector('[data-gallery-thumbs]');
    var thumbs = thumbStrip
      ? toArray(
          thumbStrip.querySelectorAll('.gallery__thumb, [data-gallery-thumb]'),
        )
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
        // Stop a playing video once its slide is no longer shown.
        if (index !== active) {
          toArray(slide.querySelectorAll('video')).forEach(function (video) {
            if (!video.paused) video.pause();
          });
        }
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
        var input = label.querySelector('[data-pack-input], .pack-tier__input');
        return {
          label: label,
          input: input,
          quantity: parseInt(input.value, 10),
          name: label.getAttribute('data-pack-label') || '',
        };
      },
    );
    tiers.forEach(function (tier) {
      tier.input.addEventListener('change', function () {
        if (tier.input.checked) onChange(tier.quantity);
      });
    });

    return {
      labelFor: function (quantity) {
        for (var i = 0; i < tiers.length; i += 1) {
          if (tiers[i].quantity === quantity) return tiers[i].name;
        }
        return '';
      },
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
    var priceTag = form.querySelector('[data-add-to-cart-price]');
    if (!wrap || !button || !label || !status) return null;
    var busy = false;
    var idleLabel = label.textContent;
    var readyLabel = form.getAttribute('data-label') || 'Add to Cart';
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
        if (priceTag) priceTag.hidden = true;
      } else {
        button.removeAttribute('aria-busy');
        var old = button.querySelector('.btn__spinner');
        if (old) old.remove();
        label.textContent = idleLabel;
        if (priceTag) priceTag.hidden = !form.available;
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
        idleLabel = available ? readyLabel : 'Sold Out';
        if (!busy) {
          label.textContent = idleLabel;
          button.disabled = !available;
          if (priceTag) priceTag.hidden = !available;
        }
      },
      setTotal: function (cents) {
        if (priceTag) priceTag.textContent = ' · ' + money(cents);
      },
    };
  }

  /* ---------- Price row (Somna: total for the selected tier + save badge) ---------- */

  function initPrice(page) {
    var root = page.querySelector('[data-price]');
    if (!root) return null;
    var now = root.querySelector('[data-price-now]');
    var was = root.querySelector('[data-price-was]');
    var wasAmount = root.querySelector('[data-price-was-amount]');
    var save = root.querySelector('[data-price-save]');
    var multiply = root.getAttribute('data-price-multiply') === 'true';

    return function paint(variant, quantity) {
      var qty = multiply ? quantity : 1;
      var price = variant.price;
      var compare = variant.compare_at_price;
      var onSale = compare != null && compare > price;
      if (now) now.textContent = money(price * qty);
      if (was) was.hidden = !onSale;
      if (wasAmount) wasAmount.textContent = onSale ? moneyWithoutTrailingZeros(compare * qty) : '';
      if (save) {
        save.hidden = !onSale;
        if (onSale) {
          save.textContent =
            qty > 1
              ? 'Save ' + Math.round(((compare - price) * 100) / compare) + '%'
              : 'Save ' + moneyWithoutTrailingZeros(compare - price);
        }
      }
    };
  }

  /* ---------- Free-gift progress (Somna) ---------- */

  function initGift(page) {
    var root = page.querySelector('[data-gift]');
    if (!root) return null;
    var min = parseInt(root.getAttribute('data-gift-min'), 10) || 0;
    var locked = root.getAttribute('data-gift-locked') || '';
    var unlocked = root.getAttribute('data-gift-unlocked') || '';
    var label = root.querySelector('[data-gift-label]');
    var bar = root.querySelector('[data-gift-bar]');

    return function paint(quantity) {
      if (!min) return;
      var remaining = min - quantity;
      var text = remaining > 0 ? locked.replace('{remaining}', String(remaining)) : unlocked;
      var pct = remaining > 0 ? Math.floor((quantity * 100) / min) + 5 : 100;
      if (label && label.textContent !== text) label.textContent = text;
      if (bar) bar.style.width = Math.min(100, pct) + '%';
    };
  }

  /* ---------- Sticky add-to-cart bar (Somna) ---------- */

  function initSticky(page) {
    var bar = page.querySelector('[data-sticky-atc]');
    if (!bar) return null;
    var mode = bar.getAttribute('data-sticky-mode') || 'always';
    var button = bar.querySelector('[data-sticky-submit]');
    var label = bar.querySelector('[data-sticky-label]');
    var price = bar.querySelector('[data-sticky-price]');
    var summary = bar.querySelector('[data-sticky-summary]');
    var mainButton = page.querySelector('[data-add-to-cart-button]');
    var readyLabel = label ? label.textContent : '';
    var form = page.querySelector('[data-product-form]');
    if (form && form.getAttribute('data-label')) readyLabel = form.getAttribute('data-label');
    var mainVisible = false;
    var footerVisible = false;

    function show() {
      var visible = !footerVisible && (mode === 'always' || !mainVisible);
      bar.classList.toggle('is-visible', visible);
      document.documentElement.classList.toggle('sp-sticky-on', visible);
      if (visible) {
        bar.removeAttribute('aria-hidden');
        bar.removeAttribute('inert');
      } else {
        bar.setAttribute('aria-hidden', 'true');
        bar.setAttribute('inert', '');
      }
    }

    if ('IntersectionObserver' in window) {
      if (mainButton && mode !== 'always') {
        new IntersectionObserver(function (entries) {
          mainVisible = entries[entries.length - 1].isIntersecting;
          show();
        }).observe(mainButton);
      }
      var footer = document.querySelector('.shopify-section-group-footer-group, footer');
      if (footer) {
        new IntersectionObserver(function (entries) {
          footerVisible = entries[entries.length - 1].isIntersecting;
          show();
        }).observe(footer);
      }
    }
    show();

    return function paint(variant, total, summaryText) {
      var available = Boolean(variant && variant.available);
      if (button) button.disabled = !available;
      if (label) label.textContent = available ? readyLabel : 'Sold Out';
      if (price) {
        price.hidden = !available;
        price.textContent = ' · ' + money(total);
      }
      if (summary && summaryText != null) summary.textContent = summaryText;
    };
  }

  /* ---------- Product form wiring (ProductForm.tsx) ---------- */

  function initProduct(page) {
    if (page.productInitialised) return;
    page.productInitialised = true;

    var data = readProductJson(page);
    var variants = data && Array.isArray(data.variants) ? data.variants : [];
    var showOptions = !(data && data.hasOnlyDefaultVariant);
    var current = null;
    for (var i = 0; i < variants.length; i += 1) {
      if (data && variants[i].id === data.selectedVariantId) current = variants[i];
    }

    var galleryRoot = page.querySelector('[data-gallery]');
    var gallery = galleryRoot ? initGallery(galleryRoot) : null;
    var savings = page.querySelector('[data-savings-note]');
    if (savings) initSavingsNote(savings);

    var paintPrice = initPrice(page);
    var paintGift = initGift(page);
    var paintSticky = initSticky(page);

    var packTiersRoot = page.querySelector('[data-pack-tiers]');
    var quantityRoot = page.querySelector('[data-quantity]');
    var packTiers = null;
    var quantity = null;
    var addToCart = null;

    function currentQuantity() {
      return quantity ? quantity.get() : 1;
    }

    function paintTotals() {
      if (!current) return;
      var qty = currentQuantity();
      var total = current.price * qty;
      if (paintPrice) paintPrice(current, qty);
      if (paintGift) paintGift(qty);
      if (addToCart) addToCart.setTotal(total);
      if (paintSticky) {
        var parts = showOptions ? current.options.slice() : [];
        var tierName = packTiers ? packTiers.labelFor(qty) : '';
        if (tierName) parts.push(tierName);
        paintSticky(current, total, parts.join(' · '));
      }
    }

    if (quantityRoot) {
      quantity = initQuantity(quantityRoot, function (value) {
        if (packTiers) packTiers.sync(value);
        paintTotals();
      });
    }
    if (packTiersRoot) {
      packTiers = initPackTiers(packTiersRoot, function (value) {
        if (quantity) quantity.set(value);
        packTiers.sync(value);
        paintTotals();
      });
    }
    var addon = initAddon(page);

    var form = page.querySelector('[data-product-form]');
    var variantInput = form && form.querySelector('[data-variant-input]');
    addToCart = form
      ? initAddToCart(form, function () {
          if (!current || !current.available) return [];
          var lines = [{id: current.id, quantity: currentQuantity()}];
          var extra = addon && addon.line();
          if (extra) lines.push(extra);
          return lines;
        })
      : null;

    var options = toArray(page.querySelectorAll('[data-option-index]'));

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
      paintTotals();
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

  /* ---------- Review list: topic pills + "Load more reviews" (Somna) ---------- */

  function initReviewList(root) {
    if (root.reviewListInitialised) return;
    root.reviewListInitialised = true;
    var items = toArray(root.querySelectorAll('[data-review]'));
    var pageSize = parseInt(root.getAttribute('data-page-size'), 10) || 3;
    var more = root.querySelector('[data-reviews-more]');
    var empty = root.querySelector('[data-reviews-empty]');
    var pills = toArray(root.querySelectorAll('[data-review-filter]'));
    var filter = '';
    var shown = pageSize;

    function matches(item) {
      if (!filter) return true;
      return (item.getAttribute('data-review-tags') || '').indexOf(filter) !== -1;
    }

    function paint() {
      var matching = items.filter(matches);
      items.forEach(function (item) {
        item.hidden = matching.indexOf(item) === -1 || matching.indexOf(item) >= shown;
      });
      if (more) more.hidden = matching.length <= shown;
      if (empty) empty.hidden = matching.length > 0;
    }

    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        filter = pill.getAttribute('data-review-filter') || '';
        shown = pageSize;
        pills.forEach(function (other) {
          other.setAttribute('aria-pressed', other === pill ? 'true' : 'false');
        });
        paint();
      });
    });

    if (more) {
      more.addEventListener('click', function (event) {
        event.preventDefault();
        var firstHidden = items.filter(function (item) {
          return item.hidden && matches(item);
        })[0];
        shown += pageSize;
        paint();
        if (firstHidden) {
          var heading = firstHidden.querySelector('h3, p');
          firstHidden.setAttribute('tabindex', '-1');
          try {
            firstHidden.focus({preventScroll: true});
          } catch (error) {
            firstHidden.focus();
          }
          if (heading) heading.scrollIntoView({block: 'nearest', behavior: scrollBehavior()});
        }
      });
    }
    paint();
  }

  /* ---------- Product video: poster + play button (Somna) ---------- */

  function initVideo(root) {
    if (root.videoInitialised) return;
    root.videoInitialised = true;
    var button = root.querySelector('[data-video-play]');
    var template = root.querySelector('[data-video-template]');
    var frame = root.querySelector('[data-video-frame]');
    if (!button || !template || !frame) return;
    button.addEventListener('click', function () {
      frame.replaceChildren(document.importNode(template.content, true));
      frame.classList.add('is-playing');
      var video = frame.querySelector('video');
      if (video) {
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () {});
        video.focus();
      } else {
        var iframe = frame.querySelector('iframe');
        if (iframe) iframe.focus();
      }
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
        if (fresh && fresh.querySelector('[data-recommended-item], .product-card')) {
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
    toArray(scope.querySelectorAll('[data-review-list]')).forEach(initReviewList);
    toArray(scope.querySelectorAll('[data-product-video]')).forEach(initVideo);
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
