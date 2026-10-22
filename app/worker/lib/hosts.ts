/**
 * Host-based routing (docs/owner-access.md, ADR-19). With `OWNER_HOST` unset nothing here changes
 * behaviour: every function answers as the single-host app does today. With it set, the Worker has
 * two surfaces told apart by the Host header: the owner host and every other host (the staff host).
 */
import type { Env } from '../env';

export type Surface = 'combined' | 'staff' | 'owner';

type HostEnv = Pick<Env, 'APP_ORIGIN'> & { OWNER_HOST?: string };

/** The configured owner host in lower case, or '' when owner routing is off. */
export function ownerHost(env: { OWNER_HOST?: string }): string {
  return (env.OWNER_HOST ?? '').trim().toLowerCase();
}

/** Which surface answers this request. Unknown hosts get the staff surface (owner routes stay hidden). */
export function surfaceOf(env: { OWNER_HOST?: string }, url: URL): Surface {
  const owner = ownerHost(env);
  if (!owner) return 'combined';
  return url.host.toLowerCase() === owner ? 'owner' : 'staff';
}

/**
 * Origin of the owner host, derived from OWNER_HOST; the staff origin while owner routing is off.
 * The scheme follows APP_ORIGIN. A local preview leaves APP_ORIGIN empty; then the scheme of the
 * request (when there is one) decides, so the http e2e preview works like https production.
 */
export function ownerOrigin(env: HostEnv, requestUrl?: URL): string {
  const owner = ownerHost(env);
  if (!owner) return env.APP_ORIGIN;
  const http = env.APP_ORIGIN
    ? env.APP_ORIGIN.startsWith('http://')
    : requestUrl?.protocol === 'http:';
  return `${http ? 'http' : 'https'}://${owner}`;
}

/** Origins whose state-changing requests the answering host accepts (CSRF check). */
export function allowedOrigins(env: HostEnv, url: URL): string[] {
  return surfaceOf(env, url) === 'owner' ? [ownerOrigin(env, url)] : [url.origin];
}

const prefix = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** SPA paths that belong to the owner app. */
export function isOwnerAppPath(path: string): boolean {
  return prefix(path, '/o') || path.startsWith('/auth/owner');
}

/** API paths (after /api/v1) that belong to the owner app. */
export function isOwnerApiPath(path: string): boolean {
  return prefix(path, '/owner') || path.startsWith('/auth/owner');
}

/**
 * API paths (after /api/v1) of owner access: passkeys, devices, recovery (ADR-19). They exist only on
 * the owner host, so while OWNER_HOST is unset they answer 404 like the staff host does.
 */
const OWNER_ACCESS_API_PREFIX: readonly string[] = [
  '/auth/owner/passkey',
  '/auth/owner/enrol',
  '/auth/owner/device-requests',
  '/auth/owner/recovery',
  '/owner/device-requests',
  '/owner/security/devices',
];

export function isOwnerAccessApiPath(path: string): boolean {
  return OWNER_ACCESS_API_PREFIX.some((p) => prefix(path, p));
}

/** Public origin for an in-app path: owner paths use the owner host, everything else the staff host. */
export function originForPath(env: HostEnv, path: string): string {
  return isOwnerAppPath(path) ? ownerOrigin(env) : env.APP_ORIGIN;
}

/** Staff SPA entry paths (client routes; `isAppRoute` is what the Worker answers with the shell). */
export const STAFF_APP_PATHS = [
  '/door',
  '/join',
  '/waiting',
  '/signin',
  '/month',
  '/day',
  '/requests',
  '/payslips',
  '/inbox',
  '/me',
  '/scan',
  '/fix',
  '/q',
] as const;

export function isStaffAppPath(path: string): boolean {
  return STAFF_APP_PATHS.some((p) => prefix(path, p));
}

/** The only API paths the owner host answers (everything else is staff-only and answers 404). */
const OWNER_HOST_API_EXACT: readonly string[] = [
  '/health',
  '/config',
  '/time',
  '/setup',
  '/auth/step-up',
  '/auth/logout',
  '/me',
  '/me/notification-prefs',
  '/notifications',
  '/notifications/read',
  '/push/subscribe',
];
const OWNER_HOST_API_PREFIX: readonly string[] = ['/verify', '/__test'];

export function isOwnerHostApiPath(path: string): boolean {
  if (isOwnerApiPath(path)) return true;
  if (/^\/payslips\/[^/]+\/pdf$/.test(path)) return true;
  if (/^\/notifications\/[^/]+\/opened$/.test(path)) return true;
  return OWNER_HOST_API_EXACT.includes(path) || OWNER_HOST_API_PREFIX.some((p) => prefix(path, p));
}

/**
 * Client routes of the SPA, per surface: the paths the Worker answers with the app shell (so a deep
 * link, a reload or a notification tap works). Anything else is not an address of the app and gets a
 * real 404 (worker/lib/error-pages.ts). Below a known prefix unknown paths still get the shell: the
 * app's own "That page isn't here" screen answers them (app/src/app/NotFound.tsx).
 */
export function isAppRoute(path: string, surface: Surface, nonProd = false): boolean {
  if (path === '/' || path === '/index.html') return true;
  const staff = surface !== 'owner';
  const owner = surface !== 'staff';
  if (staff && (isStaffAppPath(path) || prefix(path, '/v'))) return true;
  if (owner && isOwnerAppPath(path)) return true;
  return nonProd && surface === 'combined' && path === '/__kit';
}
