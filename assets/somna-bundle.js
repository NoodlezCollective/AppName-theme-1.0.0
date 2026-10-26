/* Somna bundle builder (sections/somna-home-bundle.liquid).
 * Keeps the summary current as shoppers change picks, pillow quantity,
 * variants or the add-on, and adds every chosen variant to the cart in one
 * request through window.theme.cart.add (assets/theme.js). Savings are shown
 * only when the section's "Discount is live" setting is on (data-live).
 */
(function () {
  'use strict';

  function money(cents) {
    var theme = window.theme || {};
    if (typeof theme.money === 'function') return theme.money(cents, theme.moneyFormat);
    return '$' + (cents / 100).toFixed(2);
  }

  function int(value) {
    var n = parseInt(value, 10);
    return isNaN(n) ? 0 : n;
  }

  function init(root) {
    if (root.__sb) return;
    root.__sb = true;
    root.classList.add('sb--js');

    var form = root.querySelector('[data-sb-form]');
    var live = root.getAttribute('data-live') === 'true';
    var ready = root.getAttribute('data-ready') === 'true';
    var d2 = int(root.getAttribute('data-d2'));
    var d3 = int(root.getAttribute('data-d3'));
    var hintTemplate = root.getAttribute('data-hint') || '';
    var linesEl = root.querySelector('[data-sb-lines]');
    var countEl = root.querySelector('[data-sb-count]');
    var pctEl = root.querySelector('[data-sb-pct]');
    var discountEl = root.querySelector('[data-sb-discount]');
    var wasEl = root.querySelector('[data-sb-was]');
    var totalEl = root.querySelector('[data-sb-total]');
    var saveEl = root.querySelector('[data-sb-save]');
    var hintEl = root.querySelector('[data-sb-hint]');
    var submit = root.querySelector('[data-sb-submit]');
    var msg = root.querySelector('[data-sb-msg]');
    var addon = root.querySelector('[data-sb-addon]');

    function picked(step) {
      return root.querySelector('[data-sb-step="' + step + '"] [data-sb-input]:checked');
    }

    function qty() {
      var q = root.querySelector('[data-sb-qty]:checked');
      return q ? int(q.value) || 1 : 1;
    }

    function pctFor(count) {
      if (count >= 3) return d3;
      if (count >= 2) return d2;
      return 0;
    }

    /* Show the variant picker on the picked card only. */
    function syncCards() {
      Array.prototype.forEach.call(root.querySelectorAll('[data-sb-opt]'), function (opt) {
        var input = opt.querySelector('[data-sb-input], [data-sb-addon]');
        var on = !!(input && input.checked);
        opt.classList.toggle('is-picked', on);
        var wrap = opt.querySelector('[data-sb-variant-wrap]');
        if (wrap) wrap.hidden = !on;
      });
    }

    function line(input, quantity) {
      return {
        id: int(input.value),
        quantity: quantity,
        title: input.getAttribute('data-title') || '',
        variant: input.getAttribute('data-variant') || '',
        price: int(input.getAttribute('data-price')),
      };
    }

    function selection() {
      var items = [];
      var pillow = picked('pillow');
      var comforter = picked('comforter');
      if (pillow) items.push(line(pillow, qty()));
      if (comforter) items.push(line(comforter, 1));
      if (addon && addon.checked && addon.value) items.push(line(addon, 1));
      return items;
    }

    function renderLines(items) {
      if (!linesEl) return;
      linesEl.textContent = '';
      items.forEach(function (item) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'sb-sum__name';
        name.textContent = item.title + (item.quantity > 1 ? ' × ' + item.quantity : '');
        if (item.variant) {
          var small = document.createElement('small');
          small.textContent = item.variant;
          name.appendChild(small);
        }
        var price = document.createElement('span');
        price.textContent = money(item.price * item.quantity);
        li.appendChild(name);
        li.appendChild(price);
        linesEl.appendChild(li);
      });
    }

    function update() {
      syncCards();
      if (!ready) return;
      var items = selection();
      var count = 0;
      var subtotal = 0;
      items.forEach(function (item) {
        count += item.quantity;
        subtotal += item.price * item.quantity;
      });
      var pct = pctFor(count);
      var savings = Math.round((subtotal * pct) / 100);
      var total = live ? subtotal - savings : subtotal;

      renderLines(items);
      if (countEl) countEl.textContent = count + (count === 1 ? ' item' : ' items');
      if (pctEl) pctEl.textContent = '−' + pct + '%';
      if (discountEl) discountEl.textContent = '−' + money(savings);
      if (wasEl) {
        wasEl.hidden = !(live && savings > 0);
        wasEl.lastChild.textContent = money(subtotal);
      }
      if (totalEl) totalEl.textContent = money(total);
      if (saveEl) {
        saveEl.hidden = !(live && savings > 0);
        saveEl.textContent = 'You save ' + money(savings);
      }
      if (hintEl) {
        var next = count < 3 && d3 > pct ? d3 : 0;
        hintEl.hidden = !(live && next);
        hintEl.textContent = next ? hintTemplate.replace('{pct}', next) : '';
      }

      /* Keep the no-JS fallback fields in step, in case the native form posts. */
      var pillow = picked('pillow');
      var comforter = picked('comforter');
      var f = function (name) { return form.querySelector('[data-sb-field="' + name + '"]'); };
      if (pillow && f('pillow')) f('pillow').value = pillow.value;
      if (f('pillow-qty')) f('pillow-qty').value = qty();
      if (comforter && f('comforter')) f('comforter').value = comforter.value;
      if (submit) submit.disabled = !(pillow && comforter);
    }

    root.addEventListener('change', function (event) {
      var target = event.target;
      if (target.matches('[data-sb-variant]')) {
        var opt = target.closest('[data-sb-opt]');
        var input = opt && opt.querySelector('[data-sb-input]');
        var option = target.options[target.selectedIndex];
        if (input && option) {
          input.value = option.value;
          input.setAttribute('data-price', option.getAttribute('data-price'));
          input.setAttribute('data-variant', option.getAttribute('data-label') || '');
          var cardPrice = opt.querySelector('[data-sb-card-price]');
          if (cardPrice) cardPrice.textContent = money(int(option.getAttribute('data-price')));
        }
      }
      if (msg) msg.textContent = '';
      update();
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        var cart = window.theme && window.theme.cart;
        if (!cart || typeof cart.add !== 'function') return; // native POST fallback
        event.preventDefault();
        var items = selection().filter(function (item) { return item.id; });
        if (!items.length) return;
        var label = submit ? submit.textContent : '';
        if (submit) {
          submit.disabled = true;
          submit.setAttribute('aria-busy', 'true');
          submit.textContent = 'Adding…';
        }
        cart
          .add(items.map(function (item) { return {id: item.id, quantity: item.quantity}; }), {open: true})
          .then(function () {
            if (msg) msg.textContent = 'Bundle added to your cart.';
          })
          .catch(function (error) {
            if (msg) msg.textContent = (error && error.message) || 'The bundle could not be added. Please try again.';
          })
          .then(function () {
            if (submit) {
              submit.disabled = false;
              submit.removeAttribute('aria-busy');
              submit.textContent = label;
            }
          });
      });
    }

    /* Summary labels follow the select's size-first wording. */
    Array.prototype.forEach.call(root.querySelectorAll('[data-sb-variant]'), function (select) {
      var input = select.closest('[data-sb-opt]').querySelector('[data-sb-input]');
      var option = select.options[select.selectedIndex];
      if (input && option) input.setAttribute('data-variant', option.getAttribute('data-label') || '');
    });

    update();
  }

  function initAll(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('[data-sb]'), init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(document); });
  } else {
    initAll(document);
  }
  document.addEventListener('shopify:section:load', function (event) { initAll(event.target); });
})();
