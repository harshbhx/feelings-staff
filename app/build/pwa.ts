/**
 * PWA build plugins (PRD 11.1-11.4, 11.8). Owner: WP-7.
 * vite.config.ts (WP-1) spreads whatever this returns, so WP-7 never edits the shared config.
 *
 * 1. vite-plugin-pwa with `injectManifest`: builds src/pwa/sw.ts into `/sw.js` and injects the
 *    precache list (app shell: html, js, css, woff2, png and svg icons, the manifest). The web
 *    manifest is the static public/manifest.webmanifest (PRD 11.1, byte for byte), so the plugin's
 *    own manifest is off; the app registers the worker itself (src/pwa/register.ts).
 *    With @cloudflare/vite-plugin the build has a `client` and a Worker environment: the PWA plugins
 *    only apply to `client`, and their output directory is the client's (dist/client), otherwise the
 *    service worker would be built twice and precache the Worker bundle.
 * Split builds (build/split.ts) reuse this: their manifest is written next to the page by
 *    `fs:split-entry`, the service worker is built into the split build's own folder and scope `/`.
 * 2. `fs:pwa-assets`: renders every icon and the iOS splash images (PRD 11.2) at build time with
 *    @vite-pwa/assets-generator, emits them into the client build and injects the
 *    `apple-touch-startup-image` links into index.html. Nothing is committed but icons/icon.svg.
 */
import type { HtmlTagDescriptor, Plugin, PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SINDOOR = '#b3121b';
const WHITE = '#ffffff';

/** The website's bindi: circle r=20 in a 64 box, so its diameter is 62.5% of the canvas. */
const BINDI_ANY = 40 / 64;
/** Maskable icons: diameter 50% of the canvas, well inside the 80% safe zone. */
const BINDI_MASKABLE = 0.5;
/** Splash screens: a bindi a quarter of the screen width, centred on white. */
const BINDI_SPLASH = 0.25;

/** Phosphor regular 2.1.1 path data (`@phosphor-icons/core` assets/regular, viewBox 0 0 256 256). */
const PHOSPHOR = {
  'sign-in':
    'M141.66,133.66l-40,40a8,8,0,0,1-11.32-11.32L116.69,136H24a8,8,0,0,1,0-16h92.69L90.34,93.66a8,8,0,0,1,11.32-11.32l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z',
  'calendar-check':
    'M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Zm-38.34-85.66a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L116,164.69l42.34-42.35A8,8,0,0,1,169.66,122.34Z',
} as const;

/** iPhones that run iOS 16.4+ (Web Push, PRD 11.8), portrait only (the manifest locks portrait). */
const SPLASH_DEVICES = [
  'iPhone 17 Pro Max',
  'iPhone 17 Pro',
  'iPhone Air',
  'iPhone 17',
  'iPhone 16 Pro Max',
  'iPhone 16 Pro',
  'iPhone 16 Plus',
  'iPhone 16',
  'iPhone 16e',
  'iPhone 15 Pro Max',
  'iPhone 15 Pro',
  'iPhone 15 Plus',
  'iPhone 15',
  'iPhone 14 Plus',
  'iPhone 14',
  'iPhone 13 Pro Max',
  'iPhone 13',
  'iPhone 13 mini',
  'iPhone 12 Pro Max',
  'iPhone 11 Pro Max',
  'iPhone 11',
  'iPhone 8 Plus',
  'iPhone SE 4.7"',
] as const;

interface Size {
  width: number;
  height: number;
}

interface AssetSpec {
  fileName: string;
  size: Size;
  /** SVG markup drawn at exactly `size` (so nothing is scaled after rendering). */
  svg: string;
  /** Full-bleed white (opaque icons) or transparent (favicon, Android badge). */
  opaque: boolean;
}

function square(n: number): Size {
  return { width: n, height: n };
}

function svg({ width, height }: Size, body: string, background: string | null): string {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${body}</svg>`;
}

function bindi(size: Size, diameterOfShortSide: number, fill: string): string {
  const r = (Math.min(size.width, size.height) * diameterOfShortSide) / 2;
  return `<circle cx="${size.width / 2}" cy="${size.height / 2}" r="${r}" fill="${fill}"/>`;
}

/** A Phosphor glyph in sindoor, its 256 box scaled to 70% of the canvas and centred. */
function glyph(size: Size, path: string): string {
  const box = Math.min(size.width, size.height) * 0.7;
  const scale = box / 256;
  const x = (size.width - box) / 2;
  const y = (size.height - box) / 2;
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="${path}" fill="${SINDOOR}"/></g>`;
}

export function splashFileName(size: Size): string {
  return `icons/splash-${size.width}x${size.height}.png`;
}

function iconSpecs(): AssetSpec[] {
  const any = (n: number, fileName: string): AssetSpec => {
    const size = square(n);
    return { fileName, size, svg: svg(size, bindi(size, BINDI_ANY, SINDOOR), WHITE), opaque: true };
  };
  const maskable = (n: number): AssetSpec => {
    const size = square(n);
    return {
      fileName: `icons/maskable-${n}.png`,
      size,
      svg: svg(size, bindi(size, BINDI_MASKABLE, SINDOOR), WHITE),
      opaque: true,
    };
  };
  const shortcut = (fileName: string, path: string): AssetSpec => {
    const size = square(96);
    return { fileName, size, svg: svg(size, glyph(size, path), WHITE), opaque: true };
  };
  const badge = square(96);
  const favicon = square(32);
  return [
    any(192, 'icons/icon-192.png'),
    any(512, 'icons/icon-512.png'),
    maskable(192),
    maskable(512),
    any(180, 'icons/apple-touch-icon-180.png'),
    {
      fileName: 'icons/badge-96.png',
      size: badge,
      svg: svg(badge, bindi(badge, BINDI_ANY, WHITE), null),
      opaque: false,
    },
    {
      fileName: 'favicon-32.png',
      size: favicon,
      svg: svg(favicon, bindi(favicon, BINDI_ANY, SINDOOR), null),
      opaque: false,
    },
    shortcut('icons/sc-checkin-96.png', PHOSPHOR['sign-in']),
    shortcut('icons/sc-today-96.png', PHOSPHOR['calendar-check']),
  ];
}

interface SplashSize extends Size {
  scaleFactor: number;
}

async function splashSizes(): Promise<SplashSize[]> {
  const { appleSplashScreenSizes } = await import('@vite-pwa/assets-generator/config');
  const seen = new Map<string, SplashSize>();
  for (const device of SPLASH_DEVICES) {
    const { width, height, scaleFactor } = appleSplashScreenSizes[device];
    seen.set(`${width}x${height}@${scaleFactor}`, { width, height, scaleFactor });
  }
  return [...seen.values()];
}

function splashSpec(size: SplashSize): AssetSpec {
  return {
    fileName: splashFileName(size),
    size,
    svg: svg(size, bindi(size, BINDI_SPLASH, SINDOOR), WHITE),
    opaque: true,
  };
}

async function render(spec: AssetSpec): Promise<Uint8Array> {
  const { createSharp } = await import('@vite-pwa/assets-generator/api');
  const background = spec.opaque
    ? { r: 255, g: 255, b: 255, alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 0 };
  const image = await createSharp('png', Buffer.from(spec.svg), spec.size, background, {
    padding: 0,
    resizeOptions: { fit: 'fill' },
    outputOptions: { compressionLevel: 9, adaptiveFiltering: true },
  });
  return image.toBuffer();
}

/** Icons and iOS splash images, rendered at build time and emitted into the client build. */
function pwaAssets(): Plugin {
  let splash: Promise<SplashSize[]> | null = null;
  const sizes = () => {
    splash ??= splashSizes();
    return splash;
  };
  return {
    name: 'fs:pwa-assets',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    async transformIndexHtml() {
      const { createAppleSplashScreenHtmlLink } = await import('@vite-pwa/assets-generator/api');
      const tags: HtmlTagDescriptor[] = [];
      for (const size of await sizes()) {
        const link = createAppleSplashScreenHtmlLink('link', {
          size,
          landscape: false,
          addMediaScreen: true,
          basePath: '/',
          name: (_landscape, s) => splashFileName(s),
        });
        tags.push({
          tag: 'link',
          attrs: { rel: link.rel, media: link.media, href: link.href },
          injectTo: 'head',
        });
      }
      return tags;
    },
    async generateBundle() {
      const specs = [...iconSpecs(), ...(await sizes()).map(splashSpec)];
      const rendered = await Promise.all(specs.map(async (s) => [s, await render(s)] as const));
      for (const [spec, source] of rendered)
        this.emitFile({ type: 'asset', fileName: spec.fileName, source });
    },
  };
}

function clientOnly(plugin: Plugin): Plugin {
  return { ...plugin, applyToEnvironment: (environment) => environment.name === 'client' };
}

export function pwa(): PluginOption[] {
  const sw = VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src/pwa',
    filename: 'sw.ts',
    registerType: 'prompt',
    injectRegister: false,
    manifest: false,
    includeManifestIcons: false,
    injectManifest: {
      // Classic script: registered without `type: 'module'`.
      rollupFormat: 'iife',
      globPatterns: ['**/*.{html,js,css,woff2,png,svg,webmanifest}'],
      // Splash images are only read by iOS at install; screenshots only by install UIs.
      globIgnores: ['**/node_modules/**', '.vite/**', 'icons/splash-*.png', 'screens/**'],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    },
    integration: {
      configureOptions(viteConfig, options) {
        // The combined build has a `client` environment (dist/client); a split build is a plain client
        // build whose outDir is its folder below it.
        options.outDir = viteConfig.environments.client?.build.outDir ?? viteConfig.build.outDir;
      },
    },
  });
  return [...sw.map(clientOnly), pwaAssets()];
}
