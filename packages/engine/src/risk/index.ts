import type { RiskInput, RiskResult } from '@fs/contracts';
import { EngineNotReady } from '../version';

/** Risk score, reasons and outcome (PRD 4.4.3-4.4.4). Owner: WP-4. */
export function riskScore(_input: RiskInput): RiskResult {
  throw new EngineNotReady('riskScore');
}
