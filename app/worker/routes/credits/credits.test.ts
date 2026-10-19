/**
 * WP-9 Time credits API suite (PRD 4.19, 7.17, 9.4; O-29, privacy of 7.17.9): entries written by the
 * day recompute, the Credits overview and ledger, adjustments, the Settle credits step inside the
 * payroll run, finalise and reopen, the CSV export, step-up on the setting, and the privacy test.
 * Priya's October is PRD 7.15 example 13: seven days at 10:10 and 120 minutes of approved overtime.
 */
import {
  type CreditAdjustment,
  type CreditLedger,
  type CreditSettleResult,
  type CreditsOverview,
  type CreditsSettleView,
  ENDPOINT_KEYS,
  type EndpointShape,
  type ExportView,
  endpoints,
  type OwnerPayslipView,
  type PayrollRunView,
  type PayslipView,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakePdf } from '../../test/fakes';
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
  decideOvertime,
  fillMonth,
  login,
  monthIsOver,
  noHolidays,
  type Person,
  stepUpLogin,
  sundayRoster,
} from '../payroll/test/kit';

let s: Scenario;
let owner: string;
let stepUp: string;
let priya: Person;

/** Seven days at 10:10 (Oct 1, 2, 3, 5, 7, 8 and 17) and the 17th stays until 22:10. */
const LATE_DAYS = [
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-05',
  '2026-10-07',
  '2026-10-08',
];

async function recompute(date: string): Promise<void> {
  const res = await call('POST', '/__test/cron', {
    body: { job: 'recompute-day', date },
    headers: e2eHeaders(),
  });
  expect(res.status).toBe(200);
}

/** The 1x examples run with the legal 2x guardrail off; its own suite turns it on. */
async function enableCredits(cookie = stepUp, legalOt2x = false): Promise<void> {
  const res = await call('PATCH', '/owner/settings', {
    cookie,
    body: { settings: { timeCredits: { startDate: '2026-10-01', legalOt2x } } },
  });
  expect(res.status).toBe(200);
}

/** Example 13: the entries are written by recomputing each day, as the punch pipeline does. */
async function example13(): Promise<void> {
  const script: Record<string, ['in' | 'out', string][]> = {};
  for (const d of LATE_DAYS)
    script[d] = [
      ['in', '10:10'],
      ['out', '20:00'],
    ];
  script['2026-10-17'] = [
    ['in', '10:10'],
    ['out', '22:10'],
  ];
  await fillMonth(priya.id, '2026-10', { script });
  await decideOvertime(priya.id, '2026-10-17', 120, 120);
  for (const d of [...LATE_DAYS, '2026-10-17']) await recompute(d);
}

const entries = async (userId = priya.id) =>
  (
    await testEnv.DB.prepare(
      `SELECT work_date, kind, minutes, status, confirmed_by FROM credit_entries
        WHERE user_id = ?1 AND status = 'active' ORDER BY work_date, kind`,
    )
      .bind(userId)
      .all<{ work_date: string; kind: string; minutes: number; confirmed_by: string | null }>()
  ).results;

const overview = async (cookie = owner) =>
  (await callJson<CreditsOverview>('GET', '/owner/credits', { cookie })).body;

async function startOctober(): Promise<string> {
  const res = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
    cookie: owner,
    body: { month: '2026-10' },
  });
  expect(res.status).toBe(201);
  return res.body.run.id;
}

const settle = (runId: string, settleMin: number, cookie = owner) =>
  callJson<CreditSettleResult>('PUT', `/owner/payroll-runs/${runId}/credits/${priya.id}`, {
    cookie,
    body: { settleMin },
  });

const auditRows = async (action: string) =>
  (
    await testEnv.DB.prepare(
      'SELECT entity_id, before_json, after_json, reason FROM audit_log WHERE action = ?1',
    )
      .bind(action)
      .all<{
        entity_id: string;
        before_json: string | null;
        after_json: string | null;
        reason: string | null;
      }>()
  ).results;

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  owner = await login(s.ownerId);
  stepUp = await stepUpLogin(s.ownerId);
  setServiceOverridesForTests({ pdf: fakePdf() });
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
  await sundayRoster(priya.id, '2026-10');
  await monthIsOver();
  await enableCredits();
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('O-29.1 each day writes entries (PRD 7.17.2)', () => {
  it('O-29.1 example 13: late from the first minute, approved overtime plus, balance +50', async () => {
    await example13();
    const rows = await entries();
    expect(rows.filter((r) => r.kind === 'late')).toHaveLength(7);
    expect(rows.filter((r) => r.kind === 'late').every((r) => r.minutes === -10)).toBe(true);
    expect(rows.filter((r) => r.kind === 'ot')).toEqual([
      expect.objectContaining({ work_date: '2026-10-17', minutes: 120 }),
    ]);
    const o = await overview();
    expect(o.enabled).toBe(true);
    const row = o.staff.find((r) => r.userId === priya.id);
    // The estimate uses today's r_day (November, 30 days): 15,000 / 30 x 50 / 540 = Rs 46.30.
    // The settlement below uses the run month's r_day (October): Rs 44.80.
    expect(row).toMatchObject({ balanceMin: 50, estimatePaise: 4630, awayPending: 0 });
  });

  it('O-29.1 early leave counts from the first minute, below the tolerance too', async () => {
    await fillMonth(priya.id, '2026-10', {
      script: {
        '2026-10-02': [
          ['in', '10:00'],
          ['out', '19:50'],
        ],
      },
    });
    await recompute('2026-10-02');
    expect(await entries()).toEqual([
      expect.objectContaining({ work_date: '2026-10-02', kind: 'early', minutes: -10 }),
    ]);
  });

  it('O-29.1 minus entries only on P days: a half day carries none', async () => {
    await fillMonth(priya.id, '2026-10', {
      script: {
        '2026-10-02': [
          ['in', '10:30'],
          ['out', '14:30'],
        ],
      },
    });
    await recompute('2026-10-02');
    const day = await testEnv.DB.prepare(
      "SELECT status FROM attendance_days WHERE user_id = ?1 AND work_date = '2026-10-02'",
    )
      .bind(priya.id)
      .first<{ status: string }>();
    expect(day?.status).toBe('H');
    expect(await entries()).toEqual([]);
  });

  it('O-29.1 overtime nobody approved gives nothing', async () => {
    await fillMonth(priya.id, '2026-10', {
      script: {
        '2026-10-02': [
          ['in', '10:00'],
          ['out', '21:00'],
        ],
      },
    });
    await recompute('2026-10-02');
    expect(await entries()).toEqual([]);
  });

  it('O-29.1 a recompute keeps one active entry per day and kind and does not repeat itself', async () => {
    await example13();
    await recompute('2026-10-01');
    await recompute('2026-10-01');
    const all = await testEnv.DB.prepare(
      "SELECT status FROM credit_entries WHERE user_id = ?1 AND work_date = '2026-10-01' AND kind = 'late'",
    )
      .bind(priya.id)
      .all<{ status: string }>();
    expect(all.results).toEqual([{ status: 'active' }]);
  });

  it('O-29.8 with the setting off no entries are written and the old rules apply', async () => {
    const res = await call('PATCH', '/owner/settings', {
      cookie: owner,
      body: { settings: { timeCredits: { startDate: '2026-11-01' } } },
    });
    expect(res.status).toBe(200);
    await fillMonth(priya.id, '2026-10', {
      script: {
        '2026-10-02': [
          ['in', '10:30'],
          ['out', '20:00'],
        ],
      },
    });
    await recompute('2026-10-02');
    expect(await entries()).toEqual([]);
    const day = await testEnv.DB.prepare(
      "SELECT undertime_min FROM attendance_days WHERE user_id = ?1 AND work_date = '2026-10-02'",
    )
      .bind(priya.id)
      .first<{ undertime_min: number }>();
    expect(day?.undertime_min).toBeGreaterThan(0);
  });
});

describe('O-29.7 Credits screen, ledger and CSV, owner only', () => {
  it('O-29.7 the person ledger lists every row with a running balance and filters', async () => {
    await example13();
    const res = await callJson<CreditLedger>('GET', `/owner/credits/${priya.id}/ledger`, {
      cookie: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.balanceMin).toBe(50);
    expect(res.body.estimatePaise).toBe(4630);
    expect(res.body.items).toHaveLength(8);
    // Newest first; the running balance of the newest row is the balance.
    expect(res.body.items[0]).toMatchObject({ date: '2026-10-17', runningBalanceMin: 50 });
    const ot = res.body.items.find((r) => r.kind === 'ot');
    expect(ot?.minutes).toBe(120);
    const onlyOt = await callJson<CreditLedger>(
      'GET',
      `/owner/credits/${priya.id}/ledger?kind=ot`,
      { cookie: owner },
    );
    expect(onlyOt.body.items).toHaveLength(1);
    const range = await callJson<CreditLedger>(
      'GET',
      `/owner/credits/${priya.id}/ledger?from=2026-10-05&to=2026-10-08`,
      { cookie: owner },
    );
    expect(range.body.items.map((r) => r.date)).toEqual(['2026-10-08', '2026-10-07', '2026-10-05']);
  });

  it('O-29.7 the ledger CSV has a BOM, the stated columns and is audited as credits.export', async () => {
    await example13();
    const res = await callJson<{ exportId: string }>('POST', '/owner/exports', {
      cookie: stepUp,
      body: { kind: 'credits_ledger', month: '2026-10', format: 'csv' },
    });
    expect(res.status).toBe(202);
    let view: ExportView | undefined;
    await vi.waitFor(async () => {
      view = (
        await callJson<ExportView>('GET', `/owner/exports/${res.body.exportId}`, {
          cookie: stepUp,
        })
      ).body;
      expect(view.status).toBe('ready');
    });
    const file = await call('GET', `/owner/exports/${view?.id}/file`, { cookie: owner });
    const bytes = new Uint8Array(await file.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = (await file.text()).trim().split('\r\n');
    expect(lines[0]).toContain('Date,Staff,Kind,Minutes,Adjusted min,Balance after');
    expect(lines).toHaveLength(9);
    expect(lines.at(-1)).toContain('17-10-2026,Priya Solanki,Overtime,120,0,50');
    expect((await auditRows('credits.export')).length).toBe(1);
  });

  it('O-29.9 managers and staff get 403 on every credits route, and no credits export for managers', async () => {
    await example13();
    const meera = await addPerson(owner, { name: 'Meera Joshi' });
    const upsert = await call('PUT', '/owner/managers', {
      cookie: stepUp,
      body: {
        userId: meera.id,
        permissions: ['payroll', 'exports', 'approve_attendance'],
        staffIds: [],
      },
    });
    expect(upsert.status).toBe(200);
    const manager = await login(meera.id);
    const staff = await login(priya.id);
    const run = await startOctober();
    const probes: [string, string, unknown?][] = [
      ['GET', '/owner/credits'],
      ['GET', `/owner/credits/${priya.id}/ledger`],
      [
        'POST',
        `/owner/credits/${priya.id}/adjustments`,
        { workDate: '2026-10-03', kind: 'late', deltaMin: 10, reason: 'x' },
      ],
      ['GET', `/owner/payroll-runs/${run}/credits`],
      ['PUT', `/owner/payroll-runs/${run}/credits/${priya.id}`, { settleMin: 10 }],
    ];
    for (const [method, path, body] of probes) {
      for (const cookie of [manager, staff]) {
        const res = await call(method, path, { cookie, ...(body ? { body } : {}) });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    }
    const exp = await call('POST', '/owner/exports', {
      cookie: await stepUpLogin(meera.id),
      body: { kind: 'credits_ledger', month: '2026-10', format: 'csv' },
    });
    expect(exp.status).toBe(403);
  });
});

describe('O-29.10 an entry can be adjusted with a reason and the adjustment survives a recompute', () => {
  const adjust = (body: Record<string, unknown>) =>
    callJson<CreditAdjustment>('POST', `/owner/credits/${priya.id}/adjustments`, {
      cookie: owner,
      body,
    });

  it('O-29.10 adjusts a late by +10, keeps it across a recompute, changes it and voids it with history', async () => {
    await example13();
    const made = await adjust({
      workDate: '2026-10-03',
      kind: 'late',
      deltaMin: 10,
      reason: 'Excused by Urmi',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ deltaMin: 10, status: 'active', reason: 'Excused by Urmi' });
    expect((await overview()).staff[0]?.balanceMin).toBe(60);

    await recompute('2026-10-03');
    expect((await overview()).staff[0]?.balanceMin).toBe(60);

    const ledger = await callJson<CreditLedger>('GET', `/owner/credits/${priya.id}/ledger`, {
      cookie: owner,
    });
    const row = ledger.body.items.find((r) => r.date === '2026-10-03');
    expect(row).toMatchObject({ minutes: -10, adjustedMin: 10 });
    expect(row?.history.map((h) => h.kind)).toEqual(['original', 'adjustment']);
    expect(row?.history[1]?.reason).toBe('Excused by Urmi');

    const changed = await callJson<CreditAdjustment>(
      'PATCH',
      `/owner/credits/adjustments/${made.body.id}`,
      { cookie: owner, body: { deltaMin: 5, reason: 'Only 5 excused' } },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.deltaMin).toBe(5);
    expect((await overview()).staff[0]?.balanceMin).toBe(55);

    const voided = await callJson<CreditAdjustment>(
      'DELETE',
      `/owner/credits/adjustments/${changed.body.id}`,
      { cookie: owner, body: { reason: 'Entered by mistake' } },
    );
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('void');
    expect((await overview()).staff[0]?.balanceMin).toBe(50);
    const again = await call('DELETE', `/owner/credits/adjustments/${changed.body.id}`, {
      cookie: owner,
      body: { reason: 'again' },
    });
    expect(again.status).toBe(409);
    expect((await errorCode(again)).code).toBe('ALREADY_DECIDED');

    expect((await auditRows('credits.adjust')).length).toBe(2);
    const v = await auditRows('credits.adjust.void');
    expect(v).toHaveLength(1);
    expect(v[0]?.reason).toBe('Entered by mistake');
  });

  it('O-29.10 an adjustment needs a reason and a real day', async () => {
    expect(
      (await adjust({ workDate: '2026-10-03', kind: 'late', deltaMin: 10, reason: '' })).status,
    ).toBe(400);
    expect(
      (await adjust({ workDate: '2027-01-03', kind: 'late', deltaMin: 10, reason: 'future' }))
        .status,
    ).toBe(400);
    expect(
      (await adjust({ workDate: '2026-10-03', kind: 'late', deltaMin: 0, reason: 'zero' })).status,
    ).toBe(400);
  });
});

describe('O-29.4 the Settle credits step (PRD 4.19.3, 7.17.5)', () => {
  it('O-29.4 defaults to 0, suggests the full balance, and a plus settlement is an earning', async () => {
    await example13();
    const run = await startOctober();
    const view = await callJson<CreditsSettleView>('GET', `/owner/payroll-runs/${run}/credits`, {
      cookie: owner,
    });
    expect(view.body.rows).toEqual([
      expect.objectContaining({
        userId: priya.id,
        balanceMin: 50,
        suggestedMin: 50,
        settleMin: 0,
        appliedMin: 0,
        amountPaise: 0,
        stayMin: 50,
      }),
    ]);

    const before = await callJson<OwnerPayslipView>(
      'GET',
      `/owner/payroll-runs/${run}/people/${priya.id}`,
      { cookie: owner },
    );
    expect(before.body.result.lines.some((l) => l.code === 'time_credits')).toBe(false);
    // Credits replace the automatic overtime pay and lateness deduction (PRD 7.17.6).
    expect(before.body.result.lines.some((l) => l.code === 'overtime')).toBe(false);
    expect(before.body.result.lines.some((l) => l.code === 'undertime')).toBe(false);

    const set = await settle(run, 50);
    expect(set.status).toBe(200);
    expect(set.body.settlement).toMatchObject({
      balanceMin: 50,
      settleMin: 50,
      appliedMin: 50,
      amountPaise: 4480,
      status: 'draft',
    });
    const line = set.body.lines.find((l) => l.code === 'time_credits');
    expect(line).toMatchObject({ amountPaise: 4480, kind: 'earning' });

    const after = await callJson<OwnerPayslipView>(
      'GET',
      `/owner/payroll-runs/${run}/people/${priya.id}`,
      { cookie: owner },
    );
    expect(after.body.result.grossPaise).toBe(1_504_480);
    expect(after.body.result.netPaise).toBe(1_504_500);
    expect((await auditRows('credits.settle')).length).toBe(1);
  });

  it('O-29.4 accepts 0 up to the balance, edits until finalise and 0 removes it', async () => {
    await example13();
    const run = await startOctober();
    expect((await settle(run, 30)).body.settlement.appliedMin).toBe(30);
    expect((await settle(run, 20)).body.settlement.appliedMin).toBe(20);
    const cleared = await settle(run, 0);
    expect(cleared.status).toBe(200);
    expect(cleared.body.settlement).toMatchObject({ settleMin: 0, appliedMin: 0, status: 'void' });
    expect(cleared.body.lines.some((l) => l.code === 'time_credits')).toBe(false);
    const view = await callJson<CreditsSettleView>('GET', `/owner/payroll-runs/${run}/credits`, {
      cookie: owner,
    });
    expect(view.body.rows[0]?.settleMin).toBe(0);
  });

  it('O-29.4 refuses the wrong side and more than the balance with RULE_VIOLATION', async () => {
    await example13();
    const run = await startOctober();
    for (const bad of [-10, 51, 500]) {
      const res = await settle(run, bad);
      expect(res.status, String(bad)).toBe(422);
    }
    const res = await call('PUT', `/owner/payroll-runs/${run}/credits/${priya.id}`, {
      cookie: owner,
      body: { settleMin: -10 },
    });
    expect((await errorCode(res)).code).toBe('RULE_VIOLATION');
  });

  it('O-29.4 a cut is trimmed to the 50% cap and the rest stays on the balance', async () => {
    await example13();
    // A huge minus balance, to reach the cap: 9,000 minutes cost more than 50% of Rs 15,000.
    const big = await callJson<CreditAdjustment>('POST', `/owner/credits/${priya.id}/adjustments`, {
      cookie: owner,
      body: { workDate: '2026-10-03', kind: 'late', deltaMin: -9050, reason: 'test balance' },
    });
    expect(big.status).toBe(201);
    const run = await startOctober();
    const res = await settle(run, -9000);
    expect(res.status).toBe(200);
    const st = res.body.settlement;
    expect(st.balanceMin).toBe(-9000);
    expect(st.appliedMin).toBeGreaterThan(-9000);
    expect(st.appliedMin).toBeLessThan(0);
    expect(st.amountPaise).toBeGreaterThanOrEqual(-750_000);
    const view = await callJson<CreditsSettleView>('GET', `/owner/payroll-runs/${run}/credits`, {
      cookie: owner,
    });
    expect(view.body.rows[0]?.stayMin).toBe(-9000 - st.appliedMin);
    expect(res.body.warnings.some((w) => w.code === 'cap_carry')).toBe(true);
  });
});

describe('O-29.5 finalise applies the settlement, reopen voids it', () => {
  it('O-29.5 finalise freezes the line, reduces the balance and audits; reopen brings it back', async () => {
    await example13();
    const run = await startOctober();
    await settle(run, 50);

    const done = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${run}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    expect(done.status).toBe(200);
    expect(done.body.run.status).toBe('finalised');

    const o = await overview();
    expect(o.staff[0]).toMatchObject({
      balanceMin: 0,
      lastSettlement: { month: '2026-10', appliedMin: 50, amountPaise: 4480 },
    });
    const row = await testEnv.DB.prepare(
      'SELECT status, applied_min, amount_paise FROM credit_settlements WHERE payroll_run_id = ?1',
    )
      .bind(run)
      .first<{ status: string; applied_min: number; amount_paise: number }>();
    expect(row).toEqual({ status: 'applied', applied_min: 50, amount_paise: 4480 });
    const audit = await auditRows('credits.settle');
    expect(audit.some((a) => a.after_json?.includes('"status":"applied"'))).toBe(true);

    // The ledger shows the settlement as a row and the balance after it.
    const ledger = await callJson<CreditLedger>('GET', `/owner/credits/${priya.id}/ledger`, {
      cookie: owner,
    });
    expect(ledger.body.items[0]).toMatchObject({
      kind: 'settled',
      minutes: -50,
      runningBalanceMin: 0,
    });
    expect(ledger.body.balanceMin).toBe(0);

    // Edits are over: the month is locked.
    const late = await settle(run, 10);
    expect(late.status).toBe(409);
    expect(
      (
        await errorCode(
          await call('PUT', `/owner/payroll-runs/${run}/credits/${priya.id}`, {
            cookie: owner,
            body: { settleMin: 10 },
          }),
        )
      ).code,
    ).toBe('MONTH_LOCKED');

    const reopened = await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${run}/reopen`, {
      cookie: stepUp,
      body: { reason: 'Correct a day', settleMode: 'reissue' },
    });
    expect(reopened.status).toBe(200);
    expect((await overview()).staff[0]?.balanceMin).toBe(50);
    const next = reopened.body.run.id;
    const view = await callJson<CreditsSettleView>('GET', `/owner/payroll-runs/${next}/credits`, {
      cookie: owner,
    });
    expect(view.body.rows[0]).toMatchObject({ balanceMin: 50, settleMin: 50, appliedMin: 50 });
    const statuses = await testEnv.DB.prepare(
      'SELECT status FROM credit_settlements WHERE user_id = ?1 ORDER BY decided_at, id',
    )
      .bind(priya.id)
      .all<{ status: string }>();
    expect(statuses.results.map((r) => r.status).sort()).toEqual(['draft', 'void']);
  });
});

describe('O-29.3 the balance carries over between months', () => {
  it('O-29.3 a settlement of part of the balance leaves the rest for the next month', async () => {
    await example13();
    const run = await startOctober();
    await settle(run, 20);
    await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${run}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    expect((await overview()).staff[0]?.balanceMin).toBe(30);
    // A new month adds to it, no reset.
    await setClock(Date.UTC(2026, 10, 10, 5, 0));
    await addPunches(
      priya.id,
      '2026-11-04',
      [
        ['in', '10:20'],
        ['out', '20:00'],
      ],
      'accepted',
    );
    await recompute('2026-11-04');
    expect((await overview()).staff[0]?.balanceMin).toBe(10);
  });
});

describe('O-29.11 Time credits can only be switched with the owner PIN', () => {
  it('O-29.11 changing the enabled flag needs step-up; the start date does not', async () => {
    const plain = await call('PATCH', '/owner/settings', {
      cookie: owner,
      body: { settings: { timeCredits: { enabled: false } } },
    });
    expect(plain.status).toBe(403);
    expect((await errorCode(plain)).code).toBe('STEP_UP_REQUIRED');
    const ok = await call('PATCH', '/owner/settings', {
      cookie: stepUp,
      body: { settings: { timeCredits: { enabled: false } } },
    });
    expect(ok.status).toBe(200);
    const o = await overview();
    expect(o.enabled).toBe(false);
  });
});

describe('O-29.9 privacy: no staff route returns credits, balances or rupee values (PRD 7.17.9)', () => {
  const FORBIDDEN =
    /credits|time_credits|balanceMin|runningBalanceMin|estimatePaise|settleMin|appliedMin|deltaMin|credit_/i;

  it('O-29.9 every staff GET answers without a credit string, after a settlement exists', async () => {
    await example13();
    const run = await startOctober();
    await settle(run, 50);
    await callJson<PayrollRunView>('POST', `/owner/payroll-runs/${run}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const staff = await login(priya.id);
    const slips = await callJson<{ id: string }[]>('GET', '/me/payslips', { cookie: staff });
    const slipId = slips.body[0]?.id ?? '00000000000000000000000000';

    let checked = 0;
    for (const key of ENDPOINT_KEYS) {
      const def = endpoints[key] as EndpointShape;
      if (def.method !== 'GET' || def.binary || !def.access.includes('self')) continue;
      if (def.access.includes('owner') && def.access.length === 1) continue;
      const path = def.path.replace(/:([A-Za-z]+)/g, (_m, p: string) =>
        p === 'date' ? '2026-10-17' : p === 'id' ? slipId : '00000000000000000000000000',
      );
      const sep = path.includes('?') ? '&' : '?';
      const res = await call('GET', `${path}${sep}month=2026-10&date=2026-10-17`, {
        cookie: staff,
      });
      if (res.status !== 200) continue;
      const text = await res.text();
      expect(FORBIDDEN.test(text), `${key} leaks a credit string: ${text.slice(0, 200)}`).toBe(
        false,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(5);

    const slip = await callJson<PayslipView>('GET', `/me/payslips/${slipId}`, { cookie: staff });
    expect(slip.status).toBe(200);
    const adj = slip.body.result.lines.find((l) => l.amountPaise === 4480);
    expect(adj).toMatchObject({
      label: 'Time adjustment',
      kind: 'earning',
    });
    expect(adj?.formula).toMatch(/^settled by .+ for extra time worked in Oct/);
    expect(slip.body.result.lines.some((l) => l.code === 'time_credits')).toBe(false);
    expect(JSON.stringify(slip.body)).not.toMatch(/min\b.*credit|credits/i);
  });
});

describe('O-29.12 legal overtime at 2x (PRD 7.17.7, example 13: +170)', () => {
  it('O-29.12 example 13: the 120 legal minutes count twice, balance +170, settled at Rs 152.33', async () => {
    await enableCredits(stepUp, true);
    await example13();
    const rows = await entries();
    expect(rows.filter((r) => r.kind === 'ot')).toEqual([
      expect.objectContaining({ work_date: '2026-10-17', minutes: 120 }),
    ]);
    expect(rows.filter((r) => r.kind === 'ot_legal')).toEqual([
      expect.objectContaining({ work_date: '2026-10-17', minutes: 120 }),
    ]);
    expect((await overview()).staff[0]?.balanceMin).toBe(170);
    const ledger = await callJson<CreditLedger>('GET', `/owner/credits/${priya.id}/ledger`, {
      cookie: owner,
    });
    expect(ledger.body.items.some((r) => r.kind === 'ot_legal')).toBe(true);

    const run = await startOctober();
    const set = await settle(run, 170);
    expect(set.body.settlement).toMatchObject({
      balanceMin: 170,
      appliedMin: 170,
      amountPaise: 15233,
    });
    expect(set.body.warnings.some((w) => w.code === 'legal_ot_2x')).toBe(true);
  });

  it('O-29.12 the CSV and the ledger label the rows "Legal overtime 2x"', async () => {
    await enableCredits(stepUp, true);
    await example13();
    const res = await callJson<{ exportId: string }>('POST', '/owner/exports', {
      cookie: stepUp,
      body: { kind: 'credits_ledger', month: '2026-10', format: 'csv' },
    });
    await vi.waitFor(async () => {
      const v = await callJson<ExportView>('GET', `/owner/exports/${res.body.exportId}`, {
        cookie: stepUp,
      });
      expect(v.body.status).toBe('ready');
    });
    const file = await call('GET', `/owner/exports/${res.body.exportId}/file`, { cookie: owner });
    expect(await file.text()).toContain('Legal overtime 2x,120,0,170');
  });

  it('O-29.12 with the guardrail off the minutes count once and payroll warns of the shortfall', async () => {
    await example13();
    expect((await entries()).some((r) => r.kind === 'ot_legal')).toBe(false);
    expect((await overview()).staff[0]?.balanceMin).toBe(50);
    const run = await startOctober();
    const slip = await callJson<OwnerPayslipView>(
      'GET',
      `/owner/payroll-runs/${run}/people/${priya.id}`,
      { cookie: owner },
    );
    expect(slip.body.result.warnings.some((w) => w.code === 'legal_ot_shortfall')).toBe(true);
  });

  it('O-29.12 a later day of the week is refreshed when an earlier day is recomputed', async () => {
    await enableCredits(stepUp, true);
    // Mon, Wed, Thu, Fri, Sat at 9 h and Sunday 10:00-16:00 with 180 min of approved overtime.
    await fillMonth(priya.id, '2026-10', {
      script: {
        '2026-10-11': [
          ['in', '10:00'],
          ['out', '16:00'],
        ],
      },
    });
    await decideOvertime(priya.id, '2026-10-11', 180, 180);
    await recompute('2026-10-11');
    expect((await entries()).filter((r) => r.kind === 'ot_legal')).toEqual([]);
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
      await recompute(d);
    expect((await entries()).filter((r) => r.kind === 'ot_legal')).toEqual([
      expect.objectContaining({ work_date: '2026-10-11', minutes: 180 }),
    ]);
  });

  it('O-29.12 the guardrail switch needs step-up', async () => {
    const res = await call('PATCH', '/owner/settings', {
      cookie: owner,
      body: { settings: { timeCredits: { legalOt2x: false } } },
    });
    expect(res.status).toBe(403);
  });
});
