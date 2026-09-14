/**
 * themeTransition.js — animates a light/dark switch, as in ATS.
 *
 *  1. prefers-reduced-motion → apply instantly.
 *  2. View Transitions API → the new theme spreads out in a circle from the
 *     toggle (or the middle of the screen when no origin is given).
 *  3. Otherwise (e.g. Firefox) → a short cross-fade driven by the
 *     `html.theme-transition` class in styles/app.css.
 */

const FALLBACK_FADE_MS = 350;
const REVEAL_MS = 450;

/**
 * @param {() => void} apply - flips the theme synchronously (DOM + React state)
 * @param {{x: number, y: number}} [coords] - viewport origin of the reveal
 */
export function startThemeTransition(apply, coords) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    apply();
    return;
  }

  if (typeof document.startViewTransition !== 'function') {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    apply();
    window.setTimeout(() => root.classList.remove('theme-transition'), FALLBACK_FADE_MS);
    return;
  }

  const transition = document.startViewTransition(() => apply());

  transition.ready
    .then(() => {
      const x = coords?.x ?? window.innerWidth / 2;
      const y = coords?.y ?? window.innerHeight / 2;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    })
    // `ready` rejects when a transition is skipped (e.g. rapid toggles) — harmless.
    .catch(() => {});
}
