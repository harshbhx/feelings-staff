/**
 * WP-8 P1 on a fake clock (PRD 6): WhatsApp escalation (O-20), weekly digest N30 and the payroll
 * emails N24 and N25 (O-21). Nothing real is sent: WhatsApp goes to the preview outbox, email to a
 * fake sender.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../services/registry';
import { fakeEmail, fakePush } from '../test/fakes';
import { testEnv } from '../test/helpers';
import {
  addUser,
  DAY,
  emitAt,
  ist,
  newSalon,
  type Salon,
  setSettings,
  subscribe,
} from '../test/notify-kit';
import { runJob } from './index';

afterEach(() => setServiceOverridesForTests(null));

const rules = (at: number) => runJob('rules', testEnv, at);
const OWNER_PHONE = '+919800000001';

async function world(opts: { whatsapp?: boolean } = {}) {
  const salon = await newSalon();
  const kajal = await addUser(salon, { name: 'Kajal' });
  for (const id of [salon.ownerId, kajal]) await subscribe(salon, id);
  await testEnv.DB.prepare('UPDATE users SET phone_e164 = ?1, email = ?2 WHERE id = ?3')
    .bind(OWNER_PHONE, 'owner@feelings.test', salon.ownerId)
    .run();
  if (opts.whatsapp !== false) {
    await setSettings(salon, (s) => {
      (s.notifications as Record<string, unknown>).whatsappFallback = true;
    });
  }
  const push = fakePush();
  const email = fakeEmail();
  setServiceOverridesForTests({ push, email });
  return { salon, kajal, push, email };
}

/** N3 for Kajal (no punch) is raised by the rules job at shift start + 30 min. */
const notInYet = (_s: Salon, _kajal: string, at: number) => rules(at);

async function whatsappOutbox() {
  const res = await testEnv.DB.prepare(
    "SELECT to_addr, payload_json FROM test_outbox WHERE channel = 'whatsapp' ORDER BY created_at, id",
  ).all<{ to_addr: string; payload_json: string }>();
  return res.results;
}

async function waStatus(type: string) {
  const res = await testEnv.DB.prepare(
    'SELECT wa_status FROM notifications WHERE type = ?1 ORDER BY created_at, id',
  )
    .bind(type)
    .all<{ wa_status: string | null }>();
  return res.results.map((r) => r.wa_status);
}

describe('O-20 WhatsApp escalation of unopened critical alerts (PRD 6)', () => {
  it('O-20.1 an unopened not-in-yet push goes to the owner on WhatsApp after 15 minutes, once', async () => {
    const { salon, kajal } = await world();
    await notInYet(salon, kajal, ist('10:30'));
    await rules(ist('10:44'));
    expect(await whatsappOutbox()).toHaveLength(0);
    await rules(ist('10:45'));
    await rules(ist('10:50'));
    const out = await whatsappOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]?.to_addr).toBe(OWNER_PHONE);
    const msg = JSON.parse(out[0]?.payload_json ?? '{}') as { template: string; params: string[] };
    expect(msg.template).toBe('owner_alert');
    expect(msg.params[0]).toBe("Kajal hasn't checked in");
    expect(await waStatus('not_in_yet')).toEqual(['recorded']);
    const audit = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'notify.whatsapp_escalation'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('O-20.2 an alert the owner opened is not escalated', async () => {
    const { salon, kajal } = await world();
    await notInYet(salon, kajal, ist('10:30'));
    await testEnv.DB.prepare('UPDATE notifications SET opened_at = ?1, read_at = ?1')
      .bind(ist('10:40'))
      .run();
    await rules(ist('10:50'));
    expect(await whatsappOutbox()).toHaveLength(0);
  });

  it('O-20.3 a not-in-yet alert is dropped when the person has checked in meanwhile', async () => {
    const { salon, kajal } = await world();
    await notInYet(salon, kajal, ist('10:30'));
    await testEnv.DB.prepare(
      `INSERT INTO punches (id, org_id, user_id, kind, server_ts, effective_ts, work_date, source, status, idempotency_key, created_at)
       VALUES ('PU1', ?1, ?2, 'in', ?3, ?3, ?4, 'online', 'accepted', 'k1', ?3)`,
    )
      .bind(salon.orgId, kajal, ist('10:40'), DAY)
      .run();
    await rules(ist('10:50'));
    expect(await whatsappOutbox()).toHaveLength(0);
  });

  it('O-20.4 it does nothing when the owner has not opted in', async () => {
    const { salon, kajal } = await world({ whatsapp: false });
    await notInYet(salon, kajal, ist('10:30'));
    await rules(ist('10:50'));
    expect(await whatsappOutbox()).toHaveLength(0);
  });

  it('O-20.5 it waits through quiet hours and never escalates alerts older than 2 hours', async () => {
    const { salon, kajal } = await world();
    await emitAt(salon, ist('21:20'), {
      type: 'new_device',
      userId: kajal,
      name: 'Kajal',
      deviceId: 'DV1',
      deviceLabel: 'Redmi Note 12 · Chrome',
    });
    await rules(ist('21:40'));
    expect(await whatsappOutbox()).toHaveLength(0);
    await rules(ist('08:10', '2026-10-20'));
    expect(await whatsappOutbox()).toHaveLength(0);
  });

  it('O-20.6 a new-device alert escalates outside quiet hours', async () => {
    const { salon, kajal } = await world();
    await emitAt(salon, ist('12:00'), {
      type: 'new_device',
      userId: kajal,
      name: 'Kajal',
      deviceId: 'DV1',
      deviceLabel: 'Redmi Note 12 · Chrome',
    });
    await rules(ist('12:15'));
    const out = await whatsappOutbox();
    expect(out).toHaveLength(1);
    expect(await waStatus('new_device')).toEqual(['recorded']);
  });

  it('O-20.7 at most 10 WhatsApp messages go out in a day', async () => {
    const { salon, kajal } = await world();
    for (let i = 0; i < 12; i++)
      await emitAt(salon, ist('12:00') + i, {
        type: 'new_device',
        userId: kajal,
        name: 'Kajal',
        deviceId: `DV${i}`,
        deviceLabel: 'Redmi Note 12 · Chrome',
      });
    await rules(ist('12:20'));
    await rules(ist('12:25'));
    expect(await whatsappOutbox()).toHaveLength(10);
  });

  it('O-20.8 an event the owner switched off for WhatsApp is not escalated', async () => {
    const { salon, kajal } = await world();
    await testEnv.DB.prepare(
      "INSERT INTO notification_prefs (user_id, event_type, push, whatsapp, email) VALUES (?1, 'not_in_yet', 1, 0, 0)",
    )
      .bind(salon.ownerId)
      .run();
    await notInYet(salon, kajal, ist('10:30'));
    await rules(ist('10:50'));
    expect(await whatsappOutbox()).toHaveLength(0);
  });
});

describe('O-21 weekly digest N30 (PRD 6)', () => {
  const MONDAY = '2026-10-26';

  async function seedWeek(salon: Salon, ids: { priya: string; kajal: string; neha: string }) {
    const row = (user: string, date: string, status: string, late: number, ot: number) =>
      testEnv.DB.prepare(
        `INSERT INTO attendance_days (org_id, user_id, work_date, day_type, status, late_min, ot_approved_min, engine_version, computed_at)
         VALUES (?1, ?2, ?3, 'work', ?4, ?5, ?6, 'test', 0)`,
      ).bind(salon.orgId, user, date, status, late, ot);
    await testEnv.DB.batch([
      row(ids.priya, '2026-10-19', 'P', 10, 0),
      row(ids.kajal, '2026-10-19', 'P', 0, 0),
      row(ids.neha, '2026-10-19', 'A', 0, 0),
      row(ids.priya, '2026-10-20', 'L', 0, 0),
      row(ids.kajal, '2026-10-20', 'P', 0, 90),
      // Outside the week: ignored.
      row(ids.neha, '2026-10-26', 'A', 0, 0),
    ]);
  }

  it('O-21.1 on Monday at 09:00 IST the owner gets last week by email and in the inbox, once', async () => {
    const { salon, kajal, email } = await world();
    const priya = await addUser(salon, { name: 'Priya' });
    const neha = await addUser(salon, { name: 'Neha' });
    await seedWeek(salon, { priya, kajal, neha });
    await rules(ist('08:55', MONDAY));
    expect(email.sent).toHaveLength(0);
    await rules(ist('09:00', MONDAY));
    await rules(ist('09:05', MONDAY));
    await rules(ist('15:00', MONDAY));
    expect(email.sent).toHaveLength(1);
    const mail = email.sent[0];
    expect(mail?.to).toBe('owner@feelings.test');
    expect(mail?.subject).toBe('Last week: 67% on time, 1 h 30 m overtime approved, 1 leave.');
    expect(mail?.text).toContain('Late arrivals: 1');
    expect(mail?.text).toContain('Absent days: 1');
    expect(mail?.text).toContain('Overtime approved: 1 h 30 m');
    expect(mail?.text).toContain('Waiting for your decision: 0');
    const rows = await testEnv.DB.prepare(
      "SELECT user_id, push_status, email_status FROM notifications WHERE type = 'weekly_digest'",
    ).all<{ user_id: string; push_status: string; email_status: string }>();
    expect(rows.results).toEqual([
      { user_id: salon.ownerId, push_status: 'none', email_status: 'sent' },
    ]);
  });

  it('O-21.2 the digest lists what is waiting for a decision and the Time credits balances', async () => {
    const { salon, kajal, email } = await world();
    const priya = await addUser(salon, { name: 'Priya' });
    await setSettings(salon, (s) => {
      (s.timeCredits as Record<string, unknown>).startDate = '2026-10-01';
    });
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO leave_requests (id, org_id, user_id, leave_type_id, from_date, to_date, days_paid, days_unpaid, status, created_at)
         SELECT 'LR1', ?1, ?2, id, '2026-10-28', '2026-10-28', 1, 0, 'pending', ?3 FROM leave_types WHERE code = 'CL' AND org_id = ?1`,
      ).bind(salon.orgId, kajal, ist('09:00', '2026-10-24')),
      testEnv.DB.prepare(
        `INSERT INTO credit_entries (id, org_id, user_id, work_date, kind, minutes, source_kind, source_id, engine_version, created_at)
         VALUES ('CE1', ?1, ?2, '2026-10-20', 'late', -30, 'punch', 'PU9', 'test', 0)`,
      ).bind(salon.orgId, priya),
    ]);
    await rules(ist('09:10', MONDAY));
    const text = email.sent[0]?.text ?? '';
    expect(text).toContain('Waiting for your decision: 1');
    expect(text).toContain('Time credits balances:');
    expect(text).toContain('Priya: -30 m');
  });

  it('O-21.3 nothing is sent on other weekdays', async () => {
    const { email } = await world();
    await rules(ist('09:30', '2026-10-27'));
    await rules(ist('09:30', '2026-10-25'));
    expect(email.sent).toHaveLength(0);
  });
});

describe('O-21 payroll emails N24 and N25 (PRD 6)', () => {
  it('O-21.4 N24 emails the owner when the payroll draft is ready', async () => {
    const { salon, email } = await world();
    await emitAt(salon, ist('09:00', '2026-11-01'), {
      type: 'payroll_draft_ready',
      runId: 'RUN1',
      month: '2026-10',
      blockersCount: 3,
    });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.subject).toBe('October payroll is ready to check');
    expect(email.sent[0]?.text).toContain('3 things need a look first.');
    expect(email.sent[0]?.text).toContain('/o/payroll/RUN1');
  });

  it('O-21.5 N25 emails a staff member their payslip notice only when they switched email on', async () => {
    const { salon, kajal, email } = await world();
    const priya = await addUser(salon, { name: 'Priya' });
    await subscribe(salon, priya);
    await testEnv.DB.prepare('UPDATE users SET email = ?1 WHERE id = ?2')
      .bind('priya@feelings.test', priya)
      .run();
    await testEnv.DB.prepare('UPDATE users SET email = ?1 WHERE id = ?2')
      .bind('kajal@feelings.test', kajal)
      .run();
    await testEnv.DB.prepare(
      "INSERT INTO notification_prefs (user_id, event_type, push, whatsapp, email) VALUES (?1, 'payslip_ready', 1, 0, 1)",
    )
      .bind(priya)
      .run();
    await emitAt(salon, ist('15:00', '2026-11-03'), {
      type: 'payslip_ready',
      userIds: [priya, kajal],
      runId: 'RUN1',
      month: '2026-10',
    });
    expect(email.sent.map((m) => m.to)).toEqual(['priya@feelings.test']);
    expect(email.sent[0]?.subject).toBe('Your October payslip is ready');
    expect(email.sent[0]?.text).toContain('/payslips');
  });
});
