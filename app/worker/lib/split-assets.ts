/**
 * Static files for the split build (docs/owner-access.md, ADR-19). With `OWNER_HOST` set the client is
 * built twice into `/_s` (staff entry, no owner code) and `/_o` (owner entry); each host is served from
 * its own folder as if that folder were the site root, so the staff host never reaches an owner chunk.
 * Both folders themselves answer 404 on every host. With `OWNER_HOST` unset none of this runs and the
 * combined build at the asset root serves everything, as before.
 */
import type { Surface } from './hosts';

export type SplitSurface = Exclude<Surface, 'combined'>;

const FOLDER: Record<SplitSurface, string> = { staff: '/_s', owner: '/_o' };

/** Paths that need `Cache-Control: no-cache` (the service worker and manifest of the host). */
const REVALIDATE = new Set(['/sw.js', '/manifest.webmanifest']);

/** `/_s`, `/_o` and everything below: build folders, never served under their own name. */
export function isSplitFolderPath(path: string): boolean {
  return ['/_s', '/_o'].some((p) => path === p || path.startsWith(`${p}/`));
}

const isFile = (path: string) => /\.[A-Za-z0-9]+$/.test(path.slice(path.lastIndexOf('/') + 1));

/**
 * Answer a GET or HEAD for a page or a file from the host's folder. Anything with a file extension
 * must exist there (a missing hashed file is a real 404, never the shell, so a stale page reloads
 * itself); every other path is an app route and gets the folder's shell.
 */
export async function serveSplitAsset(
  assets: Fetcher,
  req: Request,
  surface: SplitSurface,
): Promise<Response> {
  const url = new URL(req.url);
  const file = isFile(url.pathname) && url.pathname !== '/index.html';
  const target = file ? `${FOLDER[surface]}${url.pathname}` : `${FOLDER[surface]}/`;
  const res = await assets.fetch(new Request(new URL(target, url), req));
  const html = res.headers.get('Content-Type')?.includes('text/html') ?? false;
  if (file && (res.status === 404 || html)) return new Response('Not found', { status: 404 });
  if (!REVALIDATE.has(url.pathname) || !res.ok) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-cache');
  return out;
}
