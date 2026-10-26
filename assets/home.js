/*
 * Home page behaviour, ported from the storefront's React components:
 * - proof rings count up when scrolled into view (StatRings.tsx)
 * - video cards swap the poster for the player (VideoCard.tsx / UgcGrid.tsx)
 * - the press bar's pause toggle (PauseToggle.tsx)
 * Markup is rendered complete by Liquid; this file only adds interaction.
 */
(function () {
  'use strict';

  var RADIUS = 44;
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  var DURATION = 1400;

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /* ---------- Proof rings ---------- */

  function paintRings(rings, progress) {
    rings.forEach(function (ring) {
      var value = Number(ring.node.getAttribute('data-value')) || 0;
      var shown = Math.round(value * progress);
      var dash = CIRCUMFERENCE * (1 - (value * progress) / 100);
      if (ring.fill) ring.fill.setAttribute('stroke-dashoffset', String(dash));
      if (ring.value) ring.value.textContent = shown + '%';
    });
  }

  function initStatRings(section) {
    if (section.dataset.statRingsReady) return;
    section.dataset.statRingsReady = 'true';
    // The numbers render complete on the server; under reduced motion (or
    // without IntersectionObserver) they simply stay that way.
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;

    var rings = Array.prototype.map.call(
      section.querySelectorAll('[data-stat-ring]'),
      function (node) {
        return {
          node: node,
          fill: node.querySelector('[data-stat-ring-fill]'),
          value: node.querySelector('[data-stat-ring-value]'),
        };
      },
    );
    if (!rings.length) return;

    var frame = 0;
    var observer = new IntersectionObserver(
      function (entries) {
        if (!entries[0] || !entries[0].isIntersecting) return;
        observer.disconnect();
        var start = performance.now();
        paintRings(rings, 0);
        var tick = function (now) {
          var t = Math.min(1, (now - start) / DURATION);
          // ease-out cubic
          paintRings(rings, 1 - Math.pow(1 - t, 3));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      {threshold: 0.4},
    );
    observer.observe(section);

    section.addEventListener('home:teardown', function () {
      observer.disconnect();
      cancelAnimationFrame(frame);
    });
  }

  /* ---------- Video cards ---------- */

  function playVideoCard(button) {
    var card = button.closest('[data-video-card]');
    if (!card) return;
    var template = card.querySelector('template[data-video-player]');
    if (!template) return;
    var player = template.content.firstElementChild;
    if (!player) return;
    player = document.importNode(player, true);

    if (card === button) {
      // UGC tile: the whole card is the play button; it becomes a plain card
      // holding only the player (UgcGrid.tsx).
      var replacement = document.createElement('div');
      replacement.className = 'ugc-card';
      replacement.appendChild(player);
      card.parentNode.replaceChild(replacement, card);
    } else {
      // Story card: the poster and the play button give way to the player
      // (VideoCard.tsx).
      while (card.firstChild) card.removeChild(card.firstChild);
      card.appendChild(player);
    }

    // The play button is gone, which would drop keyboard focus to <body>:
    // hand it to the player instead.
    if (player.tagName === 'VIDEO') {
      if (!player.hasAttribute('tabindex')) player.setAttribute('tabindex', '-1');
      var playing = player.play && player.play();
      if (playing && typeof playing.catch === 'function') playing.catch(function () {});
    }
    player.focus();
  }

  /* ---------- Press bar pause toggle ---------- */

  var PAUSE_GLYPH =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="5" y="4" width="5" height="16" rx="1.5"></rect><rect x="14" y="4" width="5" height="16" rx="1.5"></rect></svg>';
  var PLAY_GLYPH =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z"></path></svg>';

  function togglePause(button) {
    var bar = button.closest('[data-press-bar]');
    var marquee = bar && bar.querySelector('.marquee');
    if (!marquee) return;
    var paused = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', paused ? 'true' : 'false');
    marquee.classList.toggle('marquee--paused', paused);
    button.innerHTML = paused ? PLAY_GLYPH : PAUSE_GLYPH;
  }

  /* ---------- Wiring ---------- */

  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var play = target.closest('[data-video-play]');
    if (play) {
      event.preventDefault();
      playVideoCard(play);
      return;
    }
    var pause = target.closest('[data-pause-toggle]');
    if (pause) togglePause(pause);
  });

  function init(root) {
    Array.prototype.forEach.call(
      root.querySelectorAll('[data-stat-rings]'),
      initStatRings,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  // Theme editor: re-run for a section that was re-rendered.
  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });
  document.addEventListener('shopify:section:unload', function (event) {
    Array.prototype.forEach.call(
      event.target.querySelectorAll('[data-stat-rings]'),
      function (section) {
        section.dispatchEvent(new Event('home:teardown'));
      },
    );
  });
})();
