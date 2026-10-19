/**
 * WP-9 presence API suite (PRD 4.18, 7.18, 9.4; O-30, S-24): Step out and I'm back, roll-calls, away
 * decisions and edits, the check-out that closes an open step-out, the rules job (N32) and the
 * privacy of the staff views. Time credits are on for October so a counted interval makes an entry.
 */
import {
  type AwayIntervalStaff,
  type AwayIntervalView,
  istToEpoch,
  type PresenceState,
  type RollCallDay,
  type RollCallResult,
  type RollCallView,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  callJson,
  e2eHeaders,
  resetScenario,
  type Scenario,
  testEnv,
} from '../../test/helpers';
import { errorCode, setClock } from '../auth/test/kit';
import {
  addPerson,
  addPunches,
  login,
  noHolidays,
  type Person,
  stepUpLogin,
} from '../payroll/test/kit';

const D = '2026-10-15';
const at = (hhmm: string) => istToEpoch(D, hhmm);
const KEY = 'presence-test-key-0001';

let s: Scenario;
let owner: string;
let staff: string;
let priya: Person;

async function recompute(): Promise<void> {
  const res = await call('POST', '/__test/cron', {
    body: { job: 'recompute-day', date: D },
    headers: e2eHeaders(),
  });
  expect(res.status).toBe(200);
}

const entries = async () =>
  (
    await testEnv.DB.prepare(
      `SELECT kind, minutes, confirmed_by FROM credit_entries
        WHERE user_id = ?1 AND work_date = ?2 AND status = 'active' ORDER BY kind`,
    )
      .bind(priya.id, D)
      .all<{ kind: string; minutes: number; confirmed_by: string | null }>()
  ).results;

const stepOut = (reason = 'errand', note?: string) =>
  callJson<AwayIntervalStaff>('POST', '/presence/step-out', {
    cookie: staff,
    body: { reason, ...(note ? { note } : {}), idempotencyKey: KEY },
  });
const back = () =>
  callJson<AwayIntervalStaff>('POST', '/presence/back', {
    cookie: staff,
    body: { idempotencyKey: KEY },
  });

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  owner = await login(s.ownerId);
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
  staff = await login(priya.id);
  const patch = await call('PATCH', '/owner/settings', {
    cookie: owner,
    body: { settings: { timeCredits: { startDate: '2026-10-01' } } },
  });
  expect(patch.status).toBe(200);
  await addPunches(priya.id, D, [['in', '10:00']], 'accepted');
  await setClock(at('14:40'));
});

afterEach(async () => {
  await setClock(null);
});

describe('S-24.2 Step out and I am back', () => {
  it('S-24.2 steps out, comes back, waits for the owner, and Confirm writes the minus entry', async () => {
    const out = await stepOut('errand', 'Bank for the salon');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      source: 'step_out',
      reason: 'errand',
      state: 'open',
      endTs: null,
    });

    const state = await callJson<PresenceState>('GET', '/me/presence', { cookie: staff });
    expect(state.body.openAway?.id).toBe(out.body.id);

    await setClock(at('15:05'));
    const done = await back();
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ state: 'waiting', awayMin: 25 });
    expect(await entries()).toEqual([]);

    const waiting = await callJson<AwayIntervalView[]>(
      'GET',
      '/owner/presence/away?state=pending',
      { cookie: owner },
    );
    expect(waiting.body).toHaveLength(1);
    expect(waiting.body[0]).toMatchObject({ minutes: 25, staffNote: 'Bank for the salon' });

    const actions = await callJson<{ items: { type: string }[]; counts: Record<string, number> }>(
      'GET',
      '/owner/actions',
      { cookie: owner },
    );
    expect(actions.body.counts.away).toBe(1);

    const decided = await callJson<AwayIntervalView>(
      'POST',
      `/owner/presence/away/${out.body.id}/decide`,
      { cookie: owner, body: { decision: 'confirm' } },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.state).toBe('confirmed');
    expect(await entries()).toEqual([
      expect.objectContaining({ kind: 'away', minutes: -25, confirmed_by: s.ownerId }),
    ]);

    const again = await call('POST', `/owner/presence/away/${out.body.id}/decide`, {
      cookie: owner,
      body: { decision: 'work' },
    });
    expect(again.status).toBe(409);
    expect((await errorCode(again)).code).toBe('ALREADY_DECIDED');
  });

  it('S-24.2 Mark as work makes no entry, Ignore makes none either', async () => {
    const out = await stepOut('errand');
    await setClock(at('15:05'));
    await back();
    const res = await callJson<AwayIntervalView>(
      'POST',
      `/owner/presence/away/${out.body.id}/decide`,
      { cookie: owner, body: { decision: 'work' } },
    );
    expect(res.body.state).toBe('work');
    expect(await entries()).toEqual([]);
    const audit = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'presence.away.work'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('S-24.2 a second Step out while out, and one when not checked in, answer 409', async () => {
    await stepOut();
    const twice = await stepOut();
    expect(twice.status).toBe(409);
    const other = await addPerson(owner, { name: 'Kajal Shah' });
    const kajal = await login(other.id);
    const res = await call('POST', '/presence/step-out', {
      cookie: kajal,
      body: { reason: 'lunch', idempotencyKey: KEY },
    });
    expect(res.status).toBe(409);
  });

  it('S-24.2 a check-out closes an open step-out, flagged I am back missing, waiting for the owner', async () => {
    const out = await stepOut('lunch');
    await setClock(at('16:10'));
    await addPunches(priya.id, D, [['out', '16:10']], 'accepted');
    await recompute();
    const list = await callJson<AwayIntervalView[]>('GET', '/owner/presence/away', {
      cookie: owner,
    });
    const row = list.body.find((r) => r.id === out.body.id);
    expect(row).toMatchObject({
      endReason: 'check_out',
      backMissing: true,
      state: 'pending',
      minutes: 90,
    });
  });

  it('S-24.2 one note per interval', async () => {
    const out = await stepOut();
    const first = await callJson<AwayIntervalStaff>(
      'POST',
      `/me/presence/away/${out.body.id}/note`,
      { cookie: staff, body: { note: 'Back soon' } },
    );
    expect(first.body.staffNote).toBe('Back soon');
    const second = await call('POST', `/me/presence/away/${out.body.id}/note`, {
      cookie: staff,
      body: { note: 'Again' },
    });
    expect(second.status).toBe(409);
  });
});

describe('O-30 roll-call', () => {
  async function slot(time = '15:00') {
    const day = await callJson<RollCallDay>('GET', `/owner/roll-calls?date=${D}`, {
      cookie: owner,
    });
    return day.body.slots.find((x) => x.slotTime === time);
  }

  it('O-30.1 lists the three default slots with their status', async () => {
    await setClock(at('15:10'));
    const day = await callJson<RollCallDay>('GET', `/owner/roll-calls?date=${D}`, {
      cookie: owner,
    });
    expect(day.body.slots.map((x) => [x.slotTime, x.status])).toEqual([
      ['12:00', 'missed'],
      ['15:00', 'open'],
      ['18:00', 'upcoming'],
    ]);
  });

  it('O-30.2 Not here starts a confirmed interval at the slot time and writes the entry; I am back ends it', async () => {
    await setClock(at('15:10'));
    const rc = await slot();
    const view = await callJson<RollCallView>('GET', `/owner/roll-calls/${rc?.id}`, {
      cookie: owner,
    });
    expect(view.body.people.map((p) => p.userId)).toEqual([priya.id]);
    expect(view.body.people[0]?.state).toBe('here');

    const res = await callJson<RollCallResult>('POST', `/owner/roll-calls/${rc?.id}/submit`, {
      cookie: owner,
      body: { notHere: [priya.id], here: [], idempotencyKey: KEY },
    });
    expect(res.status).toBe(200);
    expect(res.body.started).toEqual([priya.id]);

    const mine = await callJson<PresenceState>('GET', '/me/presence', { cookie: staff });
    expect(mine.body.openAway).toMatchObject({
      source: 'roll_call',
      startTs: at('15:00'),
      markedByName: expect.any(String),
    });

    await setClock(at('15:40'));
    const done = await back();
    expect(done.body.state).toBe('counted');
    expect(await entries()).toEqual([
      expect.objectContaining({ kind: 'away', minutes: -40, confirmed_by: s.ownerId }),
    ]);

    const day = await callJson<RollCallDay>('GET', `/owner/roll-calls?date=${D}`, {
      cookie: owner,
    });
    expect(day.body.slots.find((x) => x.slotTime === '15:00')?.status).toBe('done');
  });

  it('O-30.10 editing the roll-call (Here) removes the interval it made and is audited', async () => {
    await setClock(at('15:10'));
    const rc = await slot();
    await call('POST', `/owner/roll-calls/${rc?.id}/submit`, {
      cookie: owner,
      body: { notHere: [priya.id], here: [], idempotencyKey: KEY },
    });
    const edit = await callJson<RollCallResult>('POST', `/owner/roll-calls/${rc?.id}/submit`, {
      cookie: owner,
      body: { notHere: [], here: [priya.id], idempotencyKey: `${KEY}-2` },
    });
    expect(edit.body.ended).toEqual([priya.id]);
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM away_intervals').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
    const audit = await testEnv.DB.prepare(
      "SELECT action FROM audit_log WHERE entity = 'roll_call' ORDER BY created_at, id",
    ).all<{ action: string }>();
    expect(audit.results.map((a) => a.action)).toEqual(['rollcall.submit', 'rollcall.edit']);
  });

  it('O-30.2 somebody who was not checked in cannot be marked', async () => {
    await setClock(at('15:10'));
    const rc = await slot();
    const other = await addPerson(owner, { name: 'Kajal Shah' });
    const res = await call('POST', `/owner/roll-calls/${rc?.id}/submit`, {
      cookie: owner,
      body: { notHere: [other.id], here: [], idempotencyKey: KEY },
    });
    expect(res.status).toBe(400);
  });

  it('O-30.4 start and end are editable with a reason and audited old to new', async () => {
    await setClock(at('15:10'));
    const rc = await slot();
    await call('POST', `/owner/roll-calls/${rc?.id}/submit`, {
      cookie: owner,
      body: { notHere: [priya.id], here: [], idempotencyKey: KEY },
    });
    await setClock(at('15:40'));
    await back();
    const list = await callJson<AwayIntervalView[]>('GET', '/owner/presence/away', {
      cookie: owner,
    });
    const row = list.body[0] as AwayIntervalView;
    expect(row.minutes).toBe(40);
    const patched = await callJson<AwayIntervalView>('PATCH', `/owner/presence/away/${row.id}`, {
      cookie: owner,
      body: { startTs: at('15:10'), editReason: 'Priya left at 15:10' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.minutes).toBe(30);
    expect(await entries()).toEqual([expect.objectContaining({ kind: 'away', minutes: -30 })]);
    const audit = await testEnv.DB.prepare(
      "SELECT before_json, after_json, reason FROM audit_log WHERE action = 'presence.away.edit'",
    ).first<{ before_json: string; after_json: string; reason: string }>();
    expect(audit?.before_json).toContain(`"startTs":${at('15:00')}`);
    expect(audit?.after_json).toContain(`"startTs":${at('15:10')}`);
    expect(audit?.reason).toBe('Priya left at 15:10');
  });

  it('O-30.1 the rules job sends N32 at the slot time to the owner when someone is checked in', async () => {
    const res = await call('POST', '/__test/cron', {
      body: { job: 'rules', at: at('15:02') },
      headers: e2eHeaders(),
    });
    expect(res.status).toBe(200);
    const rows = await testEnv.DB.prepare(
      "SELECT user_id FROM notifications WHERE type = 'roll_call_due'",
    ).all<{ user_id: string }>();
    expect(rows.results.map((r) => r.user_id)).toEqual([s.ownerId]);
    // Ticking again in the same slot sends nothing more.
    await call('POST', '/__test/cron', {
      body: { job: 'rules', at: at('15:07') },
      headers: e2eHeaders(),
    });
    const again = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'roll_call_due'",
    ).first<{ n: number }>();
    expect(again?.n).toBe(1);
  });

  it('O-30.9 a manager with rollcall can run a roll-call but cannot read the away list', async () => {
    const meera = await addPerson(owner, { name: 'Meera Joshi' });
    const upsert = await call('PUT', '/owner/managers', {
      cookie: await stepUpLogin(s.ownerId),
      body: { userId: meera.id, permissions: ['rollcall'], staffIds: [] },
    });
    expect(upsert.status).toBe(200);
    const manager = await login(meera.id);
    await setClock(at('15:10'));
    const day = await call('GET', `/owner/roll-calls?date=${D}`, { cookie: manager });
    expect(day.status).toBe(200);
    expect((await call('GET', '/owner/presence/away', { cookie: manager })).status).toBe(403);
    expect((await call('GET', '/owner/credits', { cookie: manager })).status).toBe(403);
  });
});

describe('S-24.4 staff see their own presence, never credits', () => {
  it('S-24.4 history and My data list the interval with its state and carry no credit strings', async () => {
    const out = await stepOut('lunch');
    await setClock(at('15:05'));
    await back();
    await call('POST', `/owner/presence/away/${out.body.id}/decide`, {
      cookie: owner,
      body: { decision: 'confirm' },
    });
    const FORBIDDEN =
      /credits|time_credits|balanceMin|runningBalanceMin|estimatePaise|settleMin|appliedMin|deltaMin|credit_/i;
    const history = await call('GET', '/me/presence/history?month=2026-10', { cookie: staff });
    const text = await history.text();
    expect(text).toContain('counted');
    expect(FORBIDDEN.test(text)).toBe(false);
    const data = await call('GET', '/me/data', { cookie: staff });
    const dataText = await data.text();
    expect(dataText).toContain('"kind":"away"');
    expect(FORBIDDEN.test(dataText)).toBe(false);
    const state = await call('GET', '/me/presence', { cookie: staff });
    expect(FORBIDDEN.test(await state.text())).toBe(false);
  });
});
