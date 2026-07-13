// Scroll reveal: major section blocks fade out once they scroll out of the
// viewport (top or bottom edge) and fade back in when scrolled back into
// view - ported from C:\Portfolio's Framer Motion `whileInView(..., { once:
// false })` card reveal (see work-card.tsx / experience-timeline.tsx),
// reimplemented with a plain IntersectionObserver since this project has no
// animation library. rootMargin shrinks the trigger rect inward the same way
// Portfolio's `viewport: { margin: '-40px' }` does, so the fade kicks in
// slightly before/after the true edge rather than exactly at it.
const revealTargets = document.querySelectorAll('#uploadPanel, #editPanelWrap, .bottomRow');
if (revealTargets.length && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle('scrollFaded', !entry.isIntersecting);
    }
  }, { rootMargin: '-40px 0px -40px 0px', threshold: 0 });
  revealTargets.forEach((el) => revealObserver.observe(el));
}

// Overscroll bounce: pulling past the top/bottom of the page (wheel or
// touch) drags the whole page a little further, then springs back once the
// input stops - ported from C:\Portfolio's OverscrollBounce component
// (Framer Motion spring + Lenis-aware boundary checks). Reimplemented here
// with a plain translateY on #pageBounceWrap plus a CSS transition using the
// same overshoot curve already used for button presses elsewhere in this
// project (cubic-bezier(0.34,1.56,0.64,1), see css/style.css), since there's
// no animation library or smooth-scroll library in this project to drive a
// real spring.
const bounceWrap = document.getElementById('pageBounceWrap');
if (bounceWrap) {
  const MAX_PULL = 80; // px, clamp on how far the stretch can go
  const RESISTANCE = 0.4; // wheel/touch delta multiplier (rubber-band drag)
  const WHEEL_IDLE_MS = 75; // ms of no wheel events before auto-release
  const MAX_HOLD_MS = 200; // cap so trackpad momentum tail can't freeze the stretch
  const COOLDOWN_MS = 800; // ignore wheel input after a forced release (kills repeat-bounce)
  const BOUNDARY_TOLERANCE = 12; // px tolerance for "am I at top/bottom"
  const DEAD_ZONE = 10; // px of pull absorbed invisibly before any visual stretch shows

  let pull = 0;
  let pullStart = 0;
  let suppressUntil = 0;
  let idleTimer = null;
  let touchStartY = 0;
  let overscrolling = false;

  function atTop() {
    return window.scrollY <= BOUNDARY_TOLERANCE;
  }
  function atBottom() {
    const limit = document.documentElement.scrollHeight - window.innerHeight;
    return window.scrollY >= limit - BOUNDARY_TOLERANCE;
  }
  function clampPull(v) {
    return Math.max(-MAX_PULL, Math.min(MAX_PULL, v));
  }
  function visualPull(raw) {
    const sign = Math.sign(raw);
    return sign * Math.max(0, Math.abs(raw) - DEAD_ZONE);
  }
  function applyPull(v) {
    bounceWrap.style.transition = 'none';
    bounceWrap.style.transform = `translateY(${visualPull(v)}px)`;
  }
  function release() {
    pull = 0;
    pullStart = 0;
    clearTimeout(idleTimer);
    bounceWrap.style.transition = 'transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    bounceWrap.style.transform = 'translateY(0px)';
  }
  function scheduleRelease() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(release, WHEEL_IDLE_MS);
  }
  // A <dialog> owns interaction while open (see js/editor.js) - bouncing the
  // page underneath an open modal would look broken, so input is ignored.
  function dialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  window.addEventListener('wheel', (e) => {
    if (dialogOpen()) return;
    const now = performance.now();
    if (now < suppressUntil) return;

    const pullingDown = e.deltaY < 0 && atTop();
    const pullingUp = e.deltaY > 0 && atBottom();
    if (!pullingDown && !pullingUp) return;

    e.preventDefault();
    if (pullStart === 0) pullStart = now;
    pull = clampPull(pull - e.deltaY * RESISTANCE);
    applyPull(pull);

    if (now - pullStart > MAX_HOLD_MS) {
      suppressUntil = now + COOLDOWN_MS;
      release();
    } else {
      scheduleRelease();
    }
  }, { passive: false });

  window.addEventListener('touchstart', (e) => {
    if (dialogOpen()) return;
    touchStartY = e.touches[0].clientY;
    overscrolling = false;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (dialogOpen()) return;
    const diff = e.touches[0].clientY - touchStartY;
    if (!overscrolling) {
      if (diff > 0 && atTop()) overscrolling = true;
      else if (diff < 0 && atBottom()) overscrolling = true;
      else return;
    }
    e.preventDefault();
    pull = clampPull(diff * RESISTANCE);
    applyPull(pull);
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (overscrolling) release();
    overscrolling = false;
  }, { passive: true });
}
