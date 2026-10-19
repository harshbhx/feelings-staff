/** WP-5 advances (PRD 4.10; O-12): record, plan, cap carry-forward, staff acknowledgement, requests. */
import type { AdvanceView, PayrollRunView } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { call, callJson, resetScenario, type Scenario, testEnv } from '../../test/helpers';
import { auditActions, errorCode, setClock } from '../auth/test/kit';
import {
  addPerson,
  fillMonth,
  login,
  monthIsOver,
  noHolidays,
  type Person,
  stepUpLogin,
  sundayRoster,
} from './test/kit';

let s: Scenario;
let notifier: ReturnType<typeof fakeNotifier>;
let owner: string;
let priya: Person;

const advanceBody = (over: Record<string, unknown> = {}) => ({
  userId: priya.id,
  amountPaise: 300_000,
  givenOn: '2026-10-12',
  mode: 'cash',
  reason: 'Family function',
  plan: 'full',
  firstMonth: '2026-10',
  askStaffAck: true,
  ...over,
});

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
  owner = await login(s.ownerId);
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('O-12.1 record an advance', () => {
  it('O-12.1 records amount, mode and plan, tells the staff member and writes audit', async () => {
    const res = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody(),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amountPaise: 300_000,
      mode: 'cash',
      plan: 'full',
      status: 'active',
      staffAck: 'pending',
      balancePaise: 300_000,
      recoveredPaise: 0,
    });
    const event = notifier.events.find((e) => e.type === 'advance_recorded');
    expect(event).toMatchObject({
      userId: priya.id,
      recoverySummary: 'Recovery: ₹3,000 from October salary.',
    });
    expect(await auditActions(res.body.id)).toEqual(['advance.create']);
  });

  it('O-12.1 instalments need a count; a finished month cannot be the first recovery month', async () => {
    const noCount = await call('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody({ plan: 'instalments' }),
    });
    expect(noCount.status).toBe(422);
    const ok = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody({ plan: 'instalments', instalmentsN: 3 }),
    });
    expect(ok.body.instalmentsN).toBe(3);
    const list = await callJson<{ items: AdvanceView[]; balances: { balancePaise: number }[] }>(
      'GET',
      `/owner/advances?userId=${priya.id}`,
      { cookie: owner },
    );
    expect(list.body.items).toHaveLength(1);
    expect(list.body.balances[0]?.balancePaise).toBe(300_000);
  });

  it('O-12.1 can be edited before any recovery and cancelled', async () => {
    const made = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody(),
    });
    const edited = await callJson<AdvanceView>('PATCH', `/owner/advances/${made.body.id}`, {
      cookie: owner,
      body: { amountPaise: 250_000 },
    });
    expect(edited.body.amountPaise).toBe(250_000);
    const cancel = await call('DELETE', `/owner/advances/${made.body.id}`, { cookie: owner });
    expect(cancel.status).toBe(204);
    const got = await callJson<AdvanceView>('GET', `/owner/advances/${made.body.id}`, {
      cookie: owner,
    });
    expect(got.body.status).toBe('cancelled');
    expect(await auditActions(made.body.id)).toEqual([
      'advance.create',
      'advance.update',
      'advance.cancel',
    ]);
  });
});

describe('O-12.2 recovery follows the plan and the cap', () => {
  it('O-12.2 an advance over the cap is part-recovered and the rest shows in the next draft', async () => {
    await monthIsOver();
    await sundayRoster(priya.id, '2026-10');
    await fillMonth(priya.id, '2026-10');
    const made = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody({ amountPaise: 1_000_000 }),
    });
    const run = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-10' },
    });
    const stepUp = await stepUpLogin(s.ownerId);
    const done = await callJson<PayrollRunView>(
      'POST',
      `/owner/payroll-runs/${run.body.run.id}/finalise`,
      { cookie: stepUp, body: { acceptDefaults: true } },
    );
    expect(done.body.lines[0]?.netPaise).toBe(750_000);
    const after = await callJson<AdvanceView>('GET', `/owner/advances/${made.body.id}`, {
      cookie: owner,
    });
    expect(after.body).toMatchObject({
      recoveredPaise: 750_000,
      balancePaise: 250_000,
      status: 'active',
    });
    expect(after.body.ledger[0]).toMatchObject({
      month: '2026-10',
      scheduledPaise: 1_000_000,
      recoveredPaise: 750_000,
      carriedPaise: 250_000,
    });
    await setClock(Date.UTC(2026, 11, 2, 5, 0));
    await sundayRoster(priya.id, '2026-11');
    const nov = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-11' },
    });
    const slip = await callJson<{ advances: { duePaise: number; recoverPaise: number }[] }>(
      'GET',
      `/owner/payroll-runs/${nov.body.run.id}/people/${priya.id}`,
      { cookie: owner },
    );
    expect(slip.body.advances[0]).toMatchObject({ duePaise: 250_000, recoverPaise: 250_000 });
  });

  it('O-12.2 an advance with recoveries cannot be edited or cancelled', async () => {
    await monthIsOver();
    await sundayRoster(priya.id, '2026-10');
    await fillMonth(priya.id, '2026-10');
    const made = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody(),
    });
    const run = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-10' },
    });
    await call('POST', `/owner/payroll-runs/${run.body.run.id}/finalise`, {
      cookie: await stepUpLogin(s.ownerId),
      body: { acceptDefaults: true },
    });
    const cancel = await call('DELETE', `/owner/advances/${made.body.id}`, { cookie: owner });
    expect(cancel.status).toBe(409);
    const edit = await call('PATCH', `/owner/advances/${made.body.id}`, {
      cookie: owner,
      body: { amountPaise: 1 },
    });
    expect(edit.status).toBe(409);
  });
});

describe('O-12.3 staff acknowledgement and requests', () => {
  it('O-12.3 the staff member confirms; others cannot touch it', async () => {
    const made = await callJson<AdvanceView>('POST', '/owner/advances', {
      cookie: owner,
      body: advanceBody(),
    });
    const staff = await login(priya.id);
    const mine = await callJson<AdvanceView[]>('GET', '/me/advances', { cookie: staff });
    expect(mine.body).toHaveLength(1);
    const ack = await callJson<AdvanceView>('POST', `/advances/${made.body.id}/ack`, {
      cookie: staff,
      body: { answer: 'confirmed' },
    });
    expect(ack.body.staffAck).toBe('confirmed');
    expect(ack.body.staffAckAt).not.toBeNull();
    const asha = await addPerson(owner, { name: 'Asha Mehta' });
    const other = await call('POST', `/advances/${made.body.id}/ack`, {
      cookie: await login(asha.id),
      body: { answer: 'disputed' },
    });
    expect(other.status).toBe(404);
    expect(await auditActions(made.body.id)).toContain('advance.ack_confirmed');
  });

  it('O-12.3 a request goes to the owner, who approves it and records how it was paid', async () => {
    const staff = await login(priya.id);
    const asked = await callJson<AdvanceView>('POST', '/advance-requests', {
      cookie: staff,
      body: { amountPaise: 200_000, reason: 'Rent', plan: 'full' },
    });
    expect(asked.status).toBe(201);
    expect(asked.body.status).toBe('requested');
    expect(notifier.events.map((e) => e.type)).toContain('advance_requested');
    const again = await call('POST', '/advance-requests', {
      cookie: staff,
      body: { amountPaise: 1000, reason: 'More', plan: 'full' },
    });
    expect((await errorCode(again)).code).toBe('DUPLICATE');
    const decided = await callJson<AdvanceView>('POST', `/owner/advances/${asked.body.id}/decide`, {
      cookie: owner,
      body: { decision: 'approve', mode: 'upi', givenOn: '2026-10-19' },
    });
    expect(decided.body).toMatchObject({ status: 'active', mode: 'upi', givenOn: '2026-10-19' });
    const twice = await call('POST', `/owner/advances/${asked.body.id}/decide`, {
      cookie: owner,
      body: { decision: 'reject' },
    });
    expect((await errorCode(twice)).code).toBe('ALREADY_DECIDED');
    const rows = await testEnv.DB.prepare('SELECT status FROM advances').all();
    expect(rows.results).toHaveLength(1);
  });
});
