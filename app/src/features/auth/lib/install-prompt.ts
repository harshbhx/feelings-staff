/**
 * Captures Chromium's `beforeinstallprompt` as early as possible (routes.tsx calls
 * {@link captureInstallPrompt} when the router loads), so the invite and sign-in pages can show our
 * own **Install the app** button (PRD 4.2, S-03.1). Also tracks `appinstalled`.
 */
import { useSyncExternalStore } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PromptState {
  canPrompt: boolean;
  installed: boolean;
}

let held: BeforeInstallPromptEvent | null = null;
let state: PromptState = { canPrompt: false, installed: false };
let captured = false;
const listeners = new Set<() => void>();

function set(next: PromptState): void {
  state = next;
  for (const l of listeners) l();
}

/** Start listening once per page. Safe to call more than once and outside a browser. */
export function captureInstallPrompt(target: Window | undefined = globalThis.window): void {
  if (captured || !target) return;
  captured = true;
  target.addEventListener('beforeinstallprompt', (e) => {
    // Keep Chrome's own mini-infobar away; our button calls prompt() once, from a tap.
    e.preventDefault();
    held = e as BeforeInstallPromptEvent;
    set({ ...state, canPrompt: true });
  });
  target.addEventListener('appinstalled', () => {
    held = null;
    set({ canPrompt: false, installed: true });
  });
}

/** Show the browser's install dialog. Call only from a tap. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = held;
  if (!e) return 'unavailable';
  held = null;
  set({ ...state, canPrompt: false });
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => state;

export function useInstallPrompt(): PromptState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test hook. */
export function resetInstallPromptForTests(): void {
  held = null;
  captured = false;
  state = { canPrompt: false, installed: false };
}
