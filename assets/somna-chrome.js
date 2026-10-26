/*
 * Somna redesign: cart drawer recommendations panel (Header.dc.html).
 * Loaded by sections/cart-drawer.liquid.
 *
 *   [data-sc-tab]                 "You may also like" / "Recently viewed" tabs
 *   [data-sc-recs-list="like"]    swapped for the product recommendations of
 *                                 the first cart item: the cart-drawer section
 *                                 rendered by routes.product_recommendations_url
 *                                 (list marked data-source="recommendations")
 *   [data-sc-recs-list="recent"]  filled from the product handles stored in
 *                                 localStorage['somna:recently-viewed'] by
 *                                 sections/header.liquid; each card is the
 *                                 <template data-sc-current-card> of the
 *                                 cart-drawer section rendered on that product
 *
 * assets/theme.js replaces [data-cart-render="cart-drawer"] after each cart
 * change, so the panel state is re-applied on theme:cart:updated.
 */
(function () {
  'use strict';

  var STORE_KEY = 'somna:recently-viewed';
  var MAX_RECENT = 4;
  var state = {
    tab: 'like',
    like: {},
    likePending: {},
    recent: null,
    recentPending: false,
    lastAddId: null,
  };

  function drawerRoot() {
    return document.querySelector('[data-sc-cart-drawer]');
  }
  function region() {
    var root = drawerRoot();
    return root && root.querySelector('[data-cart-render="cart-drawer"]');
  }
  function parse(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }
  function wide() {
    return !window.matchMedia || window.matchMedia('(min-width: 820px)').matches;
  }
  function rootUrl() {
    var root = (window.theme && window.theme.routes && window.theme.routes.root) || '/';
    return root.charAt(root.length - 1) === '/' ? root : root + '/';
  }

  function syncLabels(list, reg) {
    var ids = (reg.getAttribute('data-cart-products') || '').split(',').filter(Boolean);
    Array.prototype.forEach.call(list.querySelectorAll('.sc-rec'), function (item) {
      var button = item.querySelector('button[type="submit"].sc-rec__add');
      if (!button) return;
      button.textContent = ids.indexOf(item.getAttribute('data-product-id')) > -1 ? 'Add another' : '+ Add to Bag';
    });
  }

  function fill(name, html) {
    var reg = region();
    if (!reg || !html) return;
    var list = reg.querySelector('[data-sc-recs-list="' + name + '"]');
    if (!list) return;
    list.innerHTML = html;
    syncLabels(list, reg);
  }

  function selectTab(name, focus) {
    var reg = region();
    if (!reg) return;
    state.tab = name;
    Array.prototype.forEach.call(reg.querySelectorAll('[data-sc-tab]'), function (tab) {
      var on = tab.getAttribute('data-sc-tab') === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    Array.prototype.forEach.call(reg.querySelectorAll('[data-sc-panel]'), function (panel) {
      panel.hidden = panel.getAttribute('data-sc-panel') !== name;
    });
    if (name === 'recent') loadRecent();
  }

  /* "You may also like": recommendations for the first cart item. */
  function loadLike() {
    var root = drawerRoot();
    var reg = region();
    if (!root || !reg || !wide()) return;
    var productId = reg.getAttribute('data-first-product');
    if (!productId) return;
    if (Object.prototype.hasOwnProperty.call(state.like, productId)) {
      fill('like', state.like[productId]);
      return;
    }
    if (state.likePending[productId]) return;
    state.likePending[productId] = true;
    var url =
      (root.getAttribute('data-recs-url') || '/recommendations/products') +
      '?section_id=' + encodeURIComponent(root.getAttribute('data-section-id')) +
      '&product_id=' + encodeURIComponent(productId) +
      '&limit=4&intent=related';
    fetch(url)
      .then(function (response) {
        return response.ok ? response.text() : '';
      })
      .then(function (text) {
        var list = text && parse(text).querySelector('[data-sc-recs-list="like"][data-source="recommendations"]');
        var html = list && list.querySelector('.sc-rec') ? list.innerHTML : '';
        state.like[productId] = html;
        var current = region();
        if (html && current && current.getAttribute('data-first-product') === productId) fill('like', html);
      })
      .catch(function () {
        state.like[productId] = '';
      })
      .then(function () {
        delete state.likePending[productId];
      });
  }

  /* "Recently viewed": product pages stored by the header. */
  function readHandles() {
    try {
      var list = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function loadRecent() {
    if (state.recent !== null) {
      fill('recent', state.recent);
      return;
    }
    if (state.recentPending || !wide()) return;
    var root = drawerRoot();
    if (!root) return;
    var current = root.querySelector('template[data-sc-current-card]');
    var currentHandle = current ? current.getAttribute('data-handle') : null;
    var handles = readHandles()
      .filter(function (handle) {
        return handle && handle !== currentHandle;
      })
      .slice(0, MAX_RECENT);
    if (!handles.length) {
      state.recent = '';
      return;
    }
    state.recentPending = true;
    var sectionId = encodeURIComponent(root.getAttribute('data-section-id'));
    Promise.all(
      handles.map(function (handle) {
        return fetch(rootUrl() + 'products/' + encodeURIComponent(handle) + '?section_id=' + sectionId)
          .then(function (response) {
            return response.ok ? response.text() : '';
          })
          .then(function (text) {
            var template = text && parse(text).querySelector('template[data-sc-current-card]');
            return template ? template.innerHTML : '';
          })
          .catch(function () {
            return '';
          });
      })
    ).then(function (cards) {
      state.recentPending = false;
      state.recent = cards.join('');
      fill('recent', state.recent);
    });
  }

  /* Re-apply the panel after theme.js swapped the drawer contents. */
  function reapply() {
    if (!region()) return;
    selectTab(state.tab, false);
    var reg = region();
    var productId = reg.getAttribute('data-first-product');
    if (productId && Object.prototype.hasOwnProperty.call(state.like, productId)) fill('like', state.like[productId]);
    else if (window.theme && window.theme.drawer && window.theme.drawer.isOpen('cart')) loadLike();
    if (state.recent) fill('recent', state.recent);
    if (state.lastAddId) {
      var active = document.activeElement;
      if (!active || active === document.body) {
        var target = document.getElementById(state.lastAddId);
        if (target) target.focus();
      }
      state.lastAddId = null;
    }
  }

  document.addEventListener('click', function (event) {
    var tab = event.target instanceof Element && event.target.closest('[data-sc-tab]');
    if (tab) selectTab(tab.getAttribute('data-sc-tab'), true);
  });

  document.addEventListener('keydown', function (event) {
    var tab = event.target instanceof Element && event.target.closest('[data-sc-tab]');
    if (!tab) return;
    var key = event.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    var tabs = Array.prototype.slice.call(tab.parentElement.querySelectorAll('[data-sc-tab]'));
    var index = tabs.indexOf(tab);
    if (key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
    else if (key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (key === 'Home') index = 0;
    else index = tabs.length - 1;
    event.preventDefault();
    selectTab(tabs[index].getAttribute('data-sc-tab'), true);
  });

  // Remember which recommendation button added to the cart so focus can
  // return to it once the drawer contents are re-rendered.
  document.addEventListener(
    'submit',
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-somna-quick-add')) return;
      if (!form.closest('[data-sc-cart-drawer]')) return;
      var button = event.submitter || form.querySelector('[type="submit"]');
      state.lastAddId = button && button.id ? button.id : null;
    },
    true
  );

  document.addEventListener('theme:drawer:open', function (event) {
    if (!event.detail || event.detail.name !== 'cart') return;
    loadLike();
    if (state.tab === 'recent') loadRecent();
  });

  document.addEventListener('theme:cart:updated', reapply);
})();
