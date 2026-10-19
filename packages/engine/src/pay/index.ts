import type {
  Adjustment,
  AdvanceSchedule,
  CarryForward,
  DayResult,
  Fine,
  OtDecision,
  PayRules,
  PayslipResult,
  PersonPay,
} from '@fs/contracts';
import { EngineNotReady } from '../version';

export interface ComputePayslipInput {
  person: PersonPay;
  month: string;
  days: DayResult[];
  approvals: OtDecision[];
  advances: AdvanceSchedule[];
  adjustments: Adjustment[];
  fines: Fine[];
  rules: PayRules;
  carryIn: CarryForward;
}

/** Monthly payslip with every line, formula, cap and carry (PRD 7.10, 7.13). Owner: WP-5. */
export function computePayslip(_input: ComputePayslipInput): PayslipResult {
  throw new EngineNotReady('computePayslip');
}
