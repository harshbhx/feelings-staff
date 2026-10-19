/**
 * PRD 6 notification matrix, one fake-clock test per row (N1-N37): recipient, channel, timing and
 * copy. Covers S-15.1 (every event writes an inbox row for the right recipient) and O-17.1.
 */

import { NOTIFY_EVENT_NUMBER, type NotifyEvent, type NotifyEventType } from '@fs/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeEmail, fakePush } from '../test/fakes';
import {
  addUser,
  allInbox,
  emitAt,
  ist,
  newSalon,
  type Salon,
  subscribe,
} from '../test/notify-kit';
import { setServiceOverridesForTests } from './registry';

type Ev = Parameters<typeof emitAt>[2];

interface World {
  salon: Salon;
  owner: string;
  priya: string;
  kajal: string;
  neha: string;
  push: ReturnType<typeof fakePush>;
  email: ReturnType<typeof fakeEmail>;
}

async function world(): Promise<World> {
  const salon = await newSalon();
  const priya = await addUser(salon, { name: 'Priya' });
  const kajal = await addUser(salon, { name: 'Kajal' });
  const neha = await addUser(salon, { name: 'Neha' });
  for (const id of [salon.ownerId, priya, kajal, neha]) await subscribe(salon, id);
  const push = fakePush();
  const email = fakeEmail();
  setServiceOverridesForTests({ push, email });
  return { salon, owner: salon.ownerId, priya, kajal, neha, push, email };
}

afterEach(() => setServiceOverridesForTests(null));

const shortId = (id: string) => id.slice(-8);
const D = '2026-10-19';

interface Row {
  n: number;
  type: NotifyEventType;
  at: number;
  event: (w: World) => Ev;
  to: (w: World) => string[];
  /** Expect a push to each recipient. */
  push: boolean;
  title: string;
  body: string | null;
  urgency?: 'high' | 'normal';
  ttl?: number;
  topic?: (w: World) => string | null;
}

const FOUR_H = 4 * 3600;
const TWELVE_H = 12 * 3600;

const rows: Row[] = [
  {
    n: 1,
    type: 'morning_summary',
    at: ist('10:45'),
    event: () => ({
      type: 'morning_summary',
      date: D,
      present: 8,
      late: 1,
      notInYet: 1,
      onLeave: 1,
      waitingOver48h: 2,
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Today at 10:45',
    body: '8 in · 1 late · 1 not in yet · 1 on leave\n2 requests are waiting more than 2 days.',
    ttl: TWELVE_H,
    topic: () => 'sum-20261019',
  },
  {
    n: 2,
    type: 'late_checkin',
    at: ist('10:28'),
    event: (w) => ({
      type: 'late_checkin',
      userId: w.priya,
      name: 'Priya',
      workDate: D,
      lateMin: 18,
      inTs: ist('10:28'),
      placeName: 'the salon',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Priya is 18 min late',
    body: 'Checked in 10:28 at the salon',
    urgency: 'high',
    topic: (w) => `late-${shortId(w.priya)}-20261019`,
  },
  {
    n: 3,
    type: 'not_in_yet',
    at: ist('10:30'),
    event: (w) => ({
      type: 'not_in_yet',
      userId: w.kajal,
      name: 'Kajal',
      workDate: D,
      shiftStart: '10:00',
    }),
    to: (w) => [w.owner],
    push: true,
    title: "Kajal hasn't checked in",
    body: 'Shift started 10:00. Tap to call or WhatsApp.',
    urgency: 'high',
    topic: (w) => `notin-${shortId(w.kajal)}-20261019`,
  },
  {
    n: 4,
    type: 'checkin_reminder',
    at: ist('10:05'),
    event: (w) => ({
      type: 'checkin_reminder',
      userId: w.priya,
      workDate: D,
      shiftStart: '10:00',
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your shift started at 10:00',
    body: 'Tap to check in.',
  },
  {
    n: 5,
    type: 'flagged_punch',
    at: ist('10:04'),
    event: (w) => ({
      type: 'flagged_punch',
      userId: w.priya,
      name: 'Priya',
      punchId: 'P1',
      kind: 'in',
      effectiveTs: ist('10:04'),
      reasons: ['fence_uncertain', 'new_device'],
    }),
    to: (w) => [w.owner],
    push: true,
    title: "Check Priya's check-in",
    body: 'Edge of the fence · new phone',
    urgency: 'high',
  },
  {
    n: 6,
    type: 'punch_needs_approval',
    at: ist('11:00'),
    event: (w) => ({
      type: 'punch_needs_approval',
      userId: w.neha,
      name: 'Neha',
      punchId: 'P2',
      distanceM: 340,
      placeName: 'the salon',
      note: 'Patel wedding',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Neha needs approval',
    body: "Checked in 340 m from the salon: 'Patel wedding'",
  },
  {
    n: 7,
    type: 'punch_decided',
    at: ist('10:10'),
    event: (w) => ({
      type: 'punch_decided',
      userId: w.priya,
      punchId: 'P1',
      kind: 'in',
      effectiveTs: ist('10:04'),
      decision: 'approved',
      note: null,
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your check-in at 10:04 was approved',
    body: null,
  },
  {
    n: 7,
    type: 'punch_decided',
    at: ist('10:10'),
    event: (w) => ({
      type: 'punch_decided',
      userId: w.priya,
      punchId: 'P1',
      kind: 'in',
      effectiveTs: ist('10:04'),
      decision: 'rejected',
      note: 'Please scan the door code next time',
    }),
    to: (w) => [w.priya],
    push: true,
    title: "Urmi didn't accept your 10:04 check-in",
    body: 'Please scan the door code next time',
  },
  {
    n: 8,
    type: 'early_checkout',
    at: ist('18:30'),
    event: (w) => ({
      type: 'early_checkout',
      userId: w.kajal,
      name: 'Kajal',
      outTs: ist('18:30'),
      minutesEarly: 90,
    }),
    to: (w) => [w.owner],
    push: false,
    title: 'Kajal left at 18:30',
    body: '1 h 30 m before the shift ends',
  },
  {
    n: 9,
    type: 'overtime_running',
    at: ist('20:30'),
    event: (w) => ({
      type: 'overtime_running',
      userId: w.neha,
      name: 'Neha',
      workDate: D,
      shiftEnd: '20:00',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Neha is still working',
    body: 'Shift ended 20:00. Approve overtime later in Needs action.',
  },
  {
    n: 10,
    type: 'checkout_reminder',
    at: ist('20:30'),
    event: (w) => ({ type: 'checkout_reminder', userId: w.neha, workDate: D }),
    to: (w) => [w.neha],
    push: true,
    title: 'Still at work?',
    body: 'Check out when you leave.',
  },
  {
    n: 11,
    type: 'missed_checkouts',
    at: ist('21:00'),
    event: (w) => ({
      type: 'missed_checkouts',
      workDate: D,
      people: [
        { userId: w.priya, name: 'Priya' },
        { userId: w.kajal, name: 'Kajal' },
      ],
    }),
    to: (w) => [w.owner],
    push: true,
    title: "2 people haven't checked out",
    body: 'Priya, Kajal',
    urgency: 'high',
  },
  {
    n: 12,
    type: 'day_auto_closed',
    at: ist('02:00', '2026-10-20'),
    event: (w) => ({
      type: 'day_auto_closed',
      userId: w.priya,
      workDate: D,
      outTs: ist('20:00'),
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'We closed your day at 20:00',
    body: 'If you left later, tell Urmi.',
  },
  {
    n: 13,
    type: 'leave_requested',
    at: ist('12:00'),
    event: (w) => ({
      type: 'leave_requested',
      userId: w.priya,
      name: 'Priya',
      requestId: 'L1',
      typeCode: 'CL',
      fromDate: '2026-10-26',
      toDate: '2026-10-27',
      reason: "Sister's engagement",
      urgent: false,
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Priya asked for leave',
    body: "26–27 Oct · casual · 'Sister's engagement'",
    urgency: 'normal',
  },
  {
    n: 13,
    type: 'leave_requested',
    at: ist('12:00'),
    event: (w) => ({
      type: 'leave_requested',
      userId: w.priya,
      name: 'Priya',
      requestId: 'L2',
      typeCode: 'SL',
      fromDate: D,
      toDate: '2026-10-20',
      reason: null,
      urgent: true,
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Priya asked for leave',
    body: '19–20 Oct · sick',
    urgency: 'high',
  },
  {
    n: 14,
    type: 'leave_decided',
    at: ist('12:30'),
    event: (w) => ({
      type: 'leave_decided',
      userId: w.priya,
      requestId: 'L1',
      fromDate: '2026-10-26',
      toDate: '2026-10-27',
      decision: 'approved',
      note: null,
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your leave for 26–27 Oct is approved',
    body: null,
  },
  {
    n: 14,
    type: 'leave_decided',
    at: ist('12:30'),
    event: (w) => ({
      type: 'leave_decided',
      userId: w.priya,
      requestId: 'L1',
      fromDate: '2026-10-26',
      toDate: '2026-10-27',
      decision: 'rejected',
      note: 'Diwali rush',
    }),
    to: (w) => [w.priya],
    push: true,
    title: "Your leave for 26–27 Oct wasn't approved",
    body: 'Diwali rush',
  },
  {
    n: 15,
    type: 'regularisation_requested',
    at: ist('12:00'),
    event: (w) => ({
      type: 'regularisation_requested',
      userId: w.priya,
      name: 'Priya',
      requestId: 'R1',
      workDate: '2026-10-14',
      kind: 'missed_out',
      proposedInTs: null,
      proposedOutTs: ist('20:15', '2026-10-14'),
    }),
    to: (w) => [w.owner],
    push: false,
    title: 'Priya asked to fix 14 Oct',
    body: 'Forgot to check out. Left at 20:15.',
  },
  {
    n: 16,
    type: 'regularisation_decided',
    at: ist('12:30'),
    event: (w) => ({
      type: 'regularisation_decided',
      userId: w.priya,
      requestId: 'R1',
      workDate: '2026-10-14',
      decision: 'approved',
      note: null,
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your fix for 14 Oct is approved',
    body: null,
  },
  {
    n: 17,
    type: 'offsite_requested',
    at: ist('15:00'),
    event: (w) => ({
      type: 'offsite_requested',
      userId: w.neha,
      name: 'Neha',
      punchId: 'P3',
      placeName: 'Patel wedding, Lal Bungalow',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Neha checked in at a venue',
    body: "'Patel wedding, Lal Bungalow'. Approve?",
  },
  {
    n: 18,
    type: 'duty_assigned',
    at: ist('15:00'),
    event: (w) => ({
      type: 'duty_assigned',
      userIds: [w.priya, w.kajal],
      dutyId: 'D1',
      workDate: '2026-10-20',
      startTs: ist('04:00', '2026-10-20'),
      endTs: ist('09:00', '2026-10-20'),
      placeName: 'Hotel Aram',
      change: 'created',
    }),
    to: (w) => [w.priya, w.kajal],
    push: true,
    title: 'Venue duty tomorrow 04:00–09:00',
    body: 'Hotel Aram',
  },
  {
    n: 19,
    type: 'new_device',
    at: ist('12:00'),
    event: (w) => ({
      type: 'new_device',
      userId: w.priya,
      name: 'Priya',
      deviceId: 'DV1',
      deviceLabel: 'Redmi Note 12 · Chrome',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'New phone for Priya',
    body: 'Approve it before they can check in.',
    urgency: 'high',
  },
  {
    n: 20,
    type: 'device_decided',
    at: ist('12:10'),
    event: (w) => ({
      type: 'device_decided',
      userId: w.priya,
      deviceId: 'DV1',
      decision: 'approved',
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your phone is approved',
    body: 'You can check in now.',
  },
  {
    n: 21,
    type: 'pin_attempts',
    at: ist('12:00'),
    event: (w) => ({ type: 'pin_attempts', userId: w.priya, name: 'Priya', count: 10 }),
    to: (w) => [w.owner],
    push: true,
    title: "Several wrong PIN tries on Priya's account",
    body: '10 wrong tries in 24 hours.',
  },
  {
    n: 22,
    type: 'advance_recorded',
    at: ist('12:00'),
    event: (w) => ({
      type: 'advance_recorded',
      userId: w.kajal,
      advanceId: 'A1',
      amountPaise: 300000,
      givenOn: D,
      recoverySummary: '₹3,000 from October salary',
    }),
    to: (w) => [w.kajal],
    push: false,
    title: 'Urmi recorded an advance of ₹3,000',
    body: 'Recovery: ₹3,000 from October salary. Is this right?',
  },
  {
    n: 23,
    type: 'advance_requested',
    at: ist('12:00'),
    event: (w) => ({
      type: 'advance_requested',
      userId: w.kajal,
      name: 'Kajal',
      advanceId: 'A2',
      amountPaise: 200000,
      reason: "Mother's medicine",
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Kajal asked for an advance',
    body: "₹2,000 · 'Mother's medicine'",
  },
  {
    n: 24,
    type: 'payroll_draft_ready',
    at: ist('09:00', '2026-11-01'),
    event: () => ({
      type: 'payroll_draft_ready',
      runId: 'RUN1',
      month: '2026-10',
      blockersCount: 3,
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'October payroll is ready to check',
    body: '3 things need a look first.',
  },
  {
    n: 25,
    type: 'payslip_ready',
    at: ist('15:00', '2026-11-03'),
    event: (w) => ({
      type: 'payslip_ready',
      userIds: [w.priya, w.kajal],
      runId: 'RUN1',
      month: '2026-10',
    }),
    to: (w) => [w.priya, w.kajal],
    push: true,
    title: 'Your October payslip is ready',
    body: null,
  },
  {
    n: 26,
    type: 'salary_unpaid',
    at: ist('10:00', '2026-11-05'),
    event: () => ({ type: 'salary_unpaid', runId: 'RUN1', month: '2026-10', unpaidCount: 3 }),
    to: (w) => [w.owner],
    push: true,
    title: '3 salaries for October are not marked paid',
    body: 'The legal deadline is the 7th.',
  },
  {
    n: 37,
    type: 'payslip_pdf_failed',
    at: ist('12:00', '2026-11-02'),
    event: () => ({ type: 'payslip_pdf_failed', runId: 'RUN1', month: '2026-10', failedCount: 1 }),
    to: (w) => [w.owner],
    push: true,
    title: "1 payslip PDF couldn't be made",
    body: 'The online slip works.',
  },
  {
    n: 32,
    type: 'roll_call_due',
    at: ist('15:00'),
    event: () => ({ type: 'roll_call_due', rollCallId: 'RC1', workDate: D, slotTime: '15:00' }),
    to: (w) => [w.owner],
    push: true,
    title: 'Roll-call time',
    body: "Who's not here? It takes about 20 seconds.",
  },
  {
    n: 33,
    type: 'roll_call_missed',
    at: ist('15:30'),
    event: () => ({ type: 'roll_call_missed', rollCallId: 'RC1', workDate: D, slotTime: '15:00' }),
    to: (w) => [w.owner],
    push: false,
    title: 'Roll-call at 15:00 not done',
    body: 'Tap to do it now.',
  },
  {
    n: 34,
    type: 'staff_stepped_out',
    at: ist('14:40'),
    event: (w) => ({
      type: 'staff_stepped_out',
      userId: w.priya,
      name: 'Priya',
      awayId: 'AW1',
      workDate: D,
      startTs: ist('14:40'),
      reason: 'lunch',
    }),
    to: (w) => [w.owner],
    push: false,
    title: 'Priya stepped out',
    body: 'Lunch outside, since 14:40.',
  },
  {
    n: 35,
    type: 'away_to_confirm',
    at: ist('16:10'),
    event: (w) => ({
      type: 'away_to_confirm',
      userId: w.priya,
      name: 'Priya',
      awayId: 'AW1',
      workDate: D,
      startTs: ist('15:30'),
      endTs: ist('16:10'),
      minutes: 40,
      reason: 'lunch',
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Priya stepped out 15:30–16:10',
    body: '40 min, lunch outside. Confirm, mark as work or ignore.',
  },
  {
    n: 36,
    type: 'left_without_checkout',
    at: ist('20:30'),
    event: (w) => ({
      type: 'left_without_checkout',
      userId: w.priya,
      name: 'Priya',
      workDate: D,
      awaySinceTs: ist('16:10'),
    }),
    to: (w) => [w.owner],
    push: true,
    title: 'Priya may have left without checking out',
    body: 'Away since 16:10.',
  },
  {
    n: 27,
    type: 'schedule_changed',
    at: ist('14:00'),
    event: (w) => ({
      type: 'schedule_changed',
      userId: w.priya,
      date: '2026-10-29',
      summary: 'Your week off moved to Wednesday 29 Oct',
    }),
    to: (w) => [w.priya],
    push: true,
    title: 'Your week off moved to Wednesday 29 Oct',
    body: null,
  },
  {
    n: 28,
    type: 'holiday_announced',
    at: ist('14:00'),
    event: () => ({ type: 'holiday_announced', date: '2026-11-08', name: 'Diwali' }),
    to: (w) => [w.priya, w.kajal, w.neha],
    push: true,
    title: 'Salon closed on 8 Nov for Diwali',
    body: null,
  },
  {
    n: 29,
    type: 'needs_action_reminder',
    at: ist('10:45'),
    event: () => ({ type: 'needs_action_reminder', count: 2 }),
    to: (w) => [w.owner],
    push: false,
    title: '2 requests are waiting more than 2 days',
    body: 'Open Needs action to clear them.',
  },
];

describe('PRD 6 matrix: inbox rows, push, timing and copy', () => {
  for (const row of rows) {
    const label = `N${row.n} ${row.type}${row.title.length > 0 ? `: "${row.title}"` : ''}`;
    it(`S-15.1 O-17.1 ${label}`, async () => {
      const w = await world();
      await emitAt(w.salon, row.at, row.event(w));

      const recipients = row.to(w);
      const inbox = await allInbox();
      expect(inbox.map((r) => r.user_id).sort()).toEqual([...recipients].sort());
      for (const r of inbox) {
        expect(r.type).toBe(row.type);
        expect(r.title).toBe(row.title);
        expect(r.body).toBe(row.body);
      }

      expect(w.push.sent.length).toBe(row.push ? recipients.length : 0);
      for (const sent of w.push.sent) {
        expect(sent.payload.web_push).toBe(8030);
        expect(sent.payload.t).toBe(row.type);
        expect(sent.payload.notification.title).toBe(row.title);
        expect(sent.payload.notification.body).toBe(row.body ?? undefined);
        expect(sent.payload.notification.lang).toBe('en-IN');
        expect(JSON.stringify(sent.payload).length).toBeLessThan(2048);
        expect(sent.opts.urgency).toBe(row.urgency ?? 'normal');
        expect(sent.opts.ttlSec).toBe(row.ttl ?? FOUR_H);
        const topic = row.topic?.(w);
        if (topic) {
          expect(sent.opts.topic).toBe(topic);
          expect(sent.payload.topic).toBe(topic);
          expect(topic.length).toBeLessThanOrEqual(32);
        }
      }
    });
  }

  it('N30 weekly_digest goes to the owner by email and in-app, with no push by default', async () => {
    const w = await world();
    await emitAt(w.salon, ist('09:00', '2026-10-19'), {
      type: 'weekly_digest',
      weekStart: '2026-10-12',
      onTimePct: 94,
      otApprovedMin: 360,
      leaves: 1,
    });
    // The owner row has no email in this fixture's seed unless the scenario provides one.
    const inbox = await allInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.user_id).toBe(w.owner);
    expect(inbox[0]?.title).toBe('Last week: 94% on time, 6 h overtime approved, 1 leave.');
    expect(w.push.sent).toHaveLength(0);
    expect(w.email.sent).toHaveLength(1);
    expect(w.email.sent[0]?.subject).toBe(
      'Last week: 94% on time, 6 h overtime approved, 1 leave.',
    );
  });

  it('N31 sign_in_link emails the owner the code and link, writes no inbox row', async () => {
    const w = await world();
    await emitAt(w.salon, ist('12:00'), {
      type: 'sign_in_link',
      email: 'owner@feelings.test',
      url: 'https://staff.test/auth/owner?token=abc',
      code: '482913',
    });
    expect(await allInbox()).toHaveLength(0);
    expect(w.push.sent).toHaveLength(0);
    expect(w.email.sent).toHaveLength(1);
    const mail = w.email.sent[0];
    expect(mail?.to).toBe('owner@feelings.test');
    expect(mail?.subject).toBe('Your Feelings Staff sign-in code: 482913');
    expect(mail?.text).toContain('482913');
    expect(mail?.text).toContain('https://staff.test/auth/owner?token=abc');
    expect(mail?.text).toContain('15 minutes');
    expect(mail?.html).toContain('482913');
  });

  it('S-15.1 the matrix covers every event type in the contract', () => {
    const covered = new Set<string>(rows.map((r) => r.type));
    covered.add('weekly_digest');
    covered.add('sign_in_link');
    const all = Object.keys(NOTIFY_EVENT_NUMBER);
    expect([...covered].sort()).toEqual([...all].sort());
    // The contract's event union has one schema per type.
    const sample: NotifyEvent['type'][] = all as NotifyEvent['type'][];
    expect(sample).toHaveLength(37);
  });
});
