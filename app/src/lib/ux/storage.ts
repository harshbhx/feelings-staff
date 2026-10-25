/** Small, failure-proof localStorage helpers for the guidance layer (tour, install nudge). */
export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode, quota): the guide may show again next time, which is harmless
  }
}

/**
 * Automated browsers (Playwright shots, the E2E suite) never get unprompted guidance, so it cannot
 * cover a screen under test. `?guide=1` turns it back on for the shots that show it.
 */
export function guidanceSuppressed(): boolean {
  if (typeof window === 'undefined') return true;
  return !guidanceForced() && navigator.webdriver === true;
}

/** `?guide=1`: show the tour even in a browser tab (previews, screenshots). */
export function guidanceForced(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('guide') === '1';
  } catch {
    return false;
  }
}
