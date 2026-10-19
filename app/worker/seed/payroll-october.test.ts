/** The payroll-october scenario: an October draft with blockers and adjustments, example 11 to the paisa. */
import type { Endpoints, OutputOf, PayrollRunView } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../routes/auth/test/kit';
import { login, monthIsOver, stepUpLogin } from '../routes/payroll/test/kit';
import { call, callJson, resetScenario, type Scenario } from '../test/helpers';

let s: Scenario;

beforeEach(async () => {
  s = await resetScenario('payroll-october');
});

afterEach(async () => {
  await setClock(null);
});

describe('payroll-october seed (O-13.2, O-13.6)', () => {
  it('O-13.2 leaves an October draft with blockers and adjustments', async () => {
    const owner = await login(s.ownerId);
    const runs = await callJson<{ id: string; month: string; status: string; people: number }[]>(
      'GET',
      '/owner/payroll-runs',
      { cookie: owner },
    );
    expect(runs.body).toHaveLength(1);
    expect(runs.body[0]).toMatchObject({ month: '2026-10', status: 'draft', people: 3 });
    const view = await callJson<PayrollRunView>('GET', `/owner/payroll-runs/${runs.body[0]?.id}`, {
      cookie: owner,
    });
    expect(view.body.blockers.map((b) => b.kind).sort()).toEqual([
      'flagged_punches',
      'leave_undecided',
      'overtime_undecided',
      'pending_punches',
      'regularisations_undecided',
    ]);
    expect(view.body.lines).toHaveLength(3);
  });

  it('O-13.6 Priya in the seeded draft is example 11, and it finalises once October is over', async () => {
    const owner = await login(s.ownerId);
    const priya = s.staff.find((p) => p.name === 'Priya Shah');
    const runs = await callJson<{ id: string }[]>('GET', '/owner/payroll-runs', { cookie: owner });
    const id = runs.body[0]?.id;
    const slip = await callJson<OutputOf<Endpoints['ownerPayslipPreview']>>(
      'GET',
      `/owner/payroll-runs/${id}/people/${priya?.id}`,
      { cookie: owner },
    );
    expect(slip.body.result).toMatchObject({ grossPaise: 1_576_882, netPaise: 1_198_700 });
    await monthIsOver();
    const done = await call('POST', `/owner/payroll-runs/${id}/finalise`, {
      cookie: await stepUpLogin(s.ownerId),
      body: { acceptDefaults: true },
    });
    expect(done.status).toBe(200);
  });
});
