/**
 * The 5-minute rules job on a fake clock (PRD 9.5, 4.8, 4.13, 6): each rule fires at its stated
 * time, once per slot, to the right people. Covers O-17.1, O-13.1 (draft on the 1st at 09:00 IST).
 */
import type { PayrollRunView } from '@fs/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../services/registry';
import { fakeDayService, fakePayroll, fakePush } from '../test/fakes';
import { testEnv } from '../test/helpers';
import {
  addPunch,
  addUser,
  allInbox,
  DAY,
  inbox,
  ist,
  newSalon,
  subscribe,
} from '../test/notify-kit';
import { runJob } from './index';

afterEach(() => setServiceOverridesForTests(null));

async function setup() {
  const salon = await newSalon();
  const priya = await addUser(salon, { name: 'Priya' });
  const kajal = await addUser(salon, { name: 'Kajal' });
  for (const id of [salon.ownerId, priya, kajal]) await subscribe(salon, id);
  const push = fakePush();
  const days = fakeDayService();
  setServiceOverridesForTests({ push, days });
  return { salon, priya, kajal, push, days };
}

const rules = (at: number) => runJob('rules', testEnv, at);
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('N4 and N10 staff reminders, N3 not in yet', () => {
  it('O-17.1 N4 sends the check-in reminder at shift start + 5 min, once, to people without a punch', async () => {
    const { salon, priya, kajal } = await setup();
    await addPunch(salon, kajal, 'in', ist('09:58'));
    await rules(ist('10:00'));
    expect(await allInbox()).toHaveLength(0);
    await rules(ist('10:05'));
    await rules(ist('10:10'));
    const rows = await inbox(priya);
    expect(titles(rows)).toEqual(['Your shift started at 10:00']);
    expect(await inbox(kajal)).toHaveLength(0);
  });

  it('O-17.1 N3 tells the owner at shift start + 30 min, skipping people on leave or on week off', async () => {
    const { salon, kajal } = await setup();
    const neha = await addUser(salon, { name: 'Neha', weekOffDow: 1 }); // Monday week off
    await subscribe(salon, neha);
    await testEnv.DB.prepare(
      `INSERT INTO leave_requests (id, org_id, user_id, leave_type_id, from_date, to_date, days_paid, days_unpaid, status, created_at)
       SELECT 'LR1', ?1, ?2, id, ?3, ?3, 1, 0, 'approved', ?4 FROM leave_types WHERE code = 'CL' AND org_id = ?1`,
    )
      .bind(salon.orgId, kajal, DAY, Date.now())
      .run();
    await rules(ist('10:25'));
    expect((await inbox(salon.ownerId)).filter((r) => r.type === 'not_in_yet')).toHaveLength(0);
    await rules(ist('10:30'));
    const owner = (await inbox(salon.ownerId)).filter((r) => r.type === 'not_in_yet');
    expect(titles(owner)).toEqual(["Priya hasn't checked in"]);
    expect(owner[0]?.priority).toBe('high');
  });

  it('O-17.4 N3 is pushed on the not-in-yet topic that a later late alert reuses', async () => {
    const { push } = await setup();
    await rules(ist('10:30'));
    const notIn = push.sent.find((s) => s.payload.t === 'not_in_yet');
    expect(notIn?.opts.topic).toMatch(/^notin-/);
  });

  it('O-17.1 N9 and N10 fire at shift end + 30 min for people still checked in, not on a duty', async () => {
    const { salon, priya, kajal } = await setup();
    await addPunch(salon, priya, 'in', ist('10:00'));
    await addPunch(salon, kajal, 'in', ist('10:00'));
    await addPunch(salon, kajal, 'out', ist('19:55'));
    await rules(ist('20:25'));
    // The 18:00 roll-call (N33) is a separate rule; this test is about shift-end reminders.
    const shiftEnd = async () => (await allInbox()).filter((r) => !r.type.startsWith('roll_call'));
    expect(await shiftEnd()).toHaveLength(0);
    await rules(ist('20:30'));
    expect(titles(await inbox(priya))).toEqual(['Still at work?']);
    const ownerRows = (await inbox(salon.ownerId)).filter((r) => !r.type.startsWith('roll_call'));
    expect(titles(ownerRows)).toEqual(['Priya is still working']);
    expect(await inbox(kajal)).toHaveLength(0);
  });

  it('O-17.1 N10 stays quiet while an off-site duty is running', async () => {
    const { salon, priya } = await setup();
    await addPunch(salon, priya, 'in', ist('10:00'));
    const duty = 'DUTY1';
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO offsite_duties (id, org_id, work_date, start_ts, end_ts, mode, place_name, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'anywhere', 'Hotel Aram', ?6, ?7)`,
      ).bind(duty, salon.orgId, DAY, ist('15:00'), ist('22:00'), salon.ownerId, ist('08:00')),
      testEnv.DB.prepare('INSERT INTO offsite_duty_staff (duty_id, user_id) VALUES (?1, ?2)').bind(
        duty,
        priya,
      ),
    ]);
    await rules(ist('20:30'));
    expect(await inbox(priya)).toHaveLength(0);
  });
});

describe('N11 missed check-outs and auto-close (PRD 4.8)', () => {
  it('O-17.1 N11 sends one batched owner alert at closing + 60 min', async () => {
    const { salon, priya, kajal, push } = await setup();
    await addPunch(salon, priya, 'in', ist('10:00'));
    await addPunch(salon, kajal, 'in', ist('10:00'));
    await rules(ist('20:55'));
    expect((await allInbox()).filter((r) => r.type === 'missed_checkouts')).toHaveLength(0);
    await rules(ist('21:00'));
    await rules(ist('21:05'));
    const rows = (await allInbox()).filter((r) => r.type === 'missed_checkouts');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("2 people haven't checked out");
    expect(rows[0]?.body).toBe('Priya, Kajal');
    const sent = push.sent.find((s) => s.payload.t === 'missed_checkouts');
    expect(sent?.opts.urgency).toBe('high');
  });

  it('O-17.1 auto-close at window end + 6 h writes an auto out punch, recomputes and tells the staff member', async () => {
    const { salon, priya, days } = await setup();
    await addPunch(salon, priya, 'in', ist('10:00'));
    await rules(ist('01:55', '2026-10-20'));
    expect(days.calls).toHaveLength(0);
    await rules(ist('02:00', '2026-10-20'));
    await rules(ist('02:05', '2026-10-20'));

    const out = await testEnv.DB.prepare(
      "SELECT effective_ts, source, status, work_date FROM punches WHERE user_id = ?1 AND kind = 'out'",
    )
      .bind(priya)
      .all<{ effective_ts: number; source: string; status: string; work_date: string }>();
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      effective_ts: ist('20:00'),
      source: 'auto',
      status: 'flagged',
      work_date: DAY,
    });
    expect(days.calls).toEqual([[priya, DAY]]);
    expect(titles((await inbox(priya)).filter((r) => r.type === 'day_auto_closed'))).toEqual([
      'We closed your day at 20:00',
    ]);
    const audit = await testEnv.DB.prepare(
      "SELECT actor_type FROM audit_log WHERE action = 'punch.auto_close'",
    ).all<{ actor_type: string }>();
    expect(audit.results.map((a) => a.actor_type)).toEqual(['system']);
  });
});

describe('N1 morning summary', () => {
  it('O-17.1 N1 fires at first shift + 45 min with counts and the 48 h reminder line (N29)', async () => {
    const { salon, priya, kajal } = await setup();
    const neha = await addUser(salon, { name: 'Neha' });
    const asha = await addUser(salon, { name: 'Asha' });
    await addPunch(salon, priya, 'in', ist('10:02'));
    await addPunch(salon, kajal, 'in', ist('10:20')); // late beyond the 10 min grace
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO leave_requests (id, org_id, user_id, leave_type_id, from_date, to_date, days_paid, days_unpaid, status, created_at)
         SELECT 'LR2', ?1, ?2, id, ?3, ?3, 1, 0, 'approved', ?4 FROM leave_types WHERE code = 'CL' AND org_id = ?1`,
      ).bind(salon.orgId, asha, DAY, Date.now()),
      testEnv.DB.prepare(
        `INSERT INTO leave_requests (id, org_id, user_id, leave_type_id, from_date, to_date, days_paid, days_unpaid, status, created_at)
         SELECT 'LR3', ?1, ?2, id, '2026-10-30', '2026-10-30', 1, 0, 'pending', ?3 FROM leave_types WHERE code = 'CL' AND org_id = ?1`,
      ).bind(salon.orgId, neha, ist('09:00', '2026-10-15')),
    ]);
    await rules(ist('10:40'));
    expect((await allInbox()).filter((r) => r.type === 'morning_summary')).toHaveLength(0);
    await rules(ist('10:45'));
    await rules(ist('10:50'));
    const rows = (await inbox(salon.ownerId)).filter((r) => r.type === 'morning_summary');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Today at 10:45');
    expect(rows[0]?.body).toBe(
      '2 in · 1 late · 1 not in yet · 1 on leave\n1 request is waiting more than 2 days.',
    );
  });

  it('O-17.1 N1 does not fire on a day nobody is scheduled', async () => {
    await setup();
    await rules(ist('10:45', '2026-10-25')); // Sunday week off for everyone
    expect(await allInbox()).toHaveLength(0);
  });
});

describe('N24 payroll draft, N26 pay day, N18 duty reminders', () => {
  const view = {
    run: { id: 'RUN-OCT', month: '2026-10' },
    blockers: [
      { kind: 'pending_punches', count: 2, defaultAction: 'x', items: [] },
      { kind: 'leave_undecided', count: 1, defaultAction: 'x', items: [] },
    ],
  } as unknown as PayrollRunView;

  it('O-13.1 N24 drafts last month on the 1st at 09:00 IST, once, and tells the owner', async () => {
    const { salon } = await setup();
    const months: string[] = [];
    setServiceOverridesForTests({
      push: fakePush(),
      payroll: {
        ...fakePayroll(view),
        draft: async (_ctx, month) => {
          months.push(month);
          return view;
        },
      },
    });
    await rules(ist('08:55', '2026-11-01'));
    expect(months).toEqual([]);
    await rules(ist('09:00', '2026-11-01'));
    await rules(ist('09:05', '2026-11-01'));
    expect(months).toEqual(['2026-10']);
    const rows = (await inbox(salon.ownerId)).filter((r) => r.type === 'payroll_draft_ready');
    expect(rows[0]?.title).toBe('October payroll is ready to check');
    expect(rows[0]?.body).toBe('3 things need a look first.');
  });

  it('O-13.1 a failed draft is retried on the next tick', async () => {
    const { salon } = await setup();
    let calls = 0;
    setServiceOverridesForTests({
      push: fakePush(),
      payroll: {
        ...fakePayroll(view),
        draft: async () => {
          calls += 1;
          if (calls === 1) throw new Error('engine down');
          return view;
        },
      },
    });
    await rules(ist('09:00', '2026-11-01'));
    await rules(ist('09:05', '2026-11-01'));
    expect(calls).toBe(2);
    expect(
      (await inbox(salon.ownerId)).filter((r) => r.type === 'payroll_draft_ready'),
    ).toHaveLength(1);
  });

  it('O-17.1 N26 on pay day at 10:00 reminds the owner about unpaid payslips', async () => {
    const { salon, priya } = await setup();
    await testEnv.DB.prepare(
      `INSERT INTO payroll_runs (id, org_id, month, revision, status, settings_snapshot_json, engine_version, created_by, created_at)
       VALUES ('RUN-OCT', ?1, '2026-10', 1, 'finalised', '{}', 'v', ?2, ?3)`,
    )
      .bind(salon.orgId, salon.ownerId, Date.now())
      .run();
    const staff = [
      priya,
      await addUser(salon, { name: 'Kajal' }),
      await addUser(salon, { name: 'Neha' }),
    ];
    for (const [i, userId] of staff.entries())
      await testEnv.DB.prepare(
        `INSERT INTO payslips (id, org_id, payroll_run_id, user_id, snapshot_json, gross_paise, deductions_paise, net_paise, rounding_paise, verify_token, created_at)
         VALUES (?1, ?2, 'RUN-OCT', ?3, '{}', 100, 0, 100, 0, ?4, ?5)`,
      )
        .bind(`PS${i}`, salon.orgId, userId, `tok${i}-xxxxxxxxxxxxxxxx`, Date.now())
        .run();
    await rules(ist('09:55', '2026-11-05'));
    expect((await allInbox()).filter((r) => r.type === 'salary_unpaid')).toHaveLength(0);
    await rules(ist('10:00', '2026-11-05'));
    await rules(ist('10:05', '2026-11-05'));
    const rows = (await inbox(salon.ownerId)).filter((r) => r.type === 'salary_unpaid');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('The legal deadline is the 7th.');
  });

  it('O-17.1 N18 reminds staff 12 h before a duty that was created earlier', async () => {
    const { salon, priya } = await setup();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO offsite_duties (id, org_id, work_date, start_ts, end_ts, mode, place_name, created_by, created_at)
         VALUES ('DUTY2', ?1, '2026-10-20', ?2, ?3, 'anywhere', 'Hotel Aram', ?4, ?5)`,
      ).bind(
        salon.orgId,
        ist('04:00', '2026-10-20'),
        ist('09:00', '2026-10-20'),
        salon.ownerId,
        ist('09:00'),
      ),
      testEnv.DB.prepare(
        "INSERT INTO offsite_duty_staff (duty_id, user_id) VALUES ('DUTY2', ?1)",
      ).bind(priya),
    ]);
    await rules(ist('15:55'));
    expect(await inbox(priya)).toHaveLength(0);
    await rules(ist('16:00'));
    await rules(ist('16:05'));
    expect(titles(await inbox(priya))).toEqual(['Venue duty tomorrow 04:00–09:00']);
  });
});
