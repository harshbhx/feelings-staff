/**
 * PWA build plugin (vite-plugin-pwa, injectManifest, PRD 11.4). Owner: WP-7.
 * vite.config.ts (WP-1) spreads whatever this returns, so WP-7 never edits the shared config.
 */
import type { PluginOption } from 'vite';

export function pwa(): PluginOption[] {
  return [];
}
