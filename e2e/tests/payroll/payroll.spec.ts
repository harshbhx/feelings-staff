/**
 * Payroll E2E-15 to E2E-18 (PRD 14.4), API-driven against the payroll-october seed with the server
 * clock on 2 Nov 2026 (October is over). The owner signs in with the seeded password and PIN, so
 * every call goes through the real session, step-up and idempotency code. Steps that need a staff
 * session or the WP-6 payroll screens are `test.fixme` with the reason; they follow once the staff
 * device sign-in has a test shortcut and the payroll screens (PR 35) are on main.
 */
import type {
  AdvanceView,
  ExportView,
  OwnerPayslipView,
  PayrollRunView,
  PayslipVerify,
  TestResetResult,
} from '@fs/contracts';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../../fixtures';

const BASE = '/api/v1';
const HEADERS = { 'X-FS-Client': '0.1.0', Origin: 'http://localhost:8787' };
const NOV_2 = Date.parse('2026-11-02T10:00:00+05:30');

let seed: TestResetResult;

async function signIn(request: APIRequestContext, stepUp = false) {
  const login = await request.post(`${BASE}/auth/owner/password`, {
    headers: HEADERS,
    data: { email: seed.owner.email, password: seed.owner.password, pin: seed.owner.pin },
  });
  expect(login.status(), await login.text()).toBe(200);
  if (stepUp) {
    const up = await request.post(`${BASE}/auth/step-up`, {
      headers: HEADERS,
      data: { pin: seed.owner.pin },
    });
    expect(up.status(), await up.text()).toBe(200);
  }
}

async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
  key?: string,
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${BASE}${path}`, {
    method,
    headers: { ...HEADERS, ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(data === undefined ? {} : { data }),
  });
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : undefined) as T };
}

const priya = () => seed.staff.find((s) => s.name === 'Priya Shah')?.id ?? '';

test.beforeEach(async ({ reset, setServerClock, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'owner-desktop', 'API-driven; runs once');
  seed = await reset('payroll-october');
  await setServerClock(NOV_2);
  await signIn(request, true);
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

async function currentRun(request: APIRequestContext): Promise<string> {
  const runs = await api<{ id: string; status: string }[]>(request, 'GET', '/owner/payroll-runs');
  const draft = runs.body.find((r) => r.status === 'draft');
  expect(draft, 'the seed leaves an October draft').toBeTruthy();
  return draft?.id ?? '';
}

test.describe('E2E-15 advance recorded, staff acknowledges', () => {
  test('E2E-15 the owner records an advance and the staff member can see it pending', async ({
    request,
  }) => {
    const made = await api<AdvanceView>(
      request,
      'POST',
      '/owner/advances',
      {
        userId: priya(),
        amountPaise: 200_000,
        givenOn: '2026-11-02',
        mode: 'upi',
        reason: 'Rent',
        plan: 'instalments',
        instalmentsN: 2,
        firstMonth: '2026-11',
        askStaffAck: true,
      },
      'e2e15-advance-1',
    );
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      status: 'active',
      staffAck: 'pending',
      balancePaise: 200_000,
    });
    const again = await api<AdvanceView>(
      request,
      'POST',
      '/owner/advances',
      undefined,
      'e2e15-advance-1',
    );
    expect(again.status).not.toBe(500);
    const list = await api<{ items: AdvanceView[] }>(
      request,
      'GET',
      `/owner/advances?userId=${priya()}`,
    );
    expect(list.body.items.map((a) => a.id)).toContain(made.body.id);
  });

  test.fixme('E2E-15 the staff member taps "That\'s right" on their phone', async () => {
    // Needs a staff session: the seed staff have a PIN but no approved device (no test sign-in shortcut yet).
  });
});

test.describe('E2E-16 October payroll end to end', () => {
  test('E2E-16 blockers, finalise anyway, example 11 to the paisa, share link, mark paid', async ({
    request,
  }) => {
    const id = await currentRun(request);
    const draft = await api<PayrollRunView>(request, 'GET', `/owner/payroll-runs/${id}`);
    expect(draft.body.blockers.map((b) => b.kind).sort()).toEqual([
      'flagged_punches',
      'leave_undecided',
      'overtime_undecided',
      'pending_punches',
      'regularisations_undecided',
    ]);

    const refused = await api<{ error: { code: string } }>(
      request,
      'POST',
      `/owner/payroll-runs/${id}/finalise`,
      { acceptDefaults: false },
      'e2e16-finalise-0',
    );
    expect(refused.status).toBe(422);

    const done = await api<PayrollRunView>(
      request,
      'POST',
      `/owner/payroll-runs/${id}/finalise`,
      { acceptDefaults: true },
      'e2e16-finalise-1',
    );
    expect(done.status).toBe(200);
    expect(done.body.run.status).toBe('finalised');
    const line = done.body.lines.find((l) => l.user.id === priya());
    expect(line).toMatchObject({
      grossPaise: 1_576_882,
      deductionsPaise: 378_137,
      netPaise: 1_198_700,
    });
    expect(['pending', 'ready', 'failed']).toContain(line?.pdfStatus);

    const slip = await api<OwnerPayslipView>(
      request,
      'GET',
      `/owner/payroll-runs/${id}/people/${priya()}`,
    );
    expect(slip.body.verifyUrl).toMatch(/\/v\//);
    expect(slip.body.waLink).toMatch(/^https:\/\/wa\.me\/91/);
    expect(slip.body.shareText).toContain('October salary slip');

    const paid = await api<OwnerPayslipView>(
      request,
      'POST',
      `/owner/payslips/${slip.body.id}/mark-paid`,
      { paidOn: '2026-11-02', mode: 'upi', ref: 'E2E-16' },
      'e2e16-paid-1',
    );
    expect(paid.body.paid).toMatchObject({ on: '2026-11-02', mode: 'upi' });
    const all = await api<PayrollRunView>(
      request,
      'POST',
      `/owner/payroll-runs/${id}/mark-all-paid`,
      { paidOn: '2026-11-02', mode: 'cash' },
      'e2e16-paid-all',
    );
    expect(all.body.totals.paidCount).toBe(3);
  });

  test.fixme('E2E-16 the payroll review screens show the same numbers and the staff member sees the payslip', async () => {
    // Needs the WP-6 payroll screens (PR 35) and a staff session.
  });
});

test.describe('E2E-17 reopen, revision 2, superseded payslip', () => {
  test('E2E-17 reopening keeps revision 1 as superseded and starts revision 2', async ({
    request,
  }) => {
    const id = await currentRun(request);
    await api(
      request,
      'POST',
      `/owner/payroll-runs/${id}/finalise`,
      { acceptDefaults: true },
      'e2e17-fin',
    );
    const slip = await api<OwnerPayslipView>(
      request,
      'GET',
      `/owner/payroll-runs/${id}/people/${priya()}`,
    );
    const token = slip.body.verifyUrl?.split('/v/')[1] ?? '';
    const reopened = await api<PayrollRunView>(
      request,
      'POST',
      `/owner/payroll-runs/${id}/reopen`,
      { reason: 'Add the Diwali bonus', settleMode: 'reissue' },
      'e2e17-reopen',
    );
    expect(reopened.body.run).toMatchObject({ revision: 2, status: 'draft' });
    const verify = await api<PayslipVerify>(request, 'GET', `/verify/payslip/${token}`);
    expect(verify.body).toMatchObject({
      valid: true,
      revision: 1,
      superseded: true,
      staffName: 'Priya S.',
    });
    const rev2 = reopened.body.run.id;
    await api(request, 'POST', `/owner/payroll-runs/${rev2}/adjustments`, {
      userId: priya(),
      kind: 'bonus',
      amountPaise: 100_000,
      note: 'Diwali bonus',
    });
    const done = await api<PayrollRunView>(
      request,
      'POST',
      `/owner/payroll-runs/${rev2}/finalise`,
      { acceptDefaults: true },
      'e2e17-fin2',
    );
    expect(done.body.lines.find((l) => l.user.id === priya())?.netPaise).toBeGreaterThan(1_198_700);
  });

  test.fixme('E2E-17 the superseded PDF carries the "Replaced by revision 2" watermark', async () => {
    // Needs Browser Run, which the local preview does not have; covered by the Workers test O-13.4.
  });
});

test.describe('E2E-18 exports', () => {
  test('E2E-18 the register CSV downloads with a BOM and parses', async ({ request }) => {
    const created = await api<{ exportId: string }>(request, 'POST', '/owner/exports', {
      kind: 'register',
      month: '2026-10',
      format: 'csv',
    });
    expect(created.status).toBe(202);
    await expect
      .poll(
        async () =>
          (await api<ExportView>(request, 'GET', `/owner/exports/${created.body.exportId}`)).body
            .status,
      )
      .toBe('ready');
    const file = await request.get(`${BASE}/owner/exports/${created.body.exportId}/file`, {
      headers: HEADERS,
    });
    expect(file.status()).toBe(200);
    const bytes = await file.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = bytes
      .toString('utf8')
      .slice(1)
      .trim()
      .split('\r\n')
      .map((l) => l.split(','));
    expect(rows[0]?.slice(0, 3)).toEqual(['Staff', 'Code', '01-10-2026']);
    expect(rows.map((r) => r[0])).toEqual(
      expect.arrayContaining(['Priya Shah', 'Meena Parmar', 'Kajal Solanki']),
    );
    expect(rows).toHaveLength(4);
  });

  test.fixme('E2E-18 the register PDF downloads and starts with %PDF', async () => {
    // Needs Browser Run (not in the local preview); the PDF path is covered with the fake renderer in O-15.1.
  });
});
