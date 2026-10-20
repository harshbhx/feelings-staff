/**
 * Cross-flow E2E (PRD 14.4): one real staff phone (the join screens, the check-in sheet) with the
 * owner driven through the API against the real session, step-up and idempotency code. Staff-side
 * requests that have no screen on main yet (leave, fix a day, payslips) go through the phone's own
 * session with `fetch`, so the same cookie, device and rules apply as in the app.
 *
 *   E2E-02  owner adds staff, staff joins, owner approves the phone
 *   E2E-04  check in inside the fence, the Today board shows her in (late)
 *   E2E-14  stays late, the owner approves part of the overtime
 *   E2E-16  payroll finalised, the staff member sees the payslip, owner marks it paid
 *   E2E-13  leave with an unpaid split, approved, shown in the register
 *   E2E-12  fix request for a missed day, approved, the day shows the times
 *
 * Staff-android only (Chromium with a staff session); the server clock is pinned per test.
 * Test-only changes to app source: none.
 */
import type {
  ActionsView,
  LeavePreview,
  LeaveRequestView,
  MyLeave,
  OwnerDayDetail,
  OwnerPayslipView,
  PayrollRunView,
  PayslipSummary,
  RegisterView,
  RegularisationView,
  TodayBoard,
} from '@fs/contracts';
import { expect, test } from '../../fixtures';
import { ist, onboardPhone, ownerSession, punch, staffApi } from './helpers';

const PIN = '4826';
/** A Monday in September 2026: no holiday, not a week-off for the new person (no week-off set). */
const WORK_DATE = '2026-09-28';
const PAYROLL_DAY = ist('2026-10-01', '11:00');

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'staff-android', 'Needs a staff phone with a session');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

test.describe('E2E-02 to E2E-16 a working day, then payroll', () => {
  test('E2E-04 E2E-14 E2E-16 join, check in late, stay late, overtime decision, payroll, payslip', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(240_000);
    const seeded = await reset('basic-salon');
    await setServerClock(ist(WORK_DATE, '10:25'));
    let owner = await ownerSession(request, seeded.owner);
    await setGeo('inside');

    // E2E-02: add, join, approve; the home opens.
    const me = await onboardPhone(page, owner, {
      name: 'Kavya Joshi',
      phone: '9824055601',
      pin: PIN,
      joinDate: '2026-09-01',
    });

    // E2E-04: check in 25 minutes after the shift starts; the board lists her as late.
    await punch(page, 'in', PIN);
    const board = await owner.ok<TodayBoard>('GET', '/owner/today');
    const row = board.in.find((r) => r.user.id === me.id);
    expect(row, 'the Today board shows her in').toBeTruthy();
    expect(row?.lateMin).toBeGreaterThan(0);
    expect(row?.place).toBe('inside');

    // E2E-14: she leaves 75 minutes after the shift ends. The engine first makes up her late minutes
    // (makeup), so the rest is the overtime candidate; the owner approves 30 of it.
    await setServerClock(ist(WORK_DATE, '21:15'));
    owner = await ownerSession(request, seeded.owner);
    await page.reload();
    await punch(page, 'out', PIN);
    const actions = await owner.ok<ActionsView>('GET', '/owner/actions?type=overtime');
    const ot = actions.items.find((i) => i.type === 'overtime' && i.user.id === me.id);
    const seen = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${WORK_DATE}`);
    expect(
      ot,
      `overtime waits in Needs action; day: ${JSON.stringify({ day: seen.day, schedule: seen.schedule, punches: seen.punches.map((p) => ({ k: p.kind, s: p.status, t: p.effectiveTs, src: p.source })) })}`,
    ).toBeTruthy();
    if (ot?.type !== 'overtime') throw new Error('not an overtime item');
    expect(ot.workDate).toBe(WORK_DATE);
    expect(ot.candidateMin).toBeGreaterThanOrEqual(30);
    const decided = await owner.ok<{ approvedMin: number; candidateMin: number }>(
      'POST',
      `/owner/overtime/${me.id}/${WORK_DATE}/decide`,
      { approvedMin: 30 },
    );
    expect(decided.approvedMin).toBe(30);
    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${WORK_DATE}`);
    expect(day.punches.map((p) => p.kind)).toEqual(['in', 'out']);

    // E2E-16: the month is over; the owner finalises; the staff member sees the payslip.
    await setServerClock(PAYROLL_DAY);
    owner = await ownerSession(request, seeded.owner);
    const run = await owner.ok<PayrollRunView>('POST', '/owner/payroll-runs', { month: '2026-09' });
    const done = await owner.ok<PayrollRunView>(
      'POST',
      `/owner/payroll-runs/${run.run.id}/finalise`,
      { acceptDefaults: true },
    );
    expect(done.run.status).toBe('finalised');
    const line = done.lines.find((l) => l.user.id === me.id);
    expect(line, 'she has a line in the run').toBeTruthy();

    const staff = staffApi(page);
    const slips = await staff<PayslipSummary[]>('GET', '/me/payslips');
    expect(slips.status).toBe(200);
    const mine = slips.body.find((s) => s.month === '2026-09');
    expect(mine, 'the payslip is visible to her').toBeTruthy();
    expect(mine?.superseded).toBe(false);
    expect(mine?.netPaise).toBe(line?.netPaise);
    expect(mine?.paidOn).toBeNull();

    const slip = await owner.ok<OwnerPayslipView>(
      'GET',
      `/owner/payroll-runs/${run.run.id}/people/${me.id}`,
    );
    await owner.ok('POST', `/owner/payslips/${slip.id}/mark-paid`, {
      paidOn: '2026-10-01',
      mode: 'upi',
      ref: 'E2E-16 cross-flow',
    });
    const after = await staff<PayslipSummary[]>('GET', '/me/payslips');
    expect(after.body.find((s) => s.month === '2026-09')?.paidOn).toBe('2026-10-01');
  });
});

test.describe('E2E-13 leave request to register', () => {
  test('E2E-13 the staff member asks, accepts the unpaid split, the owner approves, the register shows it', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(150_000);
    const seeded = await reset('basic-salon');
    await setServerClock(ist(WORK_DATE, '10:05'));
    const owner = await ownerSession(request, seeded.owner);
    await setGeo('inside');
    const me = await onboardPhone(page, owner, {
      name: 'Meera Dave',
      phone: '9824055602',
      pin: PIN,
      joinDate: '2026-09-01',
    });
    const staff = staffApi(page);

    // Casual leave opens 90 days after joining (the server says so), so she asks for unpaid leave.
    const ask = {
      typeCode: 'LOP',
      fromDate: '2026-09-30',
      toDate: '2026-09-30',
      half: 'none',
      reason: 'Family function',
      acceptUnpaidSplit: true,
    };
    const preview = await staff<LeavePreview>('POST', '/leave-requests/preview', ask);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.daysUnpaid).toBeGreaterThan(0);

    const created = await staff<LeaveRequestView>('POST', '/leave-requests', ask);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe('pending');

    const queue = await owner.ok<ActionsView>('GET', '/owner/actions?type=leave_request');
    expect(
      queue.items.some((i) => i.type === 'leave_request' && i.request.id === created.body.id),
    ).toBe(true);
    const decided = await owner.ok<LeaveRequestView>(
      'POST',
      `/owner/leave-requests/${created.body.id}/decide`,
      { decision: 'approve', note: 'Enjoy' },
    );
    expect(decided.status).toBe('approved');

    const mine = await staff<MyLeave>('GET', '/me/leave');
    expect(mine.body.requests.find((r) => r.id === created.body.id)?.status).toBe('approved');

    const register = await owner.ok<RegisterView>(
      'GET',
      `/owner/register?month=2026-09&userId=${me.id}`,
    );
    const col = register.dates.indexOf('2026-09-30');
    const cell = register.rows.find((r) => r.user.id === me.id)?.cells[col];
    expect(cell?.leaveCode, 'the register marks the leave day').toBeTruthy();
  });
});

test.describe('E2E-12 fix a missed day', () => {
  test('E2E-12 a missed check-out is fixed by request, the owner approves, the day shows both times', async ({
    page,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(150_000);
    const seeded = await reset('basic-salon');
    await setServerClock(ist(WORK_DATE, '10:05'));
    const owner = await ownerSession(request, seeded.owner);
    await setGeo('inside');
    const me = await onboardPhone(page, owner, {
      name: 'Nisha Rao',
      phone: '9824055603',
      pin: PIN,
      joinDate: '2026-09-01',
    });
    const staff = staffApi(page);
    const fixDate = '2026-09-25';

    // She checks in on the 25th and forgets to check out; three days later she asks for a fix.
    await setServerClock(ist(fixDate, '10:05'));
    await page.reload();
    await punch(page, 'in', PIN);
    await setServerClock(ist(WORK_DATE, '10:05'));
    const outTs = ist(fixDate, '19:30');

    const created = await staff<RegularisationView>('POST', '/regularisations', {
      workDate: fixDate,
      kind: 'missed_out',
      proposedOutTs: outTs,
      reason: 'Forgot my phone at home',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe('pending');

    const queue = await owner.ok<ActionsView>('GET', '/owner/actions?type=regularisation');
    expect(
      queue.items.some((i) => i.type === 'regularisation' && i.request.id === created.body.id),
    ).toBe(true);
    const decided = await owner.ok<RegularisationView>(
      'POST',
      `/owner/regularisations/${created.body.id}/decide`,
      { decision: 'approve' },
    );
    expect(decided.status).toBe('approved');

    const day = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${fixDate}`);
    const counted = day.punches.filter((p) => p.status !== 'rejected' && p.status !== 'superseded');
    expect(counted.map((p) => p.kind)).toEqual(['in', 'out']);
    expect(counted.at(-1)?.effectiveTs).toBe(outTs);
    const mine = await staff<{ items: RegularisationView[] } | RegularisationView[]>(
      'GET',
      '/me/regularisations',
    );
    expect(JSON.stringify(mine.body)).toContain('approved');
  });
});
