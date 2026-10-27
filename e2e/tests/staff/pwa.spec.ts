/**
 * PWA (PRD 11.1-11.4; AC X-02): installability, offline app shell, manifest, icons and splash images.
 * Runs on `staff-android` only: installability uses a Chromium CDP call, and the HTTP checks need no
 * second browser.
 */
import { inflateSync } from 'node:zlib';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../fixtures';

/** PRD 11.1, verbatim. */
const PRD_MANIFEST = {
  id: '/',
  name: 'Feelings Staff',
  short_name: 'Feelings',
  description: 'Attendance and pay for the Feelings Beauty Care team.',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  lang: 'en-IN',
  dir: 'ltr',
  categories: ['business', 'productivity'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    {
      name: 'Check in',
      url: '/?action=punch',
      icons: [{ src: '/icons/sc-checkin-96.png', sizes: '96x96' }],
    },
    {
      name: 'Today (owner)',
      url: '/o/today',
      icons: [{ src: '/icons/sc-today-96.png', sizes: '96x96' }],
    },
  ],
  screenshots: [
    {
      src: '/screens/staff-today-390.png',
      sizes: '780x1688',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Check in from the salon',
    },
    {
      src: '/screens/owner-register-1280.png',
      sizes: '1280x800',
      type: 'image/png',
      form_factor: 'wide',
      label: 'Monthly register',
    },
  ],
};

const APP = '/?mock=1&allowBrowser=1';
const WHITE: Rgba = [255, 255, 255, 255];

function onlyAndroid(info: TestInfo): void {
  test.skip(info.project.name !== 'staff-android', 'Chromium-only PWA checks run on staff-android');
}

/** Uses the app's registration when it made one, else registers /sw.js the same way. */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!(await navigator.serviceWorker.getRegistration('/')))
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
}

// ---- A small PNG reader (8-bit, non-interlaced), enough to check sizes and pixels ---------------

type Rgba = [number, number, number, number];
interface Png {
  width: number;
  height: number;
  colorType: number;
  pixel(x: number, y: number): Rgba;
}

const at = (b: Uint8Array, i: number): number => b[i] ?? 0;

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function decodePng(buf: Buffer): Png {
  const { width, height } = pngSize(buf);
  const bitDepth = at(buf, 24);
  const colorType = at(buf, 25);
  const interlace = at(buf, 28);
  expect({ bitDepth, interlace }).toEqual({ bitDepth: 8, interlace: 0 });
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType] ?? 0;
  expect(channels, `colour type ${colorType}`).toBeGreaterThan(0);

  const idat: Buffer[] = [];
  let palette: Buffer = Buffer.alloc(0);
  let trns: Buffer = Buffer.alloc(0);
  for (let pos = 8; pos < buf.length; ) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = at(raw, y * (stride + 1));
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? at(out, y * stride + x - channels) : 0;
      const b = y > 0 ? at(out, (y - 1) * stride + x) : 0;
      const c = x >= channels && y > 0 ? at(out, (y - 1) * stride + x - channels) : 0;
      let v = at(raw, line + x);
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }

  return {
    width,
    height,
    colorType,
    pixel(x, y) {
      const i = (y * width + x) * channels;
      switch (colorType) {
        case 0:
          return [at(out, i), at(out, i), at(out, i), 255];
        case 2:
          return [at(out, i), at(out, i + 1), at(out, i + 2), 255];
        case 3: {
          const p = at(out, i);
          const alpha = p < trns.length ? at(trns, p) : 255;
          return [at(palette, p * 3), at(palette, p * 3 + 1), at(palette, p * 3 + 2), alpha];
        }
        case 4:
          return [at(out, i), at(out, i), at(out, i), at(out, i + 1)];
        default:
          return [at(out, i), at(out, i + 1), at(out, i + 2), at(out, i + 3)];
      }
    },
  };
}

function corners(png: Png): Rgba[] {
  const r = png.width - 1;
  const b = png.height - 1;
  return [png.pixel(0, 0), png.pixel(r, 0), png.pixel(0, b), png.pixel(r, b)];
}

/** Share of pixels (on a coarse grid) that match `test`. */
function share(png: Png, test: (p: Rgba) => boolean): number {
  let hit = 0;
  let total = 0;
  for (let y = 0; y < png.height; y += 2)
    for (let x = 0; x < png.width; x += 2) {
      total++;
      if (test(png.pixel(x, y))) hit++;
    }
  return hit / total;
}
const darkShare = (png: Png): number => share(png, (p) => p[0] < 80 && p[1] < 80 && p[2] < 80);
const whiteShare = (png: Png): number => share(png, (p) => p[3] > 200 && p[0] > 200 && p[1] > 200);

function expectOpaque(png: Png, name: string): void {
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const alpha = png.pixel(x, y)[3];
      if (alpha !== 255)
        throw new Error(`${name}: transparent pixel at ${x},${y} (alpha ${alpha})`);
    }
}

async function fetchPng(request: APIRequestContext, url: string): Promise<Buffer> {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  expect(res.headers()['content-type'], url).toContain('image/png');
  return res.body();
}

function sizeOf(sizes: string): { width: number; height: number } {
  const [w, h] = sizes.split('x').map(Number);
  return { width: w ?? 0, height: h ?? 0 };
}

// ---- Tests -------------------------------------------------------------------------------------

test.describe('PWA', () => {
  test('X-02.1 Chromium finds no installability errors', async ({ page }, testInfo) => {
    onlyAndroid(testInfo);
    await page.goto(APP);
    await serviceWorkerReady(page);
    const cdp = await page.context().newCDPSession(page);
    await expect
      .poll(async () => (await cdp.send('Page.getAppManifest')).url, { timeout: 15_000 })
      .toContain('/manifest.webmanifest');
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    // Playwright contexts are off-the-record profiles; Lighthouse ignored `in-incognito` the same way.
    await expect
      .poll(
        async () =>
          (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors
            .filter((e) => e.errorId !== 'in-incognito')
            .map((e) => e.errorId),
        { timeout: 15_000 },
      )
      .toEqual([]);
  });

  test('X-02.2 the app shell loads offline after the first visit', async ({
    page,
    context,
  }, testInfo) => {
    onlyAndroid(testInfo);
    await page.goto(APP);
    await expect(page.locator('#root > *').first()).toBeVisible();
    await serviceWorkerReady(page);

    await context.setOffline(true);
    try {
      const response = await page.reload();
      expect(response?.fromServiceWorker()).toBe(true);
      await expect(page.locator('#root > *').first()).toBeVisible();
      await expect(page.locator('h1').first()).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test('X-02.3 manifest, icons, apple-touch-icon and splash images are present and valid', async ({
    request,
  }, testInfo) => {
    onlyAndroid(testInfo);
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(PRD_MANIFEST);

    // Manifest icons: any + maskable PNGs at their declared sizes, opaque white with the black logo mark.
    for (const icon of PRD_MANIFEST.icons) {
      if (icon.type === 'image/svg+xml') {
        const svg = await request.get(icon.src);
        expect(svg.status(), icon.src).toBe(200);
        expect(svg.headers()['content-type'], icon.src).toContain('image/svg+xml');
        expect(await svg.text()).toContain('<path');
        continue;
      }
      const png = decodePng(await fetchPng(request, icon.src));
      expect({ width: png.width, height: png.height }, icon.src).toEqual(sizeOf(icon.sizes));
      expect(corners(png), `${icon.src} corners`).toEqual([WHITE, WHITE, WHITE, WHITE]);
      // The logo is drawn in black: a visible share of the pixels is dark, the edges stay white.
      expect(darkShare(png), `${icon.src} dark pixels`).toBeGreaterThan(0.03);
      if (icon.purpose === 'maskable') expectOpaque(png, icon.src);
    }

    // Shortcut icons: 96 px, opaque, sindoor glyph on white (shortcuts keep their own glyphs).
    for (const shortcut of PRD_MANIFEST.shortcuts) {
      for (const icon of shortcut.icons) {
        const png = decodePng(await fetchPng(request, icon.src));
        expect({ width: png.width, height: png.height }, icon.src).toEqual(sizeOf(icon.sizes));
        expectOpaque(png, icon.src);
      }
    }

    // Head links: manifest, apple-touch-icon (no transparency), splash images per iPhone size.
    const html = await (await request.get('/')).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    const touch = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
    expect(touch).toBe('/icons/apple-touch-icon-180.png');
    const apple = decodePng(await fetchPng(request, touch ?? ''));
    expect({ width: apple.width, height: apple.height }).toEqual({ width: 180, height: 180 });
    expectOpaque(apple, 'apple-touch-icon');

    const splash = [...html.matchAll(/<link\b[^>]*rel="apple-touch-startup-image"[^>]*>/g)].map(
      ([tag]) => ({
        media: /media="([^"]+)"/.exec(tag)?.[1] ?? '',
        href: /href="([^"]+)"/.exec(tag)?.[1] ?? '',
      }),
    );
    expect(splash.length).toBeGreaterThanOrEqual(10);
    for (const { media, href } of splash) {
      const w = Number(/device-width: (\d+)px/.exec(media)?.[1]);
      const h = Number(/device-height: (\d+)px/.exec(media)?.[1]);
      const ratio = Number(/device-pixel-ratio: (\d+)/.exec(media)?.[1]);
      expect(media, href).toContain('(orientation: portrait)');
      expect(pngSize(await fetchPng(request, href)), href).toEqual({
        width: w * ratio,
        height: h * ratio,
      });
    }

    // Android badge: monochrome white face line art on transparent. Favicon: 32 px.
    const badge = decodePng(await fetchPng(request, '/icons/badge-96.png'));
    expect({ width: badge.width, height: badge.height }).toEqual({ width: 96, height: 96 });
    expect(corners(badge).map((p) => p[3])).toEqual([0, 0, 0, 0]);
    expect(whiteShare(badge)).toBeGreaterThan(0.03);
    expect(pngSize(await fetchPng(request, '/favicon-32.png'))).toEqual({ width: 32, height: 32 });
  });
});
