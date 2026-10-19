/**
 * The nightly job at 03:00 IST (PRD 9.5, 8.3, 10.9) on a fake clock: absent marking, the retention
 * purge row by row, comp-off expiry, CL/SL credit on 1 January. Covers X-03.2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../services/registry';
import { fakeDayService } from '../test/fakes';
import { testEnv } from '../test/helpers';
import { addUser, DAY, ist, newSalon, type Salon } from '../test/notify-kit';
import { runJob } from './index';

afterEach(() => setServiceOverridesForTests(null));

const DAY_MS = 86_400_000;
const nightly = (at: number) => runJob('nightly', testEnv, at);
const count = async (sql: string, ...p: (string | number)[]) =>
  (
    await testEnv.DB.prepare(sql)
      .bind(...p)
      .first<{ n: number }>()
  )?.n ?? 0;

async function punchAt(
  salon: Salon,
  userId: string,
  createdAt: number,
  selfieKey: string | null = null,
) {
  const id = `P${createdAt}${Math.random().toString(36).slice(2, 8)}`;
  await testEnv.DB.prepare(
    `INSERT INTO punches (id, org_id, user_id, kind, server_ts, effective_ts, work_date, source, status, idempotency_key,
                          lat, lng, accuracy_m, distance_m, fence_result, selfie_key, created_at)
     VALUES (?1, ?2, ?3, 'in', ?4, ?4, ?5, 'online', 'accepted', ?1, 22.46, 70.05, 12, 30, 'pass', ?6, ?4)`,
  )
    .bind(id, salon.orgId, userId, createdAt, DAY, selfieKey)
    .run();
  return id;
}

describe('absent marking', () => {
  it('recomputes the previous work date for everyone employed then, once', async () => {
    const salon = await newSalon();
    const priya = await addUser(salon, { name: 'Priya' });
    const kajal = await addUser(salon, { name: 'Kajal' });
    await addUser(salon, { name: 'Joiner', joinDate: '2026-10-20' }); // not yet employed on the 19th
    const days = fakeDayService();
    setServiceOverridesForTests({ days });
    const at = ist('03:00', '2026-10-20');
    await nightly(at);
    await nightly(at + 300_000);
    expect(days.calls.map(([u, d]) => `${u}|${d}`).sort()).toEqual(
      [`${priya}|${DAY}`, `${kajal}|${DAY}`].sort(),
    );
  });
});

describe('X-03.2 retention purge (PRD 8.3)', () => {
  it('X-03.2 removes data per PRD 8.3 on a fake clock and leaves younger data', async () => {
    const salon = await newSalon();
    const priya = await addUser(salon, { name: 'Priya' });
    setServiceOverridesForTests({ days: fakeDayService() });
    const now = ist('03:00', '2026-10-20');
    const old = (days: number) => now - days * DAY_MS;

    const oldPunch = await punchAt(salon, priya, old(100));
    const youngPunch = await punchAt(salon, priya, old(10));
    const selfiePunch = await punchAt(salon, priya, old(40), 'selfies/a.jpg');
    await testEnv.MEDIA.put('selfies/a.jpg', 'x');

    const db = testEnv.DB;
    const insertUser = salon.ownerId;
    await db.batch([
      // notifications: 180 days
      db
        .prepare(
          `INSERT INTO notifications (id, org_id, user_id, type, title, url, priority, created_at)
           VALUES ('N-old', ?1, ?2, 'late_checkin', 't', '/', 'normal', ?3), ('N-new', ?1, ?2, 'late_checkin', 't', '/', 'normal', ?4)`,
        )
        .bind(salon.orgId, insertUser, old(200), old(5)),
      // sessions: expiry + 7 days
      db
        .prepare(
          `INSERT INTO sessions (token_hash, org_id, kind, user_id, created_at, last_seen_at, expires_at)
           VALUES ('S-old', ?1, 'user', ?2, ?3, ?3, ?4), ('S-new', ?1, 'user', ?2, ?3, ?3, ?5)`,
        )
        .bind(salon.orgId, insertUser, old(30), old(10), now + DAY_MS),
      db
        .prepare(
          `INSERT INTO challenges (nonce, org_id, purpose, expires_at) VALUES ('C-old', ?1, 'login', ?2), ('C-new', ?1, 'login', ?3)`,
        )
        .bind(salon.orgId, old(9), now + 1000),
      db
        .prepare(
          `INSERT INTO magic_links (id, email, token_hash, code_hash, expires_at, created_at)
           VALUES ('M-old', 'a@b.c', 'th1', 'ch1', ?1, ?1), ('M-new', 'a@b.c', 'th2', 'ch2', ?2, ?2)`,
        )
        .bind(old(9), now + 1000),
      // salon networks: 7 days since last seen
      db
        .prepare(
          `INSERT INTO salon_networks (org_id, ip_hmac, first_seen, last_seen) VALUES (?1, 'ip-old', ?2, ?2), (?1, 'ip-new', ?3, ?3)`,
        )
        .bind(salon.orgId, old(20), old(1)),
      // security audit: 1 year; change audit stays (5 years)
      db
        .prepare(
          `INSERT INTO audit_log (id, org_id, category, actor_type, action, entity, created_at)
           VALUES ('A-sec-old', ?1, 'security', 'system', 'x', 'e', ?2), ('A-sec-new', ?1, 'security', 'system', 'x', 'e', ?3),
                  ('A-chg-old', ?1, 'change', 'system', 'x', 'e', ?2)`,
        )
        .bind(salon.orgId, old(400), old(30)),
      // devices: revoked + 30 days
      db
        .prepare(
          `INSERT INTO devices (id, org_id, user_id, public_jwk, jwk_thumbprint, label, platform, status, requested_at, decided_at)
           VALUES ('DV-old', ?1, ?2, '{}', 'tp1', 'x', 'android', 'revoked', ?3, ?3), ('DV-new', ?1, ?2, '{}', 'tp2', 'x', 'android', 'revoked', ?4, ?4)`,
        )
        .bind(salon.orgId, priya, old(60), old(5)),
      // idempotency keys and test outbox
      db
        .prepare(
          `INSERT INTO idempotency_keys (org_id, user_id, key, endpoint, status, created_at) VALUES (?1, ?2, 'k-old', 'e', 200, ?3), (?1, ?2, 'k-new', 'e', 200, ?4)`,
        )
        .bind(salon.orgId, priya, old(10), old(1)),
    ]);

    const first = await nightly(now);
    const counts = (first.perOrg as Record<string, Record<string, number>>)[salon.orgId] ?? {};

    // Location detail nulled after 90 days; fence result kept; younger punch untouched.
    const oldRow = await db
      .prepare('SELECT lat, accuracy_m, distance_m, fence_result FROM punches WHERE id = ?1')
      .bind(oldPunch)
      .first<{
        lat: number | null;
        accuracy_m: number | null;
        distance_m: number | null;
        fence_result: string;
      }>();
    expect(oldRow).toEqual({ lat: null, accuracy_m: null, distance_m: null, fence_result: 'pass' });
    const youngRow = await db
      .prepare('SELECT lat FROM punches WHERE id = ?1')
      .bind(youngPunch)
      .first<{ lat: number | null }>();
    expect(youngRow?.lat).toBe(22.46);

    // Selfie past 30 days: file removed, row stamped.
    expect(await testEnv.MEDIA.get('selfies/a.jpg')).toBeNull();
    const selfieRow = await db
      .prepare('SELECT selfie_deleted_at FROM punches WHERE id = ?1')
      .bind(selfiePunch)
      .first<{ selfie_deleted_at: number | null }>();
    expect(selfieRow?.selfie_deleted_at).toBe(now);

    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE id = 'N-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM notifications WHERE id = 'N-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'S-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'S-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM challenges WHERE nonce = 'C-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM challenges WHERE nonce = 'C-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM magic_links WHERE id = 'M-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM magic_links WHERE id = 'M-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM salon_networks WHERE ip_hmac = 'ip-old'")).toBe(
      0,
    );
    expect(await count("SELECT COUNT(*) AS n FROM salon_networks WHERE ip_hmac = 'ip-new'")).toBe(
      1,
    );
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE id = 'A-sec-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE id = 'A-sec-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE id = 'A-chg-old'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM devices WHERE id = 'DV-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM devices WHERE id = 'DV-new'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM idempotency_keys WHERE key = 'k-old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM idempotency_keys WHERE key = 'k-new'")).toBe(1);

    // The audit row records the counts.
    const audit = await db
      .prepare("SELECT actor_type, after_json FROM audit_log WHERE action = 'retention.purge'")
      .first<{ actor_type: string; after_json: string }>();
    expect(audit?.actor_type).toBe('system');
    expect(JSON.parse(audit?.after_json ?? '{}').notifications).toBe(1);
    expect(counts.purged_notifications).toBe(1);

    // Idempotent: a second run the same night purges nothing more and writes no second row.
    await nightly(now + 300_000);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'retention.purge'"),
    ).toBe(1);
  });

  it('X-03.2 purges more than one batch of 500 rows', async () => {
    const salon = await newSalon();
    const now = ist('03:00', '2026-10-20');
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 620; i++)
      stmts.push(
        testEnv.DB.prepare(
          `INSERT INTO notifications (id, org_id, user_id, type, title, url, priority, created_at)
           VALUES (?1, ?2, ?3, 'late_checkin', 't', '/', 'normal', ?4)`,
        ).bind(`NB${i}`, salon.orgId, salon.ownerId, now - 400 * DAY_MS),
      );
    for (let i = 0; i < stmts.length; i += 100) await testEnv.DB.batch(stmts.slice(i, i + 100));
    await nightly(now);
    expect(await count('SELECT COUNT(*) AS n FROM notifications')).toBe(0);
  });

  it('X-03.2 on the 1st it also removes wage records five years after a person left', async () => {
    const salon = await newSalon();
    const gone = await addUser(salon, {
      name: 'Old hand',
      exitDate: '2020-01-15',
      status: 'exited',
    });
    const stays = await addUser(salon, { name: 'Current' });
    setServiceOverridesForTests({ days: fakeDayService() });
    const old = ist('10:00', '2019-06-03');
    await punchAt(salon, gone, old);
    await punchAt(salon, stays, old);
    await nightly(ist('03:00', '2026-11-01'));
    expect(await count('SELECT COUNT(*) AS n FROM punches WHERE user_id = ?1', gone)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM punches WHERE user_id = ?1', stays)).toBe(1);
  });

  it('X-03.2 clears phone and consents 30 days after exit', async () => {
    const salon = await newSalon();
    const gone = await addUser(salon, { name: 'Left', exitDate: '2026-09-01', status: 'exited' });
    await testEnv.DB.prepare(
      `INSERT INTO consents (id, org_id, user_id, kind, version, lang, accepted_at) VALUES ('CN1', ?1, ?2, 'privacy_notice', 'v', 'en', ?3)`,
    )
      .bind(salon.orgId, gone, Date.now())
      .run();
    setServiceOverridesForTests({ days: fakeDayService() });
    await nightly(ist('03:00', '2026-10-20'));
    const u = await testEnv.DB.prepare('SELECT phone_e164 FROM users WHERE id = ?1')
      .bind(gone)
      .first<{ phone_e164: string | null }>();
    expect(u?.phone_e164).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM consents WHERE id = 'CN1'")).toBe(0);
  });
});

describe('leave jobs', () => {
  async function coType(salon: Salon): Promise<string> {
    const r = await testEnv.DB.prepare(
      "SELECT id FROM leave_types WHERE org_id = ?1 AND code = 'CO'",
    )
      .bind(salon.orgId)
      .first<{ id: string }>();
    return r?.id ?? '';
  }

  it('lapses unused comp-off past its expiry date, once', async () => {
    const salon = await newSalon();
    const priya = await addUser(salon, { name: 'Priya' });
    const co = await coType(salon);
    setServiceOverridesForTests({ days: fakeDayService() });
    const ledger = (id: string, kind: string, days: number, expires: string | null) =>
      testEnv.DB.prepare(
        `INSERT INTO leave_ledger (id, org_id, user_id, leave_type_id, entry_date, kind, days, expires_on, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, '2026-08-01', ?5, ?6, ?7, 'x', 1)`,
      ).bind(id, salon.orgId, priya, co, kind, days, expires);
    await testEnv.DB.batch([
      ledger('L1', 'credit', 1, '2026-10-01'),
      ledger('L2', 'credit', 1, '2026-12-01'),
      ledger('L3', 'debit', 0.5, null),
    ]);
    await nightly(ist('03:00', '2026-10-20'));
    const rows = await testEnv.DB.prepare(
      "SELECT days FROM leave_ledger WHERE kind = 'expire' AND user_id = ?1",
    )
      .bind(priya)
      .all<{ days: number }>();
    expect(rows.results.map((r) => r.days)).toEqual([1]);
    await nightly(ist('03:00', '2026-10-21'));
    expect(await count("SELECT COUNT(*) AS n FROM leave_ledger WHERE kind = 'expire'")).toBe(1);
  });

  it('credits CL and SL on 1 January, once per person and year', async () => {
    const salon = await newSalon();
    const priya = await addUser(salon, { name: 'Priya' });
    setServiceOverridesForTests({ days: fakeDayService() });
    await nightly(ist('03:00', '2027-01-01'));
    const rows = await testEnv.DB.prepare(
      `SELECT t.code, l.days FROM leave_ledger l JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.user_id = ?1 AND l.ref_type = 'annual' ORDER BY t.code`,
    )
      .bind(priya)
      .all<{ code: string; days: number }>();
    expect(rows.results).toEqual([
      { code: 'CL', days: 7 },
      { code: 'SL', days: 7 },
    ]);
    await nightly(ist('03:05', '2027-01-01'));
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM leave_ledger WHERE user_id = ?1 AND ref_type = 'annual'",
        priya,
      ),
    ).toBe(2);
  });
});
