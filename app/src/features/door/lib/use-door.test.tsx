import type { ApiClient } from '@fs/contracts';
import { toBase64Url } from '@fs/contracts';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../api/provider';
import { createMemoryDoorStore } from './store';
import { useDoor } from './use-door';

const OLD = toBase64Url(new Uint8Array(32).fill(1));
const NEW = toBase64Url(new Uint8Array(32).fill(2));

function client(secret: string): ApiClient {
  return {
    time: vi.fn(async () => ({ serverTime: 1792386720000, timeSig: 's' })),
    doorStatus: vi.fn(async () => ({ lastCheckIn: null, serverTime: 1792386720000 })),
    doorSecret: vi.fn(async () => ({ secret, secretVersion: 2, serverTime: 1792386720000 })),
  } as unknown as ApiClient;
}

describe('door kiosk secret sync (O-10.4)', () => {
  it('O-10.4 takes the new secret after the owner rotates it and keeps it for the next start', async () => {
    const store = createMemoryDoorStore({
      doorDeviceId: 'd',
      siteId: 's',
      siteName: 'Salon',
      secret: OLD,
    });
    const api = client(NEW);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider client={api}>{children}</ApiProvider>
    );
    const { result } = renderHook(() => useDoor({ store, origin: 'https://staff.test' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.pairing?.secret).toBe(NEW));
    expect((await store.get())?.secret).toBe(NEW);
    expect(api.doorSecret).toHaveBeenCalled();
  });

  it('O-10.4 leaves the secret alone when it did not change or the server cannot be reached', async () => {
    const store = createMemoryDoorStore({
      doorDeviceId: 'd',
      siteId: 's',
      siteName: 'Salon',
      secret: OLD,
    });
    const api = client(OLD);
    (api.doorSecret as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('offline'),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider client={api}>{children}</ApiProvider>
    );
    const { result } = renderHook(() => useDoor({ store }), { wrapper });
    await waitFor(() => expect(result.current.synced).toBe(true));
    expect(result.current.pairing?.secret).toBe(OLD);
  });
});
