/**
 * E2E-23 Time credits (PRD 14.4, 7.15), against the real API on the payroll-october seed. The
 * seed has Time credits starting on 1 Nov, so the setup moves the start date to 1 Oct through
 * PATCH /owner/settings (as the demo seed does) and recomputes every October day. Numbers are
 * read from the API and compared with each other, not hard-coded, so a seed or rule tweak does not
 * break the flow. API-driven: the Credits screens have their own visual specs.
 */
import type {
  CreditLedger,
  CreditSettleResult,
  CreditsOverview,
  CreditsSettleView,
  ExportView,
  PayrollRunView,
} from '@fs/contracts';
import { expect, test } from '../../fixtures';
import { ist, ownerSession } from '../flows/helpers';

const NOV_2 = ist('2026-11-02', '10:00');

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'owner-desktop', 'API-driven; runs once');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

test.describe('E2E-23 Time credits (example 13)', () => {
  test('E2E-23 balances, ledger, CSV export, settle default 0 and suggestion, edit before finalise, reopen', async ({
    request,
    reset,
    setServerClock,
  }) => {
    test.setTimeout(180_000);
    const seed = await reset('payroll-october');
    await setServerClock(NOV_2);
    const owner = await ownerSession(request, seed.owner);
    const priya = seed.staff.find((s) => s.name === 'Priya Shah')?.id ?? '';
    expect(priya).not.toBe('');

    // Setup: credits count from 1 Oct, then every October day is derived again.
    await owner.ok('PATCH', '/owner/settings', {
      settings: { timeCredits: { startDate: '2026-10-01' } },
    });
    const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    for (const date of days) {
      await request.post('/api/v1/__test/cron', {
        data: { job: 'recompute-day', date },
        headers: {
          'X-E2E-Token': process.env.E2E_TOKEN ?? '',
          'X-FS-Client': '0.1.0',
          Origin: 'http://localhost:8787',
        },
      });
    }

    // Owner sees a balance per person, Priya's equals her ledger's.
    const overview = await owner.ok<CreditsOverview>('GET', '/owner/credits?asOf=2026-10-31');
    expect(overview.enabled).toBe(true);
    const row = overview.staff.find((r) => r.userId === priya);
    expect(row, 'Priya on the Credits overview').toBeTruthy();
    const ledger = await owner.ok<CreditLedger>(
      'GET',
      `/owner/credits/${priya}/ledger?to=2026-10-31`,
    );
    expect(ledger.items.length).toBeGreaterThan(0);
    expect(ledger.balanceMin).toBe(row?.balanceMin);

    // Export the ledger CSV (needs the step-up the session already has).
    const created = await owner.ok<{ exportId: string }>('POST', '/owner/exports', {
      kind: 'credits_ledger',
      month: '2026-10',
      format: 'csv',
    });
    await expect
      .poll(
        async () =>
          (await owner.ok<ExportView>('GET', `/owner/exports/${created.exportId}`)).status,
      )
      .toBe('ready');
    const file = await request.get(`/api/v1/owner/exports/${created.exportId}/file`, {
      headers: { 'X-FS-Client': '0.1.0' },
    });
    expect(file.status()).toBe(200);
    expect((await file.text()).length).toBeGreaterThan(20);

    // Settle step: the stepper starts at 0 and the suggestion is the full balance.
    const runs = await owner.ok<{ id: string; status: string }[]>('GET', '/owner/payroll-runs');
    const runId = runs.find((r) => r.status === 'draft')?.id ?? '';
    expect(runId).not.toBe('');
    const settle = await owner.ok<CreditsSettleView>('GET', `/owner/payroll-runs/${runId}/credits`);
    const mine = settle.rows.find((r) => r.userId === priya);
    expect(mine?.settleMin).toBe(0);
    expect(mine?.suggestedMin).toBe(mine?.balanceMin);

    // Save the suggestion, then change it before finalise.
    const full = mine?.suggestedMin ?? 0;
    if (full !== 0) {
      const saved = await owner.ok<CreditSettleResult>(
        'PUT',
        `/owner/payroll-runs/${runId}/credits/${priya}`,
        { settleMin: full },
      );
      expect(saved.settlement.settleMin).toBe(full);
      const less = Math.trunc(full / 2);
      const edited = await owner.ok<CreditSettleResult>(
        'PUT',
        `/owner/payroll-runs/${runId}/credits/${priya}`,
        { settleMin: less },
      );
      expect(edited.settlement.settleMin).toBe(less);
      const again = await owner.ok<CreditsSettleView>(
        'GET',
        `/owner/payroll-runs/${runId}/credits`,
      );
      expect(again.rows.find((r) => r.userId === priya)?.settleMin).toBe(less);

      // Finalise, then reopen: the choice comes back and the balance is as before.
      const done = await owner.ok<PayrollRunView>('POST', `/owner/payroll-runs/${runId}/finalise`, {
        acceptDefaults: true,
      });
      expect(done.run.status).toBe('finalised');
      const reopened = await owner.ok<PayrollRunView>(
        'POST',
        `/owner/payroll-runs/${runId}/reopen`,
        {
          reason: 'Check the credits again',
          settleMode: 'reissue',
        },
      );
      expect(reopened.run.status).toBe('draft');
      const back = await owner.ok<CreditsSettleView>(
        'GET',
        `/owner/payroll-runs/${reopened.run.id}/credits`,
      );
      expect(back.rows.find((r) => r.userId === priya)?.settleMin).toBe(less);
    }
  });
});
