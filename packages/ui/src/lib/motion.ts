/** Motion helpers shared by components (PRD 12.8). */

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One 8 ms haptic tick on Android (PRD 12.8), for the success moment. Never with reduced motion;
 * a no-op where vibration is not supported (iOS Safari, desktop).
 */
export function hapticTick(): void {
  if (prefersReducedMotion()) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(8);
  }
}
