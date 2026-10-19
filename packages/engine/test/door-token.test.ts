/** Door QR tokens (PRD 4.5, S-06.1, S-06.3, O-10.4). */
import { describe, expect, it } from 'vitest';
import {
  DOOR_STEP_MS,
  doorStep,
  doorToken,
  isDoorTokenShape,
  matchDoorToken,
} from '../src/risk/door-token';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const secretA = new Uint8Array(32).map((_, i) => i + 1);
const secretB = new Uint8Array(32).map((_, i) => 200 - i);
const NOW = Date.parse('2026-10-19T10:04:10+05:30');

/** Independent reference for the packing: the top 50 bits of the MAC as ten 5-bit digits. */
async function reference(secret: Uint8Array<ArrayBuffer>, step: number): Promise<string> {
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(0, Math.floor(step / 2 ** 32));
  new DataView(msg).setUint32(4, step % 2 ** 32);
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  let n = 0n;
  for (let i = 0; i < 7; i++) n = (n << 8n) | BigInt(mac[i] as number);
  n >>= 6n; // 56 bits -> 50 bits
  let out = '';
  for (let i = 9; i >= 0; i--) out += CROCKFORD[Number((n >> BigInt(i * 5)) & 31n)];
  return out;
}

describe('doorToken', () => {
  it('matches the reference HMAC + base32 for several steps', async () => {
    for (const step of [0, 1, 59_746_224, doorStep(NOW), 2 ** 40 + 7]) {
      expect(await doorToken(secretA, step)).toBe(await reference(secretA, step));
    }
  });

  it('is ten Crockford characters and stable for a step', async () => {
    const t = await doorToken(secretA, doorStep(NOW));
    expect(t).toHaveLength(10);
    expect(isDoorTokenShape(t)).toBe(true);
    expect(await doorToken(secretA, doorStep(NOW))).toBe(t);
    expect(await doorToken(secretA, doorStep(NOW) + 1)).not.toBe(t);
  });

  it('steps every 30 seconds', () => {
    expect(DOOR_STEP_MS).toBe(30_000);
    expect(doorStep(0)).toBe(0);
    expect(doorStep(29_999)).toBe(0);
    expect(doorStep(30_000)).toBe(1);
  });

  it.each([
    ['K3M7Q9X2PD', true],
    ['k3m7q9x2pd', false],
    ['K3M7Q9X2P', false],
    ['K3M7Q9X2PDX', false],
    ['K3M7Q9X2PU', false],
    ['ILOU000000', false],
  ])('shape of %s is %s', (token, ok) => {
    expect(isDoorTokenShape(token)).toBe(ok);
  });
});

describe('S-06.1 current and previous 30 s step are accepted, older is rejected', () => {
  it('accepts the current step', async () => {
    const step = doorStep(NOW);
    expect(await matchDoorToken(secretA, await doorToken(secretA, step), NOW)).toBe(step);
  });

  it('accepts the previous step', async () => {
    const step = doorStep(NOW) - 1;
    expect(await matchDoorToken(secretA, await doorToken(secretA, step), NOW)).toBe(step);
  });

  it('rejects a token two steps old', async () => {
    const token = await doorToken(secretA, doorStep(NOW) - 2);
    expect(await matchDoorToken(secretA, token, NOW)).toBeNull();
  });

  it('rejects a token from the future', async () => {
    const token = await doorToken(secretA, doorStep(NOW) + 1);
    expect(await matchDoorToken(secretA, token, NOW)).toBeNull();
  });
});

describe('S-06.3 / O-10.4 another secret (another site, or a rotated secret) is rejected', () => {
  it('rejects a token made with another secret', async () => {
    const token = await doorToken(secretB, doorStep(NOW));
    expect(await matchDoorToken(secretA, token, NOW)).toBeNull();
  });

  it('rejects text that is not a door token without hashing', async () => {
    expect(await matchDoorToken(secretA, 'not-a-code', NOW)).toBeNull();
  });
});
