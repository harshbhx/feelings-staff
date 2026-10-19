/**
 * Notifier rules (PRD 6 delivery rules): prefs, quiet hours, held release, batching, topics,
 * failed-push handling, payload size, recipients. Covers O-17.2, O-17.3, O-17.4 and S-15.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runJob } from '../cron';
import { fakePush } from '../test/fakes';
import { testEnv } from '../test/helpers';
import {
  addUser,
  allInbox,
  emitAt,
  ist,
  newSalon,
  setSettings,
  subscribe,
} from '../test/notify-kit';
import { buildPayload } from './notifier';
import { setServiceOverridesForTests } from './registry';

afterEach(() => setServiceOverridesForTests(null));
const D = '2026-10-19';

const late = (userId: string, name: string, min: number, at: string) =>
  ({
    type: 'late_checkin',
    userId,
    name,
    workDate: D,
    lateMin: min,
    inTs: ist(at),
    placeName: 'the salon',
  }) as const;

async function setup(opts: { push?: ReturnType<typeof fakePush> } = {}) {
  const salon = await newSalon();
  const priya = await addUser(salon, { name: 'Priya' });
  const kajal = await addUser(salon, { name: 'Kajal' });
  await subscribe(salon, salon.ownerId);
  await subscribe(salon, priya);
  const push = opts.push ?? fakePush();
  setServiceOverridesForTests({ push });
  return { salon, priya, kajal, push };
}

describe('quiet hours (O-17.2)', () => {
  it('O-17.2 holds owner pushes at 22:00 but still writes the inbox row', async () => {
    const { salon, priya, push } = await setup();
    await emitAt(salon, ist('22:00'), late(priya, 'Priya', 18, '22:00'));
    expect(push.sent).toHaveLength(0);
    const rows = await allInbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.push_status).toBe('held');
  });

  it('O-17.2 new-device alerts ignore quiet hours', async () => {
    const { salon, priya, push } = await setup();
    await emitAt(salon, ist('23:30'), {
      type: 'new_device',
      userId: priya,
      name: 'Priya',
      deviceId: 'D',
      deviceLabel: 'Redmi',
    });
    expect(push.sent).toHaveLength(1);
  });

  it('O-17.2 staff pushes are not held by owner quiet hours', async () => {
    const { salon, priya, push } = await setup();
    await emitAt(salon, ist('22:00'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    expect(push.sent).toHaveLength(1);
  });

  it('O-17.2 held alerts go out at 08:00 as one summary push, once', async () => {
    const { salon, priya, kajal, push } = await setup();
    await emitAt(salon, ist('21:45'), late(priya, 'Priya', 18, '21:45'));
    await emitAt(salon, ist('22:10'), {
      type: 'leave_requested',
      userId: kajal,
      name: 'Kajal',
      requestId: 'L',
      typeCode: 'CL',
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      reason: null,
      urgent: false,
    });
    expect(push.sent).toHaveLength(0);

    // 07:55: still quiet, nothing released.
    await runJob('rules', testEnv, ist('07:55', '2026-10-20'));
    expect(push.sent).toHaveLength(0);

    await runJob('rules', testEnv, ist('08:00', '2026-10-20'));
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.payload.notification.title).toBe('2 alerts while you were away');
    expect(push.sent[0]?.payload.notification.body).toContain('Priya is 18 min late');
    expect(push.sent[0]?.opts.ttlSec).toBe(12 * 3600);
    expect((await allInbox()).every((r) => r.push_status === 'sent')).toBe(true);

    await runJob('rules', testEnv, ist('08:05', '2026-10-20'));
    expect(push.sent).toHaveLength(1);
  });

  it('O-17.2 quiet hours can be switched off in settings', async () => {
    const { salon, priya, push } = await setup();
    await setSettings(salon, (s) => {
      (s.notifications as { quietHours: { enabled: boolean } }).quietHours.enabled = false;
    });
    await emitAt(salon, ist('22:00'), late(priya, 'Priya', 18, '22:00'));
    expect(push.sent).toHaveLength(1);
  });

  it('S-15 summary-only mode keeps alerts in the inbox and sends no push except the summary', async () => {
    const { salon, priya, push } = await setup();
    await setSettings(salon, (s) => {
      (s.notifications as { summaryOnly: boolean }).summaryOnly = true;
    });
    await emitAt(salon, ist('11:00'), late(priya, 'Priya', 18, '11:00'));
    expect(push.sent).toHaveLength(0);
    await emitAt(salon, ist('10:45'), {
      type: 'morning_summary',
      date: D,
      present: 1,
      late: 0,
      notInYet: 0,
      onLeave: 0,
      waitingOver48h: 0,
    });
    expect(push.sent).toHaveLength(1);
  });
});

describe('batching and topics (O-17.3, O-17.4)', () => {
  it('O-17.3 same-type alerts within 5 minutes merge into one push on the first alert’s topic', async () => {
    const { salon, priya, kajal, push } = await setup();
    await emitAt(salon, ist('10:28'), late(priya, 'Priya', 18, '10:28'));
    await emitAt(salon, ist('10:31'), late(kajal, 'Kajal', 12, '10:31'));
    expect(push.sent).toHaveLength(2);
    const [first, merged] = push.sent;
    expect(first?.payload.notification.title).toBe('Priya is 18 min late');
    expect(merged?.payload.notification.title).toBe('2 people are late');
    expect(merged?.payload.notification.body).toBe('Priya 18 m, Kajal 12 m');
    expect(merged?.opts.topic).toBe(first?.opts.topic);
    // Both inbox rows keep their own copy.
    const titles = (await allInbox()).map((r) => r.title);
    expect(titles).toEqual(['Priya is 18 min late', 'Kajal is 12 min late']);
  });

  it('O-17.3 an alert more than 5 minutes later starts a new batch', async () => {
    const { salon, priya, kajal, push } = await setup();
    await emitAt(salon, ist('10:28'), late(priya, 'Priya', 18, '10:28'));
    await emitAt(salon, ist('10:40'), late(kajal, 'Kajal', 12, '10:40'));
    expect(push.sent[1]?.payload.notification.title).toBe('Kajal is 12 min late');
  });

  it('O-17.4 a late check-in replaces the not-in-yet alert for the same person and day', async () => {
    const { salon, priya, push } = await setup();
    await emitAt(salon, ist('10:30'), {
      type: 'not_in_yet',
      userId: priya,
      name: 'Priya',
      workDate: D,
      shiftStart: '10:00',
    });
    await emitAt(salon, ist('10:50'), late(priya, 'Priya', 50, '10:50'));
    expect(push.sent).toHaveLength(2);
    expect(push.sent[1]?.opts.topic).toBe(push.sent[0]?.opts.topic);
    expect(push.sent[0]?.opts.topic).toMatch(/^notin-/);
  });

  it('O-17.4 without an earlier not-in-yet the late alert keeps its own topic', async () => {
    const { salon, priya, push } = await setup();
    await emitAt(salon, ist('10:50'), late(priya, 'Priya', 50, '10:50'));
    expect(push.sent[0]?.opts.topic).toMatch(/^late-/);
  });
});

describe('preferences and recipients (S-15)', () => {
  it('S-15 a person can switch an event’s push off; the inbox row is still written', async () => {
    const { salon, priya, push } = await setup();
    await testEnv.DB.prepare(
      "INSERT INTO notification_prefs (user_id, event_type, push, whatsapp, email) VALUES (?1, 'holiday_announced', 0, 0, 0)",
    )
      .bind(priya)
      .run();
    await emitAt(salon, ist('14:00'), {
      type: 'holiday_announced',
      date: '2026-11-08',
      name: 'Diwali',
    });
    expect(push.sent).toHaveLength(0);
    expect((await allInbox()).filter((r) => r.user_id === priya)).toHaveLength(1);
  });

  it('S-15 security events cannot be switched off', async () => {
    const { salon, priya, push } = await setup();
    await testEnv.DB.prepare(
      "INSERT INTO notification_prefs (user_id, event_type, push, whatsapp, email) VALUES (?1, 'new_device', 0, 0, 0)",
    )
      .bind(salon.ownerId)
      .run();
    await emitAt(salon, ist('12:00'), {
      type: 'new_device',
      userId: priya,
      name: 'Priya',
      deviceId: 'D',
      deviceLabel: 'Redmi',
    });
    expect(push.sent).toHaveLength(1);
  });

  it('S-15 an event with no subscription still writes its inbox row', async () => {
    const { salon, kajal, push } = await setup();
    await emitAt(salon, ist('12:30'), {
      type: 'leave_decided',
      userId: kajal,
      requestId: 'L',
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      decision: 'approved',
      note: null,
    });
    expect(push.sent).toHaveLength(0);
    const rows = await allInbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.push_status).toBe('none');
  });

  it('S-15 managers get owner events only with the matching permission', async () => {
    const { salon, priya, push } = await setup();
    const withPerm = await addUser(salon, {
      name: 'Meera',
      role: 'manager',
      permissions: ['approve_leave'],
    });
    const without = await addUser(salon, {
      name: 'Mina',
      role: 'manager',
      permissions: ['roster'],
    });
    await subscribe(salon, withPerm);
    await subscribe(salon, without);
    await emitAt(salon, ist('12:00'), {
      type: 'leave_requested',
      userId: priya,
      name: 'Priya',
      requestId: 'L',
      typeCode: 'CL',
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      reason: null,
      urgent: false,
    });
    const to = (await allInbox()).map((r) => r.user_id).sort();
    expect(to).toEqual([salon.ownerId, withPerm].sort());
    expect(push.sent).toHaveLength(2);
  });

  it('O-17 staff reminders are only sent inside the shift plus or minus 2 hours', async () => {
    const { salon, priya, push } = await setup();
    const ev = () =>
      ({ type: 'checkin_reminder', userId: priya, workDate: D, shiftStart: '10:00' }) as const;
    await emitAt(salon, ist('06:00'), ev());
    expect(push.sent).toHaveLength(0);
    expect(await allInbox()).toHaveLength(0);
    await emitAt(salon, ist('10:05'), ev());
    expect(push.sent).toHaveLength(1);
  });

  it('push language follows the recipient (lang tag) and falls back to English copy', async () => {
    const { salon, push } = await setup();
    const guj = await addUser(salon, { name: 'Dhara', lang: 'gu' });
    await subscribe(salon, guj);
    await emitAt(salon, ist('12:00'), {
      type: 'payslip_ready',
      userIds: [guj],
      runId: 'R',
      month: '2026-10',
    });
    expect(push.sent[0]?.payload.notification.lang).toBe('gu-IN');
    expect(push.sent[0]?.payload.notification.title).toBe('Your October payslip is ready');
  });
});

describe('failed pushes (PRD 6)', () => {
  it('410 deletes the subscription', async () => {
    const { salon, priya, push } = await setup({ push: fakePush(410) });
    await emitAt(salon, ist('12:30'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    expect(push.sent).toHaveLength(1);
    const left = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(priya)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await allInbox())[0]?.push_status).toBe('failed');
  });

  it('404 deletes the subscription too', async () => {
    const { salon, priya } = await setup({ push: fakePush(404) });
    await emitAt(salon, ist('12:30'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    const left = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1',
    )
      .bind(priya)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('413 resends a shorter payload (title only)', async () => {
    const { salon, priya, push } = await setup({ push: fakePush([413, 201]) });
    await emitAt(salon, ist('12:30'), {
      type: 'leave_decided',
      userId: priya,
      requestId: 'L',
      fromDate: '2026-10-26',
      toDate: '2026-10-26',
      decision: 'rejected',
      note: 'Diwali rush',
    });
    expect(push.sent).toHaveLength(2);
    expect(push.sent[0]?.payload.notification.body).toBe('Diwali rush');
    expect(push.sent[1]?.payload.notification.body).toBeUndefined();
    expect((await allInbox())[0]?.push_status).toBe('sent');
  });

  it('429 retries once after Retry-After', async () => {
    const { salon, priya, push } = await setup({ push: fakePush([429, 201]) });
    await emitAt(salon, ist('12:30'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    expect(push.sent).toHaveLength(2);
    expect((await allInbox())[0]?.push_status).toBe('sent');
  });

  it('429 twice gives up after one retry', async () => {
    const { salon, priya, push } = await setup({ push: fakePush(429) });
    await emitAt(salon, ist('12:30'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    expect(push.sent).toHaveLength(2);
    expect((await allInbox())[0]?.push_status).toBe('failed');
  });
});

describe('payload (PRD 6)', () => {
  it('stays under 2 KB even with a very long body', () => {
    const p = buildPayload(
      { APP_ORIGIN: 'https://staff.test' },
      {
        type: 'leave_requested',
        id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        title: 'Priya asked for leave',
        body: 'x'.repeat(6000),
        url: '/o/actions',
        lang: 'en',
        topic: null,
        badge: 3,
      },
    );
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(2048);
    expect(p.notification.navigate).toBe('https://staff.test/o/actions');
    expect(p.notification.app_badge).toBe('3');
    expect(p.web_push).toBe(8030);
  });

  it('records pushes in the preview outbox', async () => {
    const { salon, priya } = await setup();
    await emitAt(salon, ist('12:30'), {
      type: 'device_decided',
      userId: priya,
      deviceId: 'D',
      decision: 'approved',
    });
    const row = await testEnv.DB.prepare(
      "SELECT channel, to_addr FROM test_outbox WHERE channel = 'push'",
    ).first<{ channel: string; to_addr: string }>();
    expect(row?.to_addr).toBe(priya);
  });
});
