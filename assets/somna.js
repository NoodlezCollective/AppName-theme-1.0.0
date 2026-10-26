/*
 * Somna redesign: shared behaviour.
 *   form[data-somna-quick-add]  product-card "Quick Add": adds the variant to the
 *                               cart drawer through theme.cart (assets/theme.js);
 *                               without JS the form posts to /cart/add.
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
})();
