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

/** Origin of the owner host, derived from OWNER_HOST; the staff origin while owner routing is off. */
export function ownerOrigin(env: HostEnv): string {
  const owner = ownerHost(env);
  if (!owner) return env.APP_ORIGIN;
  const scheme = env.APP_ORIGIN.startsWith('http://') ? 'http' : 'https';
  return `${scheme}://${owner}`;
}

/** Origins whose state-changing requests the answering host accepts (CSRF check). */
export function allowedOrigins(env: HostEnv, url: URL): string[] {
  return surfaceOf(env, url) === 'owner' ? [ownerOrigin(env)] : [url.origin];
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

/** Public origin for an in-app path: owner paths use the owner host, everything else the staff host. */
export function originForPath(env: HostEnv, path: string): string {
  return isOwnerAppPath(path) ? ownerOrigin(env) : env.APP_ORIGIN;
}

/** Staff SPA entry paths. Also listed in `run_worker_first` of wrangler.jsonc so the Worker can 404 them. */
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
const OWNER_HOST_API: readonly string[] = [
  '/health',
  '/config',
  '/time',
  '/setup',
  '/auth/step-up',
  '/auth/logout',
  '/me',
  '/me/notification-prefs',
  '/notifications',
  '/push/subscribe',
  '/verify',
  '/__test',
];

export function isOwnerHostApiPath(path: string): boolean {
  if (isOwnerApiPath(path)) return true;
  if (/^\/payslips\/[^/]+\/pdf$/.test(path)) return true;
  return OWNER_HOST_API.some((p) => prefix(path, p));
}
