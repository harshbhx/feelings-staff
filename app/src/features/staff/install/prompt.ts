/**
 * Android install prompt (PRD 4.2): capture `beforeinstallprompt` as early as possible, offer our
 * own Install button, call `prompt()` once, and after a dismissal offer it again only after 3 days.
 * `appinstalled` switches the gate to "Done. Open Feelings from your home screen."
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallPromptState {
  /** A captured prompt we may show now. */
  available: boolean;
  /** `appinstalled` fired in this page. */
  installed: boolean;
  /** Dismissed less than 3 days ago: keep the button hidden (S-03.1). */
  snoozed: boolean;
}

const DISMISS_KEY = 'fs.installDismissedAt';
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallPromptState = { available: false, installed: false, snoozed: false };
const listeners = new Set<() => void>();

function readSnoozed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && now - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function set(next: Partial<InstallPromptState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  state = { ...state, snoozed: readSnoozed() };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ available: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ available: false, installed: true });
  });
}

/** Show the browser's install dialog. Resolves with the person's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null; // a captured event can be prompted only once
  set({ available: false });
  await ev.prompt();
  const choice = await ev.userChoice;
  if (choice.outcome === 'dismissed') {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // private mode: the snooze lasts for this page only
    }
    set({ snoozed: true });
  } else {
    set({ installed: true });
  }
  return choice.outcome;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useInstallPrompt(): InstallPromptState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** For unit tests: reset module state. */
export function __resetInstallPromptForTests(next?: Partial<InstallPromptState>) {
  deferred = null;
  state = { available: false, installed: false, snoozed: false, ...next };
}

/** For unit tests: inject a captured event. */
export function __captureForTests(ev: BeforeInstallPromptEvent) {
  deferred = ev;
  set({ available: true });
}
export type { BeforeInstallPromptEvent };
