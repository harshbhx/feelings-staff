import { ApiError, type Me } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { DeviceKeyError } from '../../../lib/device-key';
import type { DeviceRecord } from '../../../lib/idb';
import { enrolDevice, type KeyStore, staffSignIn } from './device';

const me = fixtures.staffLogin as Me;

function record(n: number, over: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    deviceId: null,
    privateKey: { n } as unknown as CryptoKey,
    publicJwk: { kty: 'EC', crv: 'P-256', x: `x${n}`, y: `y${n}` },
    approved: false,
    createdAt: n,
    ...over,
  };
}

function fakeStore(initial: DeviceRecord | null) {
  let current = initial;
  let made = 0;
  const store: KeyStore & { current(): DeviceRecord | null } = {
    getDeviceRecord: async () => current,
    createDeviceKey: async () => {
      made += 1;
      current = record(100 + made);
      return current;
    },
    restore: async (prev) => {
      current = prev;
    },
    sign: async (m) => `sig(${m})`,
    current: () => current,
  };
  return store;
}

describe('device enrolment (PRD 4.1.4, 4.1.6)', () => {
  it('join reuses an approved key on this phone (PIN reset keeps the phone approved)', async () => {
    const approved = record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02', approved: true });
    const keys = fakeStore(approved);
    const send = vi.fn(async (jwk: { x: string }) => jwk.x);
    const out = await enrolDevice(send, { reuseApproved: true }, keys);
    expect(out.result).toBe('x1');
    expect(out.reused).toBe(true);
    expect(keys.current()).toBe(approved);
  });

  it('a new phone always gets a fresh key', async () => {
    const keys = fakeStore(record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02', approved: true }));
    const out = await enrolDevice(async (jwk) => jwk.x, { reuseApproved: false }, keys);
    expect(out.result).toBe('x101');
    expect(out.reused).toBe(false);
  });

  it('a key the server has seen for someone else is replaced once', async () => {
    const keys = fakeStore(record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02', approved: true }));
    const send = vi
      .fn<(jwk: { x: string }) => Promise<string>>()
      .mockRejectedValueOnce(
        new ApiError({ code: 'CONFLICT', status: 409, details: { reason: 'device_key_used' } }),
      )
      .mockImplementation(async (jwk) => jwk.x);
    const out = await enrolDevice(send, { reuseApproved: true }, keys);
    expect(send).toHaveBeenCalledTimes(2);
    expect(out.result).toBe('x101');
  });

  it('a failed enrolment puts the old key back, so a typo never costs an approved phone', async () => {
    const old = record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02', approved: true });
    const keys = fakeStore(old);
    await expect(
      enrolDevice(
        async () => {
          throw new ApiError({ code: 'PIN_WRONG', status: 401, details: { triesLeft: 4 } });
        },
        { reuseApproved: false },
        keys,
      ),
    ).rejects.toMatchObject({ code: 'PIN_WRONG' });
    expect(keys.current()).toBe(old);
  });
});

describe('staff sign-in (PRD 4.1.6, S-02.1)', () => {
  it('S-02.1 signs the challenge nonce and sends phone, PIN, device id and signature', async () => {
    const keys = fakeStore(record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02', approved: true }));
    const staffLogin = vi.fn(async () => me);
    const api = {
      authChallenge: vi.fn(async () => ({ nonce: 'abc', expiresAt: 1 })),
      staffLogin,
    };
    await expect(staffSignIn(api, { phone: '+919825011201', pin: '2580' }, keys)).resolves.toBe(me);
    expect(api.authChallenge).toHaveBeenCalledWith({ query: { purpose: 'login' } });
    expect(staffLogin).toHaveBeenCalledWith({
      body: {
        phone: '+919825011201',
        pin: '2580',
        deviceId: '01K8D7M7J8T2CCGWBT278DBM02',
        nonce: 'abc',
        signature: 'sig(abc)',
      },
    });
  });

  it('fetches a new challenge once when the nonce expired', async () => {
    const keys = fakeStore(record(1, { deviceId: '01K8D7M7J8T2CCGWBT278DBM02' }));
    let n = 0;
    const api = {
      authChallenge: vi.fn(async () => ({ nonce: `n${++n}`, expiresAt: 1 })),
      staffLogin: vi
        .fn<() => Promise<Me>>()
        .mockRejectedValueOnce(new ApiError({ code: 'NONCE_INVALID', status: 409 }))
        .mockResolvedValue(me),
    };
    await staffSignIn(api, { phone: '+919825011201', pin: '2580' }, keys);
    expect(api.authChallenge).toHaveBeenCalledTimes(2);
    expect(api.staffLogin).toHaveBeenCalledTimes(2);
  });

  it('needs a registered key on this phone', async () => {
    const api = { authChallenge: vi.fn(), staffLogin: vi.fn() };
    await expect(
      staffSignIn(api, { phone: '+919825011201', pin: '2580' }, fakeStore(record(1))),
    ).rejects.toBeInstanceOf(DeviceKeyError);
    expect(api.authChallenge).not.toHaveBeenCalled();
  });
});
