/*
  Somna desktop dropdown menu (sections/header.liquid).
  Disclosure pattern: each [data-menu-item] holds the nav link, a chevron
  button[data-menu-toggle][aria-expanded][aria-controls] and its panel
  [data-menu-panel]. From 990px wide: hover (with a short intent / close
  delay) or the button opens a panel; Escape closes it and returns focus to
  the button; it also closes on focus-out, outside clicks, resize below
  990px and when a drawer opens. Styles: assets/somna-menu.css.
*/
(function () {
  'use strict';

  var DESKTOP = window.matchMedia('(min-width: 990px)');
  var OPEN_DELAY = 80;
  var CLOSE_DELAY = 220;

  function initMenu(nav) {
    if (!nav || nav.hasAttribute('data-menu-ready')) return;
    nav.setAttribute('data-menu-ready', '');

    var items = Array.prototype.slice.call(nav.querySelectorAll('[data-menu-item]'));
    var current = null;
    var openTimer = 0;
    var closeTimer = 0;

    function toggleOf(item) { return item.querySelector('[data-menu-toggle]'); }

    function clearTimers() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    }

    function open(item) {
      clearTimers();
      if (!DESKTOP.matches) return;
      if (current && current !== item) close(current);
      current = item;
      item.classList.add('is-open');
      toggleOf(item).setAttribute('aria-expanded', 'true');
    }

    function close(item, returnFocus) {
      if (!item) return;
      item.classList.remove('is-open');
      var toggle = toggleOf(item);
      toggle.setAttribute('aria-expanded', 'false');
      if (current === item) current = null;
      if (returnFocus) toggle.focus();
    }

    function closeAll() {
      clearTimers();
      items.forEach(function (item) { close(item); });
    }

    function firstFocusable(item) {
      var panel = item.querySelector('[data-menu-panel]');
      return panel && panel.querySelector('a[href], button:not([disabled])');
    }

    items.forEach(function (item) {
      var toggle = toggleOf(item);
      if (!toggle) return;

      toggle.addEventListener('click', function () {
        if (item.classList.contains('is-open')) close(item);
        else open(item);
      });

      toggle.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          open(item);
          var target = firstFocusable(item);
          if (target) target.focus();
        }
      });

      item.addEventListener('pointerenter', function (event) {
        if (event.pointerType !== 'mouse' || !DESKTOP.matches) return;
        clearTimers();
        if (current === item) return;
        // Switching between open panels is immediate; a fresh open waits a beat.
        if (current) open(item);
        else openTimer = setTimeout(function () { open(item); }, OPEN_DELAY);
      });

      item.addEventListener('pointerleave', function (event) {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(openTimer);
        if (current !== item) return;
        // Keep it open while keyboard focus is inside the panel.
        var panel = item.querySelector('[data-menu-panel]');
        if (panel && panel.contains(document.activeElement)) return;
        closeTimer = setTimeout(function () { close(item); }, CLOSE_DELAY);
      });

      item.addEventListener('focusout', function (event) {
        var next = event.relatedTarget;
        if (next && item.contains(next)) return;
        if (!next) {
          // Focus moved to nothing (e.g. a click on blank space): re-check next tick.
          setTimeout(function () {
            if (current === item && !item.contains(document.activeElement) && !item.matches(':hover')) close(item);
          }, 0);
          return;
        }
        close(item);
      });
    });

    nav.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      close(current, true);
    });

    document.addEventListener('click', function (event) {
      if (current && !current.contains(event.target)) closeAll();
    });

    var onChange = function () { if (!DESKTOP.matches) closeAll(); };
    if (DESKTOP.addEventListener) DESKTOP.addEventListener('change', onChange);
    else if (DESKTOP.addListener) DESKTOP.addListener(onChange);

    document.addEventListener('theme:drawer:open', closeAll);
    nav.somnaMenuClose = closeAll;
  }

  function initAll(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-somna-menu]'), initMenu);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initAll(); });
  else initAll();

  // Theme editor: re-bind when the header section is re-rendered.
  document.addEventListener('shopify:section:load', function (event) { initAll(event.target); });
})();
