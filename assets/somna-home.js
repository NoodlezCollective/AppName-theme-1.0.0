/*
 * Somna homepage behaviour (sections/somna-home-*.liquid). Markup is complete
 * from Liquid; this only adds interaction:
 * - sleep quiz: pill radio groups (arrow keys), Continue steps through the
 *   questions and finally follows the chosen answer's link
 * - brand film / customer videos: play inline from a <template>
 * - proof rings: arcs draw in when scrolled into view
 * - free gift banner: live progress on theme:cart:updated
 * - phones: swipe rows get dots, the comparison table starts collapsed and a
 *   sticky buy bar appears once the hero buttons scroll away
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

  /* ---------- Mobile: swipe rows with dots ---------- */

  var MOBILE = '(max-width: 749px)';
  function isMobile() {
    return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE).matches;
  }
  function slidesOf(row) {
    var slides = [];
    Array.prototype.forEach.call(row.children, function (child) {
      // Bestseller blocks wrap each card in a display: contents element.
      if (child.style && child.style.display === 'contents') {
        Array.prototype.forEach.call(child.children, function (c) { slides.push(c); });
      } else {
        slides.push(child);
      }
    });
    return slides;
  }
  function initSwipe(row) {
    if (row.__shSwipe) return;
    row.__shSwipe = true;
    var slides = slidesOf(row);
    if (slides.length < 2) return;
    var dots = document.createElement('div');
    dots.className = 'sh-dots';
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Choose slide');
    slides.forEach(function (slide, index) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sh-dot';
      dot.setAttribute('aria-label', 'Show item ' + (index + 1) + ' of ' + slides.length);
      dot.addEventListener('click', function () {
        row.scrollTo({left: slide.offsetLeft - row.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft || 0), behavior: reducedMotion() ? 'auto' : 'smooth'});
      });
      dots.appendChild(dot);
    });
    row.parentNode.insertBefore(dots, row.nextSibling);
    var frame = 0;
    function update() {
      frame = 0;
      var start = row.getBoundingClientRect().left;
      var best = 0, bestDistance = Infinity;
      slides.forEach(function (slide, index) {
        var d = Math.abs(slide.getBoundingClientRect().left - start - parseFloat(getComputedStyle(row).paddingLeft || 0));
        if (d < bestDistance) { bestDistance = d; best = index; }
      });
      if (row.scrollLeft + row.clientWidth >= row.scrollWidth - 4) best = slides.length - 1;
      Array.prototype.forEach.call(dots.children, function (dot, index) {
        dot.setAttribute('aria-current', index === best ? 'true' : 'false');
      });
    }
    row.addEventListener('scroll', function () { if (!frame) frame = requestAnimationFrame(update); }, {passive: true});
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- Mobile: comparison table collapses ---------- */

  function initCompare(root) {
    each(root, '[data-sh-compare][data-collapse-mobile]', function (details) {
      if (isMobile()) details.open = false;
    });
  }

  /* ---------- Mobile: sticky buy bar ---------- */

  function initSticky() {
    var bar = document.querySelector('[data-sh-sticky]');
    var anchor = document.querySelector('[data-sh-sticky-anchor]');
    if (!bar || !anchor || bar.__shSticky || typeof IntersectionObserver !== 'function') return;
    bar.__shSticky = true;
    var anchorVisible = true;
    var footerVisible = false;
    function render() {
      var show = isMobile() && !anchorVisible && !footerVisible;
      bar.hidden = !show;
      document.documentElement.classList.toggle('sh-has-sticky', show);
    }
    new IntersectionObserver(function (entries) {
      // Hidden only once the buttons have scrolled above the viewport.
      var e = entries[0];
      anchorVisible = e.isIntersecting || e.boundingClientRect.top > 0;
      render();
    }).observe(anchor);
    var footer = document.querySelector('footer, .shopify-section-group-footer-group');
    if (footer) {
      new IntersectionObserver(function (entries) {
        footerVisible = entries[0].isIntersecting;
        render();
      }).observe(footer);
    }
    window.addEventListener('resize', render);
  }

  /* ---------- Autoplay brand film: start only once it is on screen ---------- */

  function initLazyAutoplay(root) {
    each(root, 'video[data-sh-lazy-autoplay]', function (video) {
      if (video.__shLazy) return;
      video.__shLazy = true;
      if (reducedMotion()) return;
      if (typeof IntersectionObserver !== 'function') { video.preload = 'auto'; video.play().catch(function () {}); return; }
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            if (video.preload === 'none') video.preload = 'auto';
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
          } else {
            video.pause();
          }
        });
      }, {rootMargin: '200px 0px'}).observe(video);
    });
  }

  function init(root) {
    initRings(root);
    initLazyAutoplay(root);
    each(root, '[data-sh-swipe]', initSwipe);
    initCompare(root);
    initSticky();
  }
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
