/** PayrollService: draft, recompute, finalise (PRD 4.13). Owner: WP-5. */
import { fail } from '../lib/errors';
import type { PayrollService } from './ports';

export function createPayrollService(): PayrollService {
  const notReady = () => fail('NOT_IMPLEMENTED', 'Payroll is not ready yet.');
  return { draft: notReady, recompute: notReady, finalise: notReady };
}
