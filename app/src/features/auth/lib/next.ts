/** `?next=` after sign-in (set by RequireRole): only same-origin app paths, never another site. */
import { STAFF_ONLY } from '../../../lib/surface';

const AUTH_PATHS = STAFF_ONLY
  ? ['/signin', '/join', '/waiting']
  : ['/signin', '/auth/owner', '/join', '/waiting'];

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // One leading slash, then not a second slash or a backslash ("//evil.test", "/\evil.test").
  if (!/^\/(?![/\\])/.test(raw)) return null;
  if (/\s/.test(raw) || [...raw].some((c) => c.charCodeAt(0) < 32)) return null;
  const path = raw.split(/[?#]/)[0] ?? '';
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return raw;
}

/** Owners and managers live under /o; staff everywhere else (PRD 5). */
export function nextFitsRole(next: string, role: 'owner' | 'manager' | 'staff'): boolean {
  const owner = !STAFF_ONLY && (next === '/o' || next.startsWith('/o/') || next.startsWith('/o?'));
  return role === 'staff' ? !owner : owner;
}
