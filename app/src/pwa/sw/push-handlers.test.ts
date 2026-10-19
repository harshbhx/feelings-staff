// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPushHandlers } from './push-handlers';

type Listener = (event: unknown) => void;

function setup(existingClients: Array<Record<string, unknown>> = []) {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const openWindow = vi.fn(async () => null);
  const sw = {
    location: { origin: 'https://staff.test' },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', setAppBadge: vi.fn(async () => {}) },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    clients: { matchAll: vi.fn(async () => existingClients), openWindow },
    addEventListener: (name: string, fn: Listener) => listeners.set(name, fn),
  };
  registerPushHandlers(sw as never);
  return { sw, shown, openWindow, fire: (name: string, e: unknown) => listeners.get(name)?.(e) };
}

async function push(fire: (n: string, e: unknown) => void, data: { json: () => unknown } | null) {
  const waits: Promise<unknown>[] = [];
  fire('push', { data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  expect(waits).toHaveLength(1);
  await Promise.all(waits);
}

afterEach(() => vi.unstubAllGlobals());

describe('S-15 push handling in the service worker', () => {
  it('S-15.2 a valid payload shows a notification tagged with the topic and carrying the url', async () => {
    const { shown, sw, fire } = setup();
    await push(fire, {
      json: () => ({
        web_push: 8030,
        notification: {
          title: 'Priya checked in',
          body: '10:02',
          navigate: '/o/today',
          lang: 'en-IN',
        },
        t: 'late',
        e: 'evt1',
        topic: 'late-batch',
        badge: 3,
      }),
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('Priya checked in');
    expect(shown[0]?.options.tag).toBe('late-batch');
    expect(shown[0]?.options.data).toEqual({ url: '/o/today', e: 'evt1' });
    expect(sw.navigator.setAppBadge).toHaveBeenCalledWith(3);
  });

  it('S-15.3 a malformed payload still shows the fallback notification', async () => {
    const { shown, fire } = setup();
    await push(fire, {
      json: () => {
        throw new SyntaxError('bad json');
      },
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('Feelings');
    expect(shown[0]?.options.body).toBe('Open the app to see what changed.');
    expect(shown[0]?.options.data).toEqual({ url: '/', e: undefined });
  });

  it('S-15.3 a push with no data still shows the fallback notification', async () => {
    const { shown, fire } = setup();
    await push(fire, null);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('Feelings');
  });

  it('S-15.3 open tabs are told to refetch', async () => {
    const postMessage = vi.fn();
    const { fire } = setup([{ postMessage }]);
    await push(fire, {
      json: () => ({ notification: { title: 'x', navigate: '/' }, t: 'late', e: 'e1' }),
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'push', t: 'late' });
  });

  it('S-15.1 a click opens the url and reports the notification as opened', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fire, openWindow } = setup();
    const close = vi.fn();
    const waits: Promise<unknown>[] = [];
    fire('notificationclick', {
      notification: { close, data: { url: '/o/actions', e: 'evt9' } },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('https://staff.test/o/actions');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/notifications/evt9/opened');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-FS-Client']).toBeTruthy();
  });

  it('S-15.1 a click focuses an existing window and navigates it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const win: Record<string, unknown> = {};
    win.focus = vi.fn(async () => win);
    win.navigate = vi.fn(async () => win);
    const { fire, openWindow } = setup([win]);
    const waits: Promise<unknown>[] = [];
    fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/inbox', e: 'e2' } },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(win.navigate).toHaveBeenCalledWith('https://staff.test/inbox');
    expect(openWindow).not.toHaveBeenCalled();
  });
});
