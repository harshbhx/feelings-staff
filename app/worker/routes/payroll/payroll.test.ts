/**
 * WP-5 payroll API suite (PRD 4.13, 4.14, 4.10; O-12, O-13, O-14 API parts, S-14 API parts): advances,
 * the October draft with blockers, adjustments, finalise, reopen, mark paid, payslip views and verify.
 */
import type { Endpoints, OutputOf, PayrollRunView } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { call, callJson, resetScenario, type Scenario, testEnv } from '../../test/helpers';
import { auditActions, errorCode, setClock } from '../auth/test/kit';
import {
  addPerson,
  addPunches,
  decideOvertime,
  fillMonth,
  login,
  monthIsOver,
  noHolidays,
  type Person,
  stepUpLogin,
  sundayRoster,
} from './test/kit';

type OwnerPayslip = OutputOf<Endpoints['ownerPayslipPreview']>;

let s: Scenario;
let notifier: ReturnType<typeof fakeNotifier>;
let owner: string;
let priya: Person;

/** Priya's October from PRD 7.15 example 11. */
async function example11(): Promise<void> {
  await fillMonth(priya.id, '2026-10', {
    script: {
      '2026-10-01': [],
      '2026-10-02': [
        ['in', '10:00'],
        ['out', '15:00'],
      ],
      '2026-10-07': [
        ['in', '10:25'],
        ['out', '20:00'],
      ],
      '2026-10-08': [
        ['in', '10:30'],
        ['out', '20:00'],
      ],
      '2026-10-09': [
        ['in', '10:22'],
        ['out', '20:00'],
      ],
      '2026-10-11': [
        ['in', '10:15'],
        ['out', '13:00'],
      ],
      '2026-10-14': [
        ['in', '10:00'],
        ['out', '22:30'],
      ],
    },
  });
  await decideOvertime(priya.id, '2026-10-14', 150, 150);
}

async function startOctober(): Promise<string> {
  const res = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
    cookie: owner,
    body: { month: '2026-10' },
  });
  expect(res.status).toBe(201);
  return res.body.run.id;
}

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
  owner = await login(s.ownerId);
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
  await sundayRoster(priya.id, '2026-10');
  await monthIsOver();
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('O-13.1 the draft', () => {
  it('O-13.1 starts a draft for a finished month and refuses a second one', async () => {
    await example11();
    const id = await startOctober();
    const view = await callJson<PayrollRunView>('GET', `/owner/payroll-runs/${id}`, {
      cookie: owner,
    });
    expect(view.body.run).toMatchObject({
      month: '2026-10',
      revision: 1,
      status: 'draft',
      preview: false,
    });
    expect(view.body.lines).toHaveLength(1);
    const again = await call('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-10' },
    });
    expect(again.status).toBe(409);
    expect((await errorCode(again)).code).toBe('DUPLICATE');
    expect(await auditActions(id)).toEqual(['payroll.draft']);
  });

  it('O-13.1 refuses a month that is not over', async () => {
    const res = await call('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-11' },
    });
    expect(res.status).toBe(422);
  });

  it('O-13.1 the payroll-so-far preview is read-only and pays up to today', async () => {
    await setClock(Date.UTC(2026, 9, 16, 5, 0));
    const res = await callJson<PayrollRunView>('GET', '/owner/payroll-preview?month=2026-10', {
      cookie: owner,
    });
    expect(res.body.run.preview).toBe(true);
    const runs = await callJson<unknown[]>('GET', '/owner/payroll-runs', { cookie: owner });
    expect(runs.body).toHaveLength(0);
    const line = res.body.lines[0];
    expect(line?.grossPaise).toBeLessThan(1_500_000);
  });
});

describe('O-13.2 blockers and their defaults', () => {
  it('O-13.2 lists open items with the stated default for each', async () => {
    await example11();
    await addPunches(priya.id, '2026-10-12', [['in', '10:00']], 'pending');
    await addPunches(
      priya.id,
      '2026-10-13',
      [
        ['in', '10:00'],
        ['out', '20:00'],
      ],
      'flagged',
    );
    await testEnv.DB.prepare(
      `INSERT INTO regularisations (id, org_id, user_id, work_date, kind, reason, status, created_at)
       SELECT 'R1' || substr(id, 3), org_id, id, '2026-10-20', 'missed_out', 'Forgot', 'pending', 0 FROM users WHERE id = ?1`,
    )
      .bind(priya.id)
      .run();
    const id = await startOctober();
    const { body } = await callJson<PayrollRunView>('GET', `/owner/payroll-runs/${id}`, {
      cookie: owner,
    });
    const kinds = body.blockers.map((b) => b.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['pending_punches', 'flagged_punches', 'regularisations_undecided']),
    );
    const pending = body.blockers.find((b) => b.kind === 'pending_punches');
    expect(pending?.count).toBe(1);
    expect(pending?.defaultAction).toMatch(/Not counted/);
    expect(body.blockers.find((b) => b.kind === 'flagged_punches')?.defaultAction).toMatch(
      /accepted/,
    );
  });

  it('O-13.2 finalising with blockers needs acceptDefaults', async () => {
    await example11();
    await addPunches(priya.id, '2026-10-12', [['in', '10:00']], 'pending');
    const id = await startOctober();
    const stepUp = await stepUpLogin(s.ownerId);
    const refused = await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: false },
    });
    expect(refused.status).toBe(422);
    const err = await errorCode(refused);
    expect(err.details?.blockers).toBeTruthy();
    const ok = await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    expect(ok.status).toBe(200);
  });
});

describe('O-13.6 the October fixture reproduces example 11 to the paisa', () => {
  async function review(): Promise<{ id: string; slip: OwnerPayslip }> {
    await example11();
    const id = await startOctober();
    const add = await callJson<OwnerPayslip>('POST', `/owner/payroll-runs/${id}/adjustments`, {
      cookie: owner,
      body: {
        userId: priya.id,
        kind: 'incentive',
        amountPaise: 50_000,
        note: 'Bridal season incentive',
      },
    });
    expect(add.status).toBe(201);
    const adv = await callJson<{ id: string }>('POST', '/owner/advances', {
      cookie: owner,
      body: {
        userId: priya.id,
        amountPaise: 300_000,
        givenOn: '2026-10-12',
        mode: 'cash',
        plan: 'full',
        firstMonth: '2026-10',
        askStaffAck: true,
      },
    });
    expect(adv.status).toBe(201);
    const slip = await callJson<OwnerPayslip>(
      'GET',
      `/owner/payroll-runs/${id}/people/${priya.id}`,
      { cookie: owner },
    );
    return { id, slip: slip.body };
  }

  it('O-13.6 the draft payslip has every line of example 11', async () => {
    const { slip } = await review();
    const amount = (code: string) =>
      slip.result.lines.filter((l) => l.code === code).reduce((n, l) => n + l.amountPaise, 0);
    expect(amount('salary')).toBe(1_500_000);
    expect(amount('overtime')).toBe(26_882);
    expect(amount('incentive')).toBe(50_000);
    expect(amount('lop')).toBe(-72_581);
    expect(amount('undertime')).toBe(-5_556);
    expect(amount('advance_recovery')).toBe(-300_000);
    expect(slip.result).toMatchObject({
      grossPaise: 1_576_882,
      deductionsPaise: 378_137,
      roundingPaise: -45,
      netPaise: 1_198_700,
    });
    expect(slip.status).toBe('draft');
    expect(slip.id).toBeNull();
    expect(slip.adjustments).toHaveLength(1);
    expect(slip.advances[0]).toMatchObject({
      duePaise: 300_000,
      recoverPaise: 300_000,
      balancePaise: 0,
    });
  });

  it('O-13.3 finalise freezes the snapshot, locks the month and tells staff', async () => {
    const { id } = await review();
    const stepUp = await stepUpLogin(s.ownerId);
    const done = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    expect(done.status).toBe(200);
    expect(done.body.run.status).toBe('finalised');
    expect(done.body.lines[0]).toMatchObject({ netPaise: 1_198_700, pdfStatus: 'pending' });
    const locked = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n, SUM(locked) AS l FROM attendance_days WHERE user_id = ?1 AND payroll_run_id = ?2',
    )
      .bind(priya.id, id)
      .first<{ n: number; l: number }>();
    expect(locked?.n).toBe(31);
    expect(locked?.l).toBe(31);
    const rec = await testEnv.DB.prepare(
      'SELECT recovered_paise, carried_paise FROM advance_recoveries WHERE payroll_run_id = ?1',
    )
      .bind(id)
      .first<{ recovered_paise: number; carried_paise: number }>();
    expect(rec).toEqual({ recovered_paise: 300_000, carried_paise: 0 });
    const adv = await testEnv.DB.prepare('SELECT status FROM advances WHERE user_id = ?1')
      .bind(priya.id)
      .first<{ status: string }>();
    expect(adv?.status).toBe('closed');
    expect(notifier.events.map((e) => e.type)).toContain('payslip_ready');
    expect(await auditActions(id)).toEqual(['payroll.draft', 'payroll.finalise']);
    // a final run no longer takes changes
    const late = await call('POST', `/owner/payroll-runs/${id}/adjustments`, {
      cookie: owner,
      body: { userId: priya.id, kind: 'bonus', amountPaise: 100, note: 'x' },
    });
    expect(late.status).toBe(409);
  });

  it('O-13.3 finalise needs the step-up PIN', async () => {
    const { id } = await review();
    const res = await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: owner,
      body: { acceptDefaults: true },
    });
    expect((await errorCode(res)).code).toBe('STEP_UP_REQUIRED');
  });
});

describe('S-14 staff payslips, verify and PDF (O-14 API parts)', () => {
  async function finalised(): Promise<{ id: string; slipId: string }> {
    await example11();
    const id = await startOctober();
    const stepUp = await stepUpLogin(s.ownerId);
    await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const row = await testEnv.DB.prepare('SELECT id FROM payslips WHERE user_id = ?1')
      .bind(priya.id)
      .first<{ id: string }>();
    return { id, slipId: row?.id ?? '' };
  }

  it('S-14.1 staff see only their own payslips, and only after finalise', async () => {
    await example11();
    const id = await startOctober();
    const staff = await login(priya.id);
    expect((await callJson<unknown[]>('GET', '/me/payslips', { cookie: staff })).body).toEqual([]);
    const stepUp = await stepUpLogin(s.ownerId);
    await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const list = await callJson<{ id: string; netPaise: number; month: string }[]>(
      'GET',
      '/me/payslips',
      { cookie: staff },
    );
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ month: '2026-10', netPaise: 1_198_700 });
    const asha = await addPerson(owner, { name: 'Asha Mehta' });
    const other = await login(asha.id);
    const denied = await call('GET', `/me/payslips/${list.body[0]?.id}`, { cookie: other });
    expect(denied.status).toBe(404);
    const mine = await callJson<{ result: { netPaise: number }; verifyUrl: string }>(
      'GET',
      `/me/payslips/${list.body[0]?.id}`,
      { cookie: staff },
    );
    expect(mine.body.result.netPaise).toBe(1_198_700);
    expect(mine.body.verifyUrl).toMatch(/^https:\/\/staff\.test\/v\//);
  });

  it('S-14.1 the owner setting can hide payslips from staff', async () => {
    await finalised();
    await testEnv.DB.prepare(
      "UPDATE orgs SET settings_json = json_set(settings_json, '$.pay.showPayslipsToStaff', json('false'))",
    ).run();
    const staff = await login(priya.id);
    expect((await callJson<unknown[]>('GET', '/me/payslips', { cookie: staff })).body).toEqual([]);
  });

  it('S-14.2 the PDF answers 202 while pending, then serves the stored file', async () => {
    const { slipId } = await finalised();
    const staff = await login(priya.id);
    const pending = await call('GET', `/payslips/${slipId}/pdf`, { cookie: staff });
    expect(pending.status).toBe(202);
    const key = `payslips/test/2026-10/${slipId}-r1.pdf`;
    const bytes = new TextEncoder().encode('%PDF-1.4 test');
    await testEnv.MEDIA.put(key, bytes);
    await testEnv.DB.prepare("UPDATE payslips SET pdf_key = ?1, pdf_status = 'ready' WHERE id = ?2")
      .bind(key, slipId)
      .run();
    const ready = await call('GET', `/payslips/${slipId}/pdf`, { cookie: staff });
    expect(ready.status).toBe(200);
    expect(ready.headers.get('Content-Type')).toBe('application/pdf');
    expect(new Uint8Array(await ready.arrayBuffer())).toEqual(bytes);
    const ownerRes = await call('GET', `/payslips/${slipId}/pdf`, { cookie: owner });
    expect(ownerRes.status).toBe(200);
    const asha = await addPerson(owner, { name: 'Asha Mehta' });
    const denied = await call('GET', `/payslips/${slipId}/pdf`, {
      cookie: await login(asha.id),
    });
    expect(denied.status).toBe(404);
  });

  it('O-14.3 the verify URL shows only the allowed fields', async () => {
    const { slipId } = await finalised();
    const row = await testEnv.DB.prepare('SELECT verify_token FROM payslips WHERE id = ?1')
      .bind(slipId)
      .first<{ verify_token: string }>();
    const ok = await callJson<Record<string, unknown>>(
      'GET',
      `/verify/payslip/${row?.verify_token}`,
    );
    expect(ok.body).toEqual({
      valid: true,
      orgName: 'Feelings Beauty Care',
      staffName: 'Priya S.',
      month: '2026-10',
      netPaise: 1_198_700,
      revision: 1,
      superseded: false,
    });
    const bad = await callJson<{ valid: boolean }>(
      'GET',
      '/verify/payslip/0123456789abcdef0123456789',
    );
    expect(bad.body.valid).toBe(false);
  });
});

describe('O-13.5 mark paid', () => {
  it('O-13.5 marks one salary, then all, with audit rows', async () => {
    const asha = await addPerson(owner, { name: 'Asha Mehta' });
    await sundayRoster(asha.id, '2026-10');
    await fillMonth(asha.id, '2026-10');
    await example11();
    const id = await startOctober();
    const stepUp = await stepUpLogin(s.ownerId);
    await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const slips = await testEnv.DB.prepare('SELECT id, user_id FROM payslips').all<{
      id: string;
      user_id: string;
    }>();
    const hers = slips.results.find((r) => r.user_id === priya.id)?.id ?? '';
    const one = await callJson<OwnerPayslip>('POST', `/owner/payslips/${hers}/mark-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'upi', ref: 'UPI123' },
    });
    expect(one.status).toBe(200);
    expect(one.body.paid).toEqual({ on: '2026-11-02', mode: 'upi', ref: 'UPI123' });
    expect(one.body.waLink).toMatch(/^https:\/\/wa\.me\/91/);
    const twice = await call('POST', `/owner/payslips/${hers}/mark-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'upi' },
    });
    expect((await errorCode(twice)).code).toBe('ALREADY_DECIDED');
    const all = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${id}/mark-all-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'cash' },
    });
    expect(all.body.totals.paidCount).toBe(2);
    expect(await auditActions(hers)).toEqual(['payroll.mark_paid']);
    const future = await call('POST', `/owner/payroll-runs/${id}/mark-all-paid`, {
      cookie: owner,
      body: { paidOn: '2027-01-01', mode: 'cash' },
    });
    expect(future.status).toBe(422);
  });
});

describe('O-13.4 reopen', () => {
  it('O-13.4 creates revision 2, unlocks the month and keeps revision 1 payslips as superseded', async () => {
    await example11();
    const id = await startOctober();
    const stepUp = await stepUpLogin(s.ownerId);
    await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const slip1 = await testEnv.DB.prepare('SELECT id, verify_token FROM payslips').first<{
      id: string;
      verify_token: string;
    }>();
    await call('POST', `/owner/payslips/${slip1?.id}/mark-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'cash' },
    });
    const reopened = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${id}/reopen`, {
      cookie: stepUp,
      body: { reason: 'Forgot an incentive', settleMode: 'reissue' },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.run).toMatchObject({
      revision: 2,
      status: 'draft',
      reopenedReason: 'Forgot an incentive',
    });
    const old = await testEnv.DB.prepare('SELECT status FROM payroll_runs WHERE id = ?1')
      .bind(id)
      .first<{ status: string }>();
    expect(old?.status).toBe('superseded');
    const unlocked = await testEnv.DB.prepare(
      'SELECT SUM(locked) AS l FROM attendance_days WHERE user_id = ?1',
    )
      .bind(priya.id)
      .first<{ l: number }>();
    expect(unlocked?.l).toBe(0);
    const staff = await login(priya.id);
    const list = await callJson<{ superseded: boolean; revision: number }[]>(
      'GET',
      '/me/payslips',
      { cookie: staff },
    );
    expect(list.body).toEqual([expect.objectContaining({ revision: 1, superseded: true })]);
    const verify = await callJson<{ superseded: boolean }>(
      'GET',
      `/verify/payslip/${slip1?.verify_token}`,
    );
    expect(verify.body.superseded).toBe(true);
    // revision 2 takes a new incentive and finalises with the paid record kept
    const rev2 = reopened.body.run.id;
    await call('POST', `/owner/payroll-runs/${rev2}/adjustments`, {
      cookie: owner,
      body: { userId: priya.id, kind: 'bonus', amountPaise: 100_000, note: 'Forgotten bonus' },
    });
    const done = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${rev2}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    expect(done.body.lines[0]?.paid).toMatchObject({ on: '2026-11-02', mode: 'cash' });
    expect(done.body.lines[0]?.netPaise).toBeGreaterThan(1_198_700);
    expect(await auditActions(id)).toEqual(['payroll.draft', 'payroll.finalise', 'payroll.reopen']);
  });

  it('O-13.4 settle next month posts the difference into the next draft', async () => {
    await example11();
    const id = await startOctober();
    const stepUp = await stepUpLogin(s.ownerId);
    await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const slip1 = await testEnv.DB.prepare('SELECT id FROM payslips').first<{ id: string }>();
    await call('POST', `/owner/payslips/${slip1?.id}/mark-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'cash' },
    });
    const reopened = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${id}/reopen`, {
      cookie: stepUp,
      body: { reason: 'Missed a bonus', settleMode: 'next_month' },
    });
    const rev2 = reopened.body.run.id;
    await call('POST', `/owner/payroll-runs/${rev2}/adjustments`, {
      cookie: owner,
      body: { userId: priya.id, kind: 'bonus', amountPaise: 100_000, note: 'Forgotten bonus' },
    });
    await call('POST', `/owner/payroll-runs/${rev2}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    await setClock(Date.UTC(2026, 11, 2, 5, 0));
    await sundayRoster(priya.id, '2026-11');
    const nov = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-11' },
    });
    const slip = await callJson<OwnerPayslip>(
      'GET',
      `/owner/payroll-runs/${nov.body.run.id}/people/${priya.id}`,
      { cookie: owner },
    );
    const arrears = slip.body.result.lines.find((l) => l.code === 'arrears');
    expect(arrears?.amountPaise).toBeGreaterThan(0);
  });
});

describe('O-13 recompute and adjustments', () => {
  it('O-13.2 deleting an adjustment and lowering the recovery change the draft', async () => {
    await example11();
    const id = await startOctober();
    await callJson('POST', '/owner/advances', {
      cookie: owner,
      body: {
        userId: priya.id,
        amountPaise: 300_000,
        givenOn: '2026-10-12',
        mode: 'cash',
        plan: 'full',
        firstMonth: '2026-10',
        askStaffAck: false,
      },
    });
    const adv = await testEnv.DB.prepare('SELECT id FROM advances').first<{ id: string }>();
    const lowered = await callJson<OwnerPayslip>(
      'PATCH',
      `/owner/payroll-runs/${id}/advance-recovery`,
      {
        cookie: owner,
        body: { userId: priya.id, advanceId: adv?.id, recoverPaise: 100_000 },
      },
    );
    expect(lowered.body.advances[0]).toMatchObject({
      recoverPaise: 100_000,
      balancePaise: 200_000,
    });
    expect(lowered.body.result.carryOut.advances[0]?.paise).toBe(200_000);
    const added = await callJson<OwnerPayslip>('POST', `/owner/payroll-runs/${id}/adjustments`, {
      cookie: owner,
      body: { userId: priya.id, kind: 'other_deduction', amountPaise: 10_000, note: 'Kit' },
    });
    const adjId = added.body.adjustments[0]?.id;
    const removed = await callJson<OwnerPayslip>(
      'DELETE',
      `/owner/payroll-runs/${id}/adjustments/${adjId}`,
      { cookie: owner },
    );
    expect(removed.body.adjustments).toEqual([]);
    const damage = await call('POST', `/owner/payroll-runs/${id}/adjustments`, {
      cookie: owner,
      body: { userId: priya.id, kind: 'damage', amountPaise: 10_000, note: 'Broke dryer' },
    });
    expect(damage.status).toBe(422);
    const recomputed = await callJson<PayrollRunView>(
      'POST',
      `/owner/payroll-runs/${id}/recompute`,
      { cookie: owner },
    );
    expect(recomputed.status).toBe(200);
    expect(await auditActions(id)).toEqual(
      expect.arrayContaining(['payroll.advance_recovery', 'payroll.recompute']),
    );
  });

  it('O-13 a manager with the payroll permission can read a run but not change it', async () => {
    await example11();
    const id = await startOctober();
    const manager = await addPerson(owner, { name: 'Mina Joshi' });
    await testEnv.DB.prepare(
      "UPDATE users SET role = 'manager', permissions_json = '[\"payroll\"]' WHERE id = ?1",
    )
      .bind(manager.id)
      .run();
    const cookie = await login(manager.id);
    expect((await call('GET', `/owner/payroll-runs/${id}`, { cookie })).status).toBe(200);
    expect((await call('POST', `/owner/payroll-runs/${id}/recompute`, { cookie })).status).toBe(
      403,
    );
  });
});
