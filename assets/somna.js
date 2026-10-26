/*
 * Somna redesign: shared behaviour.
 *   form[data-somna-quick-add]  product-card "Quick Add": adds the variant to the
 *                               cart drawer through theme.cart (assets/theme.js);
 *                               without JS the form posts to /cart/add.
 *   .s-marquee                  press marquees get a pause/play toggle
 *                               (WCAG 2.2.2, moving content can be stopped).
 *   details[data-s-exclusive]   FAQ accordions open one item at a time.
 */
(function () {
  'use strict';

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-somna-quick-add')) return;
    var cart = window.theme && window.theme.cart;
    if (!cart || typeof cart.add !== 'function') return;
    event.preventDefault();
    var button = form.querySelector('[type="submit"]');
    var id = Number(form.elements.id.value);
    var quantity = Number((form.elements.quantity && form.elements.quantity.value) || 1);
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    Promise.resolve(cart.add({id: id, quantity: quantity}, {open: true})).finally(function () {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  });

  var PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4" height="16" rx="1.5"></rect><rect x="14" y="4" width="4" height="16" rx="1.5"></rect></svg>';
  var PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z"></path></svg>';

  function initMarquees(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.s-marquee'), function (marquee) {
      if (marquee.querySelector('.s-marquee__toggle')) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 's-marquee__toggle';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Pause scrolling logos');
      button.innerHTML = PAUSE;
      button.addEventListener('click', function () {
        var paused = !marquee.classList.contains('is-paused');
        marquee.classList.toggle('is-paused', paused);
        button.setAttribute('aria-pressed', paused ? 'true' : 'false');
        button.innerHTML = paused ? PLAY : PAUSE;
      });
      marquee.appendChild(button);
    });
  }

  /* One open item per accordion group: opening one closes its siblings.
     Native <details name> does this in new browsers; this covers the rest. */
  document.addEventListener('toggle', function (event) {
    var details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    var group = details.getAttribute('data-s-exclusive');
    if (!group) return;
    Array.prototype.forEach.call(document.querySelectorAll('details[data-s-exclusive="' + group + '"]'), function (other) {
      if (other !== details && other.open) other.open = false;
    });
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initMarquees(document); });
  } else {
    initMarquees(document);
  }
  document.addEventListener('shopify:section:load', function (event) { initMarquees(event.target); });
})();
