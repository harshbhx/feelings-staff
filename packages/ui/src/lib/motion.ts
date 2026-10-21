/** Motion helpers shared by components (PRD 12.8). */

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Haptics live in the app (app/src/lib/haptics.ts): tick, success and warn, with the Vibration choice.
