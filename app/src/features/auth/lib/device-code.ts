/**
 * The 6-digit code of a device request (docs/owner-access.md "Passkeys" flow 3) as the new device and
 * the approval card both show it, and the countdown in whole minutes. Pure; unit-tested.
 */

/** "482 913": two groups of three, easy to compare at a glance. */
export function groupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** "4 8 2 9 1 3": what a screen reader reads, one digit at a time. */
export function spokenCode(code: string): string {
  return code.split('').join(' ');
}

/** Whole minutes left, rounded up; 0 once the time is up. */
export function minutesLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 60_000));
}
