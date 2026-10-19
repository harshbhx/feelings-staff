/**
 * Vite config (WP-1, shared). One build produces the SPA (dist/client) and the Worker.
 * Feature packages plug in through their own files (build/pwa.ts for WP-7) instead of editing this.
 */
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pwa } from './build/pwa';
import { appVersion, commitSha } from './build/version';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ configPath: './wrangler.jsonc' }), ...pwa()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
    'import.meta.env.VITE_COMMIT': JSON.stringify(commitSha()),
  },
  build: {
    manifest: true,
    target: 'es2022',
  },
  server: { port: 5173 },
  preview: { port: 8787 },
});
