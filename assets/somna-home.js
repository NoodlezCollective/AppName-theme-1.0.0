/*
 * Somna homepage behaviour (sections/somna-home-*.liquid). Markup is complete
 * from Liquid; this only adds interaction:
 * - sleep quiz: pill radio groups (arrow keys), Continue steps through the
 *   questions and finally follows the chosen answer's link
 * - brand film / customer videos: play inline from a <template>
 * - proof rings: arcs draw in when scrolled into view
 * - free gift banner: live progress on theme:cart:updated
 * Loaded (deferred) by several sections; runs once.
 */
(function () {
  'use strict';
  if (window.__somnaHome) return;
  window.__somnaHome = true;

  function reducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function each(root, selector, fn) {
    Array.prototype.forEach.call(root.querySelectorAll(selector), fn);
  }

  /* ---------- Sleep quiz ---------- */

  function quizSteps(quiz) {
    return Array.prototype.slice.call(quiz.querySelectorAll('[data-sh-quiz-step]'));
  }
  function currentStep(quiz) {
    var steps = quizSteps(quiz);
    for (var i = 0; i < steps.length; i++) if (!steps[i].hidden) return i;
    return 0;
  }
  function showStep(quiz, index, focus) {
    var steps = quizSteps(quiz);
    if (!steps.length) return;
    index = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach(function (step, i) { step.hidden = i !== index; });
    var next = quiz.querySelector('[data-sh-quiz-next]');
    if (next) {
      var last = index === steps.length - 1;
      var label = last ? next.getAttribute('data-finish-label') || next.getAttribute('data-label') : next.getAttribute('data-label');
      if (label) next.textContent = label;
    }
    if (focus) {
      var checked = steps[index].querySelector('[aria-checked="true"]') || steps[index].querySelector('[data-sh-quiz-option]');
      if (checked) checked.focus();
    }
  }
  function selectOption(option, focus) {
    var group = option.closest('[role="radiogroup"]');
    if (!group) return;
    each(group, '[data-sh-quiz-option]', function (o) {
      var on = o === option;
      o.setAttribute('aria-checked', on ? 'true' : 'false');
      o.tabIndex = on ? 0 : -1;
    });
    if (focus) option.focus();
  }
  function quizDestination(quiz, link) {
    var steps = quizSteps(quiz);
    for (var i = steps.length - 1; i >= 0; i--) {
      var chosen = steps[i].querySelector('[data-sh-quiz-option][aria-checked="true"]');
      var url = chosen && chosen.getAttribute('data-url');
      if (url) return url;
    }
    return link.getAttribute('data-results-url') || link.getAttribute('href');
  }
  function quizNext(link, event) {
    var quiz = link.closest('[data-sh-quiz]');
    if (!quiz) return;
    var steps = quizSteps(quiz);
    var index = currentStep(quiz);
    event.preventDefault();
    if (index < steps.length - 1) {
      showStep(quiz, index + 1, true);
    } else {
      window.location.href = quizDestination(quiz, link);
    }
  }
  function quizKeydown(event) {
    var option = event.target.closest && event.target.closest('[data-sh-quiz-option]');
    if (!option) return;
    var keys = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      selectOption(option, false);
      return;
    }
    if (!(event.key in keys)) return;
    event.preventDefault();
    var options = Array.prototype.slice.call(option.closest('[role="radiogroup"]').querySelectorAll('[data-sh-quiz-option]'));
    var i = (options.indexOf(option) + keys[event.key] + options.length) % options.length;
    selectOption(options[i], true);
  }

  /* ---------- Inline video ---------- */

  function playVideo(button) {
    var card = button.closest('[data-sh-video]');
    var template = card && card.querySelector('template[data-sh-video-player]');
    var source = template && template.content.firstElementChild;
    if (!source) return;
    var player = document.importNode(source, true);
    card.appendChild(player);
    button.remove();
    if (player.tagName === 'VIDEO') {
      player.setAttribute('tabindex', '-1');
      var p = player.play && player.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
    player.focus();
  }

  /* ---------- Proof rings ---------- */

  function initRings(root) {
    each(root, '[data-sh-rings]', function (wrap) {
      if (wrap.dataset.shReady) return;
      wrap.dataset.shReady = 'true';
      if (reducedMotion() || !('IntersectionObserver' in window)) return;
      var arcs = Array.prototype.slice.call(wrap.querySelectorAll('[data-sh-ring]'));
      if (!arcs.length) return;
      var full = 2 * Math.PI * 50;
      arcs.forEach(function (arc) { arc.setAttribute('stroke-dasharray', '0 ' + full.toFixed(1)); });
      var observer = new IntersectionObserver(function (entries) {
        if (!entries[0] || !entries[0].isIntersecting) return;
        observer.disconnect();
        var start = performance.now();
        var tick = function (now) {
          var t = Math.min(1, (now - start) / 1400);
          var eased = 1 - Math.pow(1 - t, 3);
          arcs.forEach(function (arc) {
            var dash = (Number(arc.getAttribute('data-dash')) || 0) * eased;
            arc.setAttribute('stroke-dasharray', dash.toFixed(1) + ' ' + full.toFixed(1));
          });
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, {threshold: 0.4});
      observer.observe(wrap);
    });
  }

  /* ---------- Free gift progress ---------- */

  function formatMoney(cents, format) {
    format = format || (window.theme && window.theme.moneyFormat) || '${{amount}}';
    var match = format.match(/\{\{\s*(\w+)\s*\}\}/);
    var kind = match ? match[1] : 'amount';
    function delimit(value, decimals, thousands, decimal) {
      var fixed = (value / 100).toFixed(decimals).split('.');
      var whole = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return whole + (fixed[1] ? decimal + fixed[1] : '');
    }
    var out;
    switch (kind) {
      case 'amount_no_decimals': out = delimit(cents, 0, ',', '.'); break;
      case 'amount_with_comma_separator': out = delimit(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': out = delimit(cents, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': out = delimit(cents, 2, "'", '.'); break;
      case 'amount_with_space_separator': out = delimit(cents, 2, ' ', ','); break;
      default: out = delimit(cents, 2, ',', '.');
    }
    return match ? format.replace(match[0], out) : out;
  }

  function updateGift(cart) {
    if (!cart || typeof cart.total_price !== 'number') return;
    each(document, '[data-sh-gift]', function (banner) {
      var threshold = Number(banner.getAttribute('data-threshold')) || 0;
      if (threshold <= 0) return;
      var total = cart.total_price;
      var remaining = Math.max(0, threshold - total);
      var pct = Math.min(100, (total / threshold) * 100);
      var fill = banner.querySelector('[data-sh-gift-fill]');
      var bar = banner.querySelector('[data-sh-gift-bar]');
      var status = banner.querySelector('[data-sh-gift-status]');
      if (fill) fill.style.width = pct.toFixed(1) + '%';
      if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (status) {
        status.textContent = remaining > 0
          ? (banner.getAttribute('data-progress-text') || '').replace('{remaining}', formatMoney(remaining))
          : banner.getAttribute('data-unlocked-text') || '';
      }
    });
  }

  /* ---------- Wiring ---------- */

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var option = target.closest('[data-sh-quiz-option]');
    if (option) { selectOption(option, false); return; }
    var next = target.closest('[data-sh-quiz-next]');
    if (next) { quizNext(next, event); return; }
    var play = target.closest('[data-sh-video-play]');
    if (play) { event.preventDefault(); playVideo(play); }
  });
  document.addEventListener('keydown', quizKeydown);

  document.addEventListener('theme:cart:updated', function (event) {
    updateGift(event.detail && event.detail.cart);
  });

  function init(root) { initRings(root); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }

  // Theme editor
  document.addEventListener('shopify:section:load', function (event) { init(event.target); });
  document.addEventListener('shopify:block:select', function (event) {
    var step = event.target.closest && event.target.closest('[data-sh-quiz-step]');
    var quiz = step && step.closest('[data-sh-quiz]');
    if (quiz) showStep(quiz, quizSteps(quiz).indexOf(step), false);
  });
})();
