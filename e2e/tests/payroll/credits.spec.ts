/**
 * E2E-23 Time credits, example 13 (PRD 14.4, 7.15), against the real API. It needs the credits API
 * (PR 50) and a seeded month with Time credits on from 1 Oct (Priya: seven 10:10 check-ins and the
 * 17 Oct overtime, approved), which no `TestScenario` has yet. The screens and their states are
 * covered on the fixtures in `e2e/tests/owner/credits.visual.spec.ts` meanwhile.
 */
import { test } from '../../fixtures';

test.describe('E2E-23 Time credits (example 13)', () => {
  test.fixme('E2E-23 the owner sees +170 on Credits, opens the ledger, exports the CSV; settles at payroll (default 0, suggestion = the full balance), edits the settlement before finalise, finalises and reopens', async () => {
    // 1. reset('credits-october') (to add with the seed), server clock 2 Nov 2026, owner signed in.
    // 2. /o/credits: Priya +170, "worth about ₹152".
    // 3. Priya's ledger: 7 x late -10, overtime +120, legal 2x +120; Export CSV asks for the PIN.
    // 4. October run -> Settle credits: Priya's stepper at 0, Suggested 170; save 170, then 100.
    // 5. Finalise (PIN): the payslip has "Time credits: +100 min"; Credits shows +70.
    // 6. Reopen (PIN, reason): the stepper comes back at 100; the balance is +170 again.
  });
});
