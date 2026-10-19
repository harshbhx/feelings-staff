/**
 * `?allowBrowser=1` lets the staff app run in a normal browser tab, for E2E and the preview only
 * (PRD 4.2 rules, 14.4). It is ignored on production hosts. The choice sticks for the tab, so
 * in-app navigation (which drops the query) keeps working.
 */
const KEY = 'fs.allowBrowser';

export function isNonProductionHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.workers.dev')
  );
}

export function browserAllowed(loc: Pick<Location, 'hostname' | 'search'> = window.location) {
  if (!isNonProductionHost(loc.hostname)) return false;
  try {
    const flag = new URLSearchParams(loc.search).get('allowBrowser');
    if (flag === '1') sessionStorage.setItem(KEY, '1');
    if (flag === '0') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return new URLSearchParams(loc.search).get('allowBrowser') === '1';
  }
}
