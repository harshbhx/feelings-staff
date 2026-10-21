/**
 * Vite config (WP-1, shared). The default build produces the SPA (dist/client) and the Worker.
 * `FS_SURFACE=staff|owner vite build` adds a client-only split build below dist/client (`_s`, `_o`)
 * for the two hosts (docs/owner-access.md, build/split.ts); `pnpm build` runs all three.
 * Feature packages plug in through their own files (build/pwa.ts for WP-7) instead of editing this.
 */
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pwa } from './build/pwa';
import { currentSurface, SPLIT_FOLDER, splitPlugins } from './build/split';
import { appVersion, commitSha } from './build/version';

const surface = currentSurface();
const publicDir = fileURLToPath(new URL('./public', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The split builds are client only: no Worker is built or emitted for them.
    ...(surface === 'combined'
      ? [cloudflare({ configPath: './wrangler.jsonc' })]
      : [...splitPlugins(surface, publicDir)]),
    ...pwa(),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
    'import.meta.env.VITE_COMMIT': JSON.stringify(commitSha()),
    __FS_SURFACE__: JSON.stringify(surface),
  },
  build: {
    manifest: true,
    target: 'es2022',
    // es2022 browsers load modules natively; the preload polyfill only adds bytes to the staff entry.
    modulePreload: { polyfill: false },
    ...(surface === 'combined' ? {} : { outDir: `dist/client/${SPLIT_FOLDER[surface]}` }),
  },
  server: { port: 5173 },
  // `.example.test` are the placeholder hosts of the split-host e2e run (e2e/tests/split).
  preview: { port: 8787, allowedHosts: ['.example.test'] },
});
