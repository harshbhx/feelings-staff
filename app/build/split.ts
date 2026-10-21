/**
 * Split build helpers (docs/owner-access.md, ADR-19). One source tree, three client builds:
 * `combined` (the default `vite build` with the Worker, served while OWNER_HOST is unset), `staff`
 * and `owner` (client only, written into `dist/client/_s` and `dist/client/_o`; the Worker serves the
 * folder of the answering host as its site root, see worker/lib/split-assets.ts).
 * `FS_SURFACE=staff|owner vite build` runs a split build; the `build` script runs all three.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export type Surface = 'combined' | 'staff' | 'owner';

/** Output folder of each split build below `dist/client`; keep in step with worker/lib/split-assets.ts. */
export const SPLIT_FOLDER = { staff: '_s', owner: '_o' } as const;

export function currentSurface(): Surface {
  const value = process.env.FS_SURFACE ?? 'combined';
  if (value === 'combined' || value === 'staff' || value === 'owner') return value;
  throw new Error(`FS_SURFACE must be combined, staff or owner (got "${value}")`);
}

interface ManifestShortcut {
  name: string;
  url: string;
  icons: unknown;
}
interface ManifestShot {
  src: string;
}
interface Manifest {
  [key: string]: unknown;
  shortcuts: ManifestShortcut[];
  screenshots: ManifestShot[];
}

const isOwnerUrl = (url: string) => url === '/o' || url.startsWith('/o/') || url.startsWith('/o?');

/**
 * The manifest of a split build, derived from `public/manifest.webmanifest` (the combined one, PRD
 * 11.1) so the two cannot drift: the staff manifest drops the owner shortcut and screenshot; the
 * owner manifest is its own app (start at Today, only the owner shortcut and screenshot).
 */
export function manifestFor(surface: 'staff' | 'owner', publicDir: string): string {
  const base = JSON.parse(
    readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'),
  ) as Manifest;
  const shortcuts = base.shortcuts.filter((s) => isOwnerUrl(s.url) === (surface === 'owner'));
  const screenshots = base.screenshots.filter(
    (s) => s.src.includes('owner-') === (surface === 'owner'),
  );
  const own =
    surface === 'owner'
      ? {
          name: 'Feelings Owner',
          description: 'Attendance and pay for the Feelings Beauty Care owner.',
          start_url: '/o/today?source=pwa',
          shortcuts: shortcuts.map((s) => ({ ...s, name: 'Today' })),
        }
      : { shortcuts };
  return `${JSON.stringify({ ...base, ...own, screenshots }, null, 2)}\n`;
}

/**
 * A copy of `public/` for a split build: everything except `_headers` (only the asset root's counts;
 * the Worker adds the headers for split hosts) and with the build's own manifest.
 */
export function stagePublicDir(surface: 'staff' | 'owner', publicDir: string): string {
  const out = mkdtempSync(join(tmpdir(), `fs-public-${surface}-`));
  const copy = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (from === publicDir && ['_headers', 'manifest.webmanifest'].includes(entry.name)) continue;
      if (entry.isDirectory()) copy(join(from, entry.name), join(to, entry.name));
      else copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  };
  copy(publicDir, out);
  writeFileSync(join(out, 'manifest.webmanifest'), manifestFor(surface, publicDir));
  return out;
}

/** Client route table entries of owner endpoints (`/owner/...`, `/auth/owner/...`), one per line. */
const OWNER_ROUTE_LINE = /^[ \t]+\w+: \{[^\n]*p: '\/(?:auth\/)?owner[/']?[^\n]*\},?\r?\n/gm;

/**
 * The staff build knows no owner endpoint: its copy of the generated client route table
 * (`src/api/routes.gen.ts`) is filtered. The Worker keeps answering them on the owner host only.
 */
export function staffRoutes(): Plugin {
  return {
    name: 'fs:staff-routes',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('/src/api/routes.gen.ts')) return null;
      return { code: code.replace(OWNER_ROUTE_LINE, ''), map: null };
    },
  };
}

/** The module that starts each build, and the owner page's own title and description. */
const ENTRY = { staff: '/src/main.staff.tsx', owner: '/src/main.owner.tsx' } as const;

/** Plugins of a split build: the page entry (and the owner page's own text) and, for staff, the filtered route table. */
export function splitPlugins(surface: 'staff' | 'owner', publicDir: string): Plugin[] {
  const entry: Plugin = {
    name: 'fs:split-entry',
    config: () => ({ publicDir: stagePublicDir(surface, publicDir) }),
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html.replace('/src/main.tsx', ENTRY[surface]);
        if (surface === 'owner') {
          out = out
            .replace('<title>Feelings Staff</title>', '<title>Feelings Owner</title>')
            .replace(
              'content="Attendance and pay for the Feelings Beauty Care team."',
              'content="Attendance and pay for the Feelings Beauty Care owner."',
            )
            .replace(
              'name="apple-mobile-web-app-title" content="Feelings"',
              'name="apple-mobile-web-app-title" content="Feelings Owner"',
            );
        }
        return out;
      },
    },
  };
  return surface === 'staff' ? [entry, staffRoutes()] : [entry];
}
