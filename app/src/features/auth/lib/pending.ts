/**
 * "I have a new phone" has no session until the owner approves (PRD 4.1.6), so the waiting screen
 * retries sign-in with the phone and PIN the person just typed. They are held in this module's
 * memory only: never in storage, history state or the URL, and gone on reload.
 */
import type { StaffCredentials } from './device';

let held: StaffCredentials | null = null;

export function holdPendingSignIn(creds: StaffCredentials): void {
  held = { ...creds };
}

export function pendingSignIn(): StaffCredentials | null {
  return held;
}

export function dropPendingSignIn(): void {
  held = null;
}
