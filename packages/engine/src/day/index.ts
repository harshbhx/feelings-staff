import type {
  DayOverride,
  DayResult,
  DaySchedule,
  LeaveOnDay,
  OtWindow,
  PunchForCalc,
  TimeRules,
} from '@fs/contracts';
import { EngineNotReady } from '../version';

export interface ComputeDayInput {
  schedule: DaySchedule;
  punches: PunchForCalc[];
  preapprovals: OtWindow[];
  leave: LeaveOnDay | null;
  rules: TimeRules;
  override: DayOverride | null;
}

/** Worked minutes, late/early, make-up, overtime candidates and status (PRD 7.4-7.7). Owner: WP-5. */
export function computeDay(_input: ComputeDayInput): DayResult {
  throw new EngineNotReady('computeDay');
}
