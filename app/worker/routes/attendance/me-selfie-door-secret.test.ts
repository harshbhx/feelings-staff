/** WP-4: the staff selfie route (S-16) and the door secret a rotation hands to the device (O-10.4). */
import { fromBase64Url } from '@fs/contracts';
import { doorToken } from '@fs/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDoorToken } from '../../services/door';
import { call, callJson, testEnv } from '../../test/helpers';
import { ctxAt, ist, setSettings } from '../../test/notify-kit';
import { cookieFrom, setClock } from '../auth/test/kit';
import { addPhone, expectStatus, type Harness, harness, jpeg, punch } from './test/punch-kit';

let h: Harness;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await setClock(null);
});

describe('S-16 My own selfie', () => {
  async function withSelfie() {
    await setSettings(h.salon, (s) => {
      (s.attendance as Record<string, unknown>).selfieOnCheckIn = true;
    });
    const { bytes, sha } = await jpeg();
    const res = await punch(h, { selfieSha256: sha }, { selfie: bytes });
    expectStatus(res, 200);
    return { id: res.body.punch.id, bytes };
  }

  it('S-16.1 a person can open their own kept selfie', async () => {
    const { id, bytes } = await withSelfie();
    const res = await call('GET', `/me/punches/${id}/selfie`, { cookie: h.phone.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toHaveLength(bytes.length);
  });

  it('S-16.1 nobody else can open it, and a deleted selfie is gone', async () => {
    const other = await addPhone(h.salon, h.owner, { name: 'Neha Parmar' });
    const { id } = await withSelfie();
    const stranger = await call('GET', `/me/punches/${id}/selfie`, { cookie: other.cookie });
    expect(stranger.status).toBe(404);
    await testEnv.DB.prepare('UPDATE punches SET selfie_deleted_at = ?2 WHERE id = ?1')
      .bind(id, Date.now())
      .run();
    const gone = await call('GET', `/me/punches/${id}/selfie`, { cookie: h.phone.cookie });
    expect(gone.status).toBe(404);
  });
});

describe('O-10.4 Door secret after a rotation', () => {
  it('O-10.4 the device reads its current secret, and a rotation changes it', async () => {
    await h.at(ist('13:00'));
    const made = await callJson<{ doorDeviceId: string; pairingCode: string }>(
      'POST',
      '/owner/door-devices',
      { cookie: h.owner, body: { label: 'Front desk tablet' } },
    );
    const paired = await call('POST', '/door/pair', {
      body: { pairingCode: made.body.pairingCode },
    });
    const door = cookieFrom(paired);
    const first = (await paired.json()) as { secret: string };
    const now = h.clock;
    const same = await callJson<{ secret: string; secretVersion: number }>('GET', '/door/secret', {
      cookie: door,
    });
    expect(same.status).toBe(200);
    expect(same.body.secret).toBe(first.secret);
    expect(same.body.secretVersion).toBe(1);

    const rotated = await callJson('POST', `/owner/door-devices/${made.body.doorDeviceId}/rotate`, {
      cookie: h.owner,
    });
    expect(rotated.status).toBe(200);
    const next = await callJson<{ secret: string; secretVersion: number }>('GET', '/door/secret', {
      cookie: door,
    });
    expect(next.body.secretVersion).toBe(2);
    expect(next.body.secret).not.toBe(first.secret);
    const token = await doorToken(fromBase64Url(next.body.secret), Math.floor(now / 30_000));
    expect((await checkDoorToken(await ctxAt(h.salon, now), token, now)).ok).toBe(true);
  });

  it('O-10.4 only a paired door session can read it', async () => {
    const staffRes = await call('GET', '/door/secret', { cookie: h.phone.cookie });
    expect(staffRes.status).toBe(403);
    const anon = await call('GET', '/door/secret');
    expect(anon.status).toBe(401);
  });
});
