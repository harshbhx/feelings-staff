/**
 * Haptics (docs/ui-redesign-plan.md 5a): one short vibration on the moments that matter (check-in
 * and check-out success, approve or decline on an owner card, a failed check-in, PIN accepted),
 * never on plain taps, scrolls or toggles. In the staff entry, so it stays tiny.
 *
 * iOS Safari has no Vibration API: every call is then a no-op and never throws. Off with reduced
 * motion, and when the person turned Vibration off in Me (`fs.vibrate` = "off" on this phone).
 */
export const VIBRATE_KEY = 'fs.vibrate';

function buzz(pattern: number | number[]): void {
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (localStorage.getItem(VIBRATE_KEY) === 'off') return;
    navigator.vibrate?.(pattern);
  } catch {
    // no matchMedia, storage blocked or vibrate refused: haptics are a nicety, never an error
  }
}

/** One 8 ms tick: check-in success, approve or decline, PIN accepted. */
export const tick = (): void => buzz(8);
/** Two ticks 90 ms apart: check-out success. */
export const success = (): void => buzz([8, 90, 8]);
/** One 16 ms buzz: a check-in that failed. */
export const warn = (): void => buzz(16);
