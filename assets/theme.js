/*
  Core theme script (PORTING.md section 8). Vanilla JS, no build step, loaded
  with `defer` from layout/theme.liquid after `window.theme.routes`,
  `window.theme.moneyFormat` and `window.theme.brandName` are set.

  Public API
    theme.drawer.open(name) / theme.drawer.close() / theme.drawer.toggle(name)
    theme.drawer.isOpen(name) / theme.drawer.current
    theme.cart.add(items, {open})      POST routes.cart_add_url
    theme.cart.change(line, quantity)  POST routes.cart_change_url (line key or 1-based index)
    theme.cart.update(payload)         POST routes.cart_update_url ({updates}, {note}, {discount}, …)
    theme.cart.fetch()                 GET  /cart.js
    theme.cart.refresh()               re-render every [data-cart-render] section
    theme.cart.applySections(sections) swap [data-cart-render] elements from a Section Rendering API payload
    theme.money(cents, format?)        formats with window.theme.moneyFormat

  Markup hooks
    [data-drawer-open="cart|search|mobile"], [data-drawer-close]
    .overlay[data-drawer="…"] (+ .expanded while open)
    [data-cart-render="<section file>"]   element replaced after each cart change
    [data-cart-toggle][data-cart-count]   header cart link; .cart-toggle__count pulses (is-pulsing, 2.4s)
    [data-cart-main="aside|page"]         cart section root (focus management after a removal)
    [data-cart-line="<line key>"] li with form[data-cart-line-form] + [data-cart-line-action="decrease|increase|remove"]
    [data-cart-line-quantity]             the quantity readout inside a line
    [data-cart-discount-form][data-applied-codes], [data-cart-discount-messages]
    [data-cart-gift-card-form], [data-cart-gift-card-messages]
    [data-predictive-search-form], [data-predictive-search-input], [data-predictive-search-submit]
    [data-announcement-bar] [data-marquee-toggle]

  Events (on document)
    theme:drawer:open   {name, overlay}
    theme:drawer:close  {name, overlay}
    theme:cart:updated  {cart, sections}   cart = /cart.js JSON
    theme:cart:error    {error}
*/
(function () {
  'use strict';

  var theme = (window.theme = window.theme || {});
  var routes = theme.routes || {};

  var PULSE_DURATION = 2400;
  var PAGE_REGIONS = '.announcement-bar, .site-header, #main-content, .site-footer';
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  var DEFAULT_SECTIONS = ['cart-drawer', 'header'];

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }
  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, {detail: detail || {}}));
  }
  function withJs(url, fallback) {
    url = url || fallback;
    return /\.js$/.test(url) ? url : url + '.js';
  }
  /* The section id of the .shopify-section wrapper around `element`. */
  function sectionIdOf(element) {
    var wrapper = element && element.closest('.shopify-section');
    return wrapper && wrapper.id ? wrapper.id.replace(/^shopify-section-/, '') : null;
  }
  function getFocusable(root) {
    return qsa(FOCUSABLE, root).filter(function (element) {
      return element.offsetParent !== null || element === document.activeElement;
    });
  }

  /* ---------- Money ---------- */

  function formatWithDelimiters(number, precision, thousands, decimal) {
    if (isNaN(number) || number === null) return '0';
    var fixed = (number / 100).toFixed(precision);
    var parts = fixed.split('.');
    var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
    var fraction = parts[1] ? decimal + parts[1] : '';
    return whole + fraction;
  }

  theme.money = function (cents, format) {
    var template = format || theme.moneyFormat || '${{amount}}';
    if (typeof cents === 'string') cents = parseFloat(cents.replace(/[^0-9.-]/g, '')) * 100;
    cents = Number(cents) || 0;
    var match = /\{\{\s*(\w+)\s*\}\}/.exec(template);
    var type = match ? match[1] : 'amount';
    var value;
    switch (type) {
      case 'amount_no_decimals':
        value = formatWithDelimiters(cents, 0, ',', '.');
        break;
      case 'amount_with_comma_separator':
        value = formatWithDelimiters(cents, 2, '.', ',');
        break;
      case 'amount_no_decimals_with_comma_separator':
        value = formatWithDelimiters(cents, 0, '.', ',');
        break;
      case 'amount_with_apostrophe_separator':
        value = formatWithDelimiters(cents, 2, "'", '.');
        break;
      case 'amount_no_decimals_with_space_separator':
        value = formatWithDelimiters(cents, 0, ' ', '');
        break;
      case 'amount_with_space_separator':
        value = formatWithDelimiters(cents, 2, ' ', ',');
        break;
      case 'amount_with_period_and_space_separator':
        value = formatWithDelimiters(cents, 2, ' ', '.');
        break;
      default:
        value = formatWithDelimiters(cents, 2, ',', '.');
    }
    return template.replace(/\{\{\s*\w+\s*\}\}/, value);
  };

  /* ---------- Drawers (app/components/Aside.tsx + lib/useModalDialog.ts) ---------- */

  function setMobileToggle(expanded) {
    qsa('.site-header__mobile-toggle').forEach(function (button) {
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  var drawer = {
    current: null,
    overlay: null,
    opener: null,
    inerted: [],
    keydownHandler: null,
    frame: 0,

    isOpen: function (name) {
      return name ? drawer.current === name : drawer.current !== null;
    },

    open: function (name) {
      var overlay = qs('.overlay[data-drawer="' + name + '"]');
      if (!overlay) return false;
      if (drawer.overlay === overlay) return true;

      var previousOpener = null;
      if (drawer.overlay) {
        previousOpener = drawer.opener;
        drawer.close();
      }
      var active = document.activeElement;
      drawer.opener = active && active !== document.body ? active : previousOpener;
      drawer.current = name;
      drawer.overlay = overlay;

      overlay.classList.add('expanded');
      overlay.setAttribute('aria-hidden', 'false');

      drawer.inerted = qsa(PAGE_REGIONS).filter(function (element) {
        return !element.hasAttribute('inert');
      });
      drawer.inerted.forEach(function (element) {
        element.setAttribute('inert', '');
      });
      setMobileToggle(name === 'mobile');

      var dialog = qs('.drawer', overlay) || overlay;
      var closeButton = qs('.drawer__close', dialog);

      var focusInitial = function () {
        (closeButton || getFocusable(dialog)[0] || dialog).focus();
        return dialog.contains(document.activeElement);
      };

      // The drawer only becomes visible once its CSS transition starts, so
      // retry on successive frames until the focus sticks.
      var attempts = 0;
      cancelAnimationFrame(drawer.frame);
      drawer.frame = requestAnimationFrame(function tryFocus() {
        if (!focusInitial() && attempts++ < 10) {
          drawer.frame = requestAnimationFrame(tryFocus);
        }
      });

      drawer.keydownHandler = function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          drawer.close();
          return;
        }
        if (event.key !== 'Tab') return;
        var focusable = getFocusable(dialog);
        if (!focusable.length) {
          event.preventDefault();
          focusInitial();
          return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        var current = document.activeElement;
        var inside = current && dialog.contains(current);
        if (event.shiftKey && (!inside || current === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (!inside || current === last)) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', drawer.keydownHandler);

      dispatch('theme:drawer:open', {name: name, overlay: overlay});
      return true;
    },

    close: function () {
      if (!drawer.overlay) return;
      var overlay = drawer.overlay;
      var name = drawer.current;
      var opener = drawer.opener;

      overlay.classList.remove('expanded');
      overlay.setAttribute('aria-hidden', 'true');
      if (drawer.keydownHandler) document.removeEventListener('keydown', drawer.keydownHandler);
      cancelAnimationFrame(drawer.frame);
      drawer.inerted.forEach(function (element) {
        element.removeAttribute('inert');
      });
      drawer.inerted = [];
      drawer.keydownHandler = null;
      drawer.overlay = null;
      drawer.current = null;
      drawer.opener = null;
      setMobileToggle(false);

      if (opener && document.contains(opener)) opener.focus();
      dispatch('theme:drawer:close', {name: name, overlay: overlay});
    },

    toggle: function (name) {
      if (drawer.isOpen(name)) drawer.close();
      else drawer.open(name);
    },
  };
  theme.drawer = drawer;

  /* ---------- Cart (app/lib/cart/*, Header.tsx useCartPulse, CartMain.tsx) ---------- */

  var toggleAtStart = qs('[data-cart-toggle]');
  var cart = {
    count: toggleAtStart ? parseInt(toggleAtStart.getAttribute('data-cart-count'), 10) || 0 : 0,
    pulseTimer: 0,
    pulseUntil: 0,
    removed: null,
    queue: Promise.resolve(),

    /*
      Sections re-rendered after a cart change: every [data-cart-render]
      element's section file, plus the section wrapper (#shopify-section-<id>)
      of any cart section that has no such hook (the cart page), so it is
      re-rendered by its template section id.
    */
    sectionIds: function () {
      var ids = [];
      qsa('[data-cart-render]').forEach(function (element) {
        var id = element.getAttribute('data-cart-render');
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
      if (!ids.length) ids = DEFAULT_SECTIONS.slice();
      qsa('.cart, [data-cart-main]').forEach(function (element) {
        if (element.closest('[data-cart-render]')) return;
        var id = sectionIdOf(element);
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
      return ids;
    },

    enqueue: function (task) {
      var run = cart.queue.then(task, task);
      cart.queue = run.catch(function () {});
      return run;
    },

    request: function (url, payload) {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/javascript',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            var error = new Error(data.description || data.message || 'The cart could not be updated.');
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
    },

    fetch: function () {
      return fetch(withJs(routes.cart, '/cart'), {
        headers: {Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
      }).then(function (response) {
        return response.json();
      });
    },

    add: function (items, options) {
      options = options || {};
      var list = Array.isArray(items) ? items : [items];
      var payload = {
        items: list.map(function (item) {
          var line = {id: item.id, quantity: item.quantity || 1};
          if (item.properties) line.properties = item.properties;
          if (item.selling_plan) line.selling_plan = item.selling_plan;
          return line;
        }),
        sections: cart.sectionIds().join(','),
        sections_url: window.location.pathname,
      };
      return cart.enqueue(function () {
        return cart
          .request(withJs(routes.cartAdd, '/cart/add'), payload)
          .then(function (data) {
            return cart.fetch().then(function (cartJson) {
              cart.applySections(data.sections);
              cart.afterChange(cartJson, data.sections);
              if (options.open) drawer.open('cart');
              return cartJson;
            });
          })
          .catch(cart.fail);
      });
    },

    change: function (line, quantity, options) {
      options = options || {};
      var payload = {
        quantity: quantity,
        sections: cart.sectionIds().join(','),
        sections_url: window.location.pathname,
      };
      if (typeof line === 'number') payload.line = line;
      else payload.id = line;
      return cart.enqueue(function () {
        return cart
          .request(withJs(routes.cartChange, '/cart/change'), payload)
          .then(function (data) {
            cart.applySections(data.sections);
            cart.afterChange(data, data.sections);
            if (options.open) drawer.open('cart');
            return data;
          })
          .catch(cart.fail);
      });
    },

    update: function (payload, options) {
      options = options || {};
      var body = Object.assign({}, payload || {}, {
        sections: cart.sectionIds().join(','),
        sections_url: window.location.pathname,
      });
      return cart.enqueue(function () {
        return cart
          .request(withJs(routes.cartUpdate, '/cart/update'), body)
          .then(function (data) {
            cart.applySections(data.sections);
            cart.afterChange(data, data.sections);
            if (options.open) drawer.open('cart');
            return data;
          })
          .catch(cart.fail);
      });
    },

    refresh: function () {
      var ids = cart.sectionIds();
      var url = window.location.pathname + '?sections=' + encodeURIComponent(ids.join(','));
      return fetch(url, {headers: {Accept: 'application/json'}})
        .then(function (response) {
          return response.json();
        })
        .then(function (sections) {
          cart.applySections(sections);
          return cart.fetch();
        })
        .then(function (cartJson) {
          cart.afterChange(cartJson, null);
          return cartJson;
        });
    },

    fail: function (error) {
      dispatch('theme:cart:error', {error: error});
      throw error;
    },

    /* Swap every [data-cart-render] element for its freshly rendered copy. */
    applySections: function (sections) {
      if (!sections) return;
      var active = document.activeElement;
      var focus = null;
      if (active && active !== document.body && active.closest('[data-cart-render]')) {
        var line = active.closest('[data-cart-line]');
        focus = {
          id: active.id,
          lineKey: line ? line.getAttribute('data-cart-line') : null,
          action: active.getAttribute('data-cart-line-action'),
        };
      }
      var parser = new DOMParser();
      Object.keys(sections).forEach(function (id) {
        var html = sections[id];
        if (!html) return;
        var doc = parser.parseFromString(html, 'text/html');
        var replacement = qs('[data-cart-render="' + id + '"]', doc);
        if (replacement) {
          qsa('[data-cart-render="' + id + '"]').forEach(function (target) {
            var copy = replacement.cloneNode(true);
            if (cart.pulseUntil > Date.now()) {
              var count = qs('.cart-toggle__count', copy);
              if (count) count.classList.add('is-pulsing');
            }
            target.replaceWith(copy);
          });
          return;
        }
        // A section without a hook (the cart page): swap the wrapper's content.
        var wrapper = document.getElementById('shopify-section-' + id);
        var rendered = doc.getElementById('shopify-section-' + id);
        if (wrapper && rendered) wrapper.innerHTML = rendered.innerHTML;
      });
      cart.restoreFocus(focus);
    },

    restoreFocus: function (focus) {
      var current = document.activeElement;
      if (current && current !== document.body) return; // the shopper moved on
      var target = null;
      if (cart.removed) {
        // The focused "remove" button disappeared with its line: move focus to
        // the remove button of the line that took its place, the one before it
        // when the last line was removed, or the heading of the empty cart.
        var scope =
          (cart.removed.scope && qs('[data-cart-main="' + cart.removed.scope + '"]')) ||
          (cart.removed.sectionId && document.getElementById('shopify-section-' + cart.removed.sectionId)) ||
          qs('.cart');
        if (scope) {
          var buttons = qsa('.cart-lines > .cart-line > .cart-line__body .cart-line__remove', scope);
          target = buttons.length
            ? buttons[Math.min(cart.removed.index, buttons.length - 1)]
            : qs('.cart__empty .empty-state__title', scope);
        }
        cart.removed = null;
      } else if (focus) {
        if (focus.lineKey && focus.action) {
          target = qs('[data-cart-line="' + focus.lineKey + '"] [data-cart-line-action="' + focus.action + '"]');
        }
        if (!target && focus.id) target = document.getElementById(focus.id);
      }
      if (target) target.focus();
    },

    afterChange: function (cartJson, sections) {
      var count = cartJson && typeof cartJson.item_count === 'number' ? cartJson.item_count : cart.count;
      if (count > cart.count) cart.pulse();
      cart.count = count;
      qsa('[data-cart-toggle]').forEach(function (toggle) {
        toggle.setAttribute('data-cart-count', String(count));
      });
      dispatch('theme:cart:updated', {cart: cartJson, sections: sections || null});
    },

    /* Flashes the count bubble for 2.4s whenever the count grows (Header.tsx). */
    pulse: function () {
      cart.pulseUntil = Date.now() + PULSE_DURATION;
      qsa('.cart-toggle__count').forEach(function (count) {
        count.classList.remove('is-pulsing');
        void count.offsetWidth; // restart the animation
        count.classList.add('is-pulsing');
      });
      clearTimeout(cart.pulseTimer);
      cart.pulseTimer = setTimeout(function () {
        cart.pulseUntil = 0;
        qsa('.cart-toggle__count').forEach(function (count) {
          count.classList.remove('is-pulsing');
        });
      }, PULSE_DURATION);
    },
  };
  theme.cart = cart;

  /* Quantity +/- and remove (app/components/CartLineItem.tsx), optimistic. */
  function changeLine(button) {
    var form = button.closest('form[data-cart-line-form]');
    if (!form) return;
    if (button.getAttribute('aria-disabled') === 'true' || button.disabled) return;
    var item = button.closest('[data-cart-line]');
    var idInput = qs('input[name="id"]', form);
    var quantityInput = qs('input[name="quantity"]', form);
    var key = (idInput && idInput.value) || (item && item.getAttribute('data-cart-line'));
    var quantity = parseInt(button.value || (quantityInput && quantityInput.value), 10);
    var action = button.getAttribute('data-cart-line-action');
    if (!key || isNaN(quantity)) return;
    if (action === 'remove') quantity = 0;

    if (item) {
      item.classList.add('is-optimistic');
      if (quantity === 0) {
        var main = item.closest('[data-cart-main]');
        var rootLines = qsa('.cart-lines > .cart-line', item.closest('.cart') || document);
        cart.removed = {
          index: Math.max(0, rootLines.indexOf(item)),
          scope: main ? main.getAttribute('data-cart-main') : null,
          sectionId: sectionIdOf(item),
        };
        item.remove();
      } else {
        var readout = qs('[data-cart-line-quantity]', item);
        if (readout && readout.lastChild && readout.lastChild.nodeType === 3) {
          readout.lastChild.nodeValue = String(quantity);
        }
        item.setAttribute('data-line-quantity', String(quantity));
        var decrease = qs('[data-cart-line-action="decrease"]', item);
        if (decrease) {
          if (quantity <= 1) decrease.setAttribute('aria-disabled', 'true');
          else decrease.removeAttribute('aria-disabled');
        }
      }
    }

    cart.change(key, quantity).catch(function () {
      cart.removed = null;
      cart.refresh().catch(function () {});
    });
  }

  function showMessages(container, messages, tone) {
    if (!container) return;
    container.innerHTML = '';
    messages.forEach(function (message) {
      var p = document.createElement('p');
      p.className = tone && tone !== 'info' ? 'form-message form-message--' + tone : 'form-message';
      p.textContent = message;
      container.appendChild(p);
    });
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.classList.toggle('is-loading', loading);
    if (loading) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  /* Discount codes (CartSummary.tsx CartDiscounts) through /cart/update.js. */
  function submitDiscount(form) {
    var input = qs('input[name="discount"]:not([type="hidden"])', form);
    var applied = (form.getAttribute('data-applied-codes') || '').split(',').filter(Boolean);
    var codes;
    var newCode = null;
    if (input) {
      newCode = input.value.trim();
      if (!newCode) return;
      codes = applied.filter(function (code) {
        return code.toUpperCase() !== newCode.toUpperCase();
      });
      codes.push(newCode);
    } else {
      var hidden = qs('input[name="discount"]', form);
      codes = ((hidden && hidden.value) || '').split(',').filter(Boolean);
    }
    var button = qs('button[type="submit"]', form);
    setLoading(button, true);
    cart
      .update({discount: codes.join(',')})
      .then(function (data) {
        if (!newCode) return;
        var rejected = (data.discount_codes || [])
          .filter(function (code) {
            return !code.applicable;
          })
          .map(function (code) {
            return code.code;
          });
        var messages = rejected.map(function (code) {
          return '“' + code + '” isn’t a valid discount code.';
        });
        qsa('[data-cart-discount-messages]').forEach(function (container) {
          showMessages(container, messages, 'error');
        });
        if (messages.length) {
          var panel = qs('[data-cart-discount-messages]');
          var details = panel && panel.closest('details');
          if (details) details.open = true;
        }
      })
      .catch(function (error) {
        setLoading(button, false);
        showMessages(qs('[data-cart-discount-messages]', form.parentElement), [error.message], 'error');
      });
  }

  /* ---------- Global listeners ---------- */

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    var opener = target.closest('[data-drawer-open]');
    if (opener) {
      // Only a plain primary click on a link opens the drawer; modifier clicks
      // keep the browser's "open in a new tab or window" (Header.tsx CartBadge).
      if (
        opener.tagName === 'A' &&
        (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      ) {
        return;
      }
      event.preventDefault();
      drawer.open(opener.getAttribute('data-drawer-open'));
      return;
    }

    var closer = target.closest('[data-drawer-close]');
    if (closer) {
      if (closer.tagName !== 'A') event.preventDefault();
      drawer.close();
      return;
    }

    var lineButton = target.closest('[data-cart-line-action]');
    if (lineButton && lineButton.closest('form[data-cart-line-form]')) {
      event.preventDefault();
      changeLine(lineButton);
      return;
    }

    var searchButton = target.closest('[data-predictive-search-submit]');
    if (searchButton) {
      event.preventDefault();
      var form = searchButton.closest('form');
      var input = form && qs('[data-predictive-search-input], input[name="q"]', form);
      var term = input ? input.value.trim() : '';
      window.location.href = (routes.search || '/search') + (term ? '?q=' + encodeURIComponent(term) : '');
      return;
    }

    var marqueeToggle = target.closest('[data-marquee-toggle]');
    if (marqueeToggle) {
      var bar = marqueeToggle.closest('[data-announcement-bar]') || marqueeToggle.parentElement;
      var marquee = bar && qs('.marquee', bar);
      if (!marquee) return;
      var paused = !marquee.classList.contains('marquee--paused');
      marquee.classList.toggle('marquee--paused', paused);
      marqueeToggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
      marqueeToggle.innerHTML = paused ? PLAY_GLYPH : PAUSE_GLYPH;
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.hasAttribute('data-cart-line-form')) {
      event.preventDefault();
      var submitter = event.submitter || qs('[data-cart-line-action]', form);
      if (submitter) changeLine(submitter);
      return;
    }

    if (form.hasAttribute('data-cart-discount-form')) {
      event.preventDefault();
      submitDiscount(form);
      return;
    }

    if (form.hasAttribute('data-cart-gift-card-form')) {
      // Gift cards are redeemed at checkout in Shopify's Online Store.
      event.preventDefault();
      var giftInput = qs('input', form);
      if (giftInput && !giftInput.value.trim()) return;
      showMessages(qs('[data-cart-gift-card-messages]', form.parentElement), ['Enter your gift card at checkout to apply it.'], 'info');
      return;
    }

    if (form.hasAttribute('data-predictive-search-form')) {
      // Enter opens the full results for the typed term; an empty input does nothing.
      var q = qs('[data-predictive-search-input], input[name="q"]', form);
      if (!q || !q.value.trim()) event.preventDefault();
    }
  });

  /* Pages restored from the back/forward cache show the cart as it was. */
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) cart.refresh().catch(function () {});
  });

  var PAUSE_GLYPH =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="5" y="4" width="5" height="16" rx="1.5"></rect><rect x="14" y="4" width="5" height="16" rx="1.5"></rect></svg>';
  var PLAY_GLYPH =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z"></path></svg>';

  dispatch('theme:ready', {});
})();
