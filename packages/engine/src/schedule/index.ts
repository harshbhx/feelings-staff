import type { DaySchedule, OrgCalendar, PersonPolicy } from '@fs/contracts';
import { EngineNotReady } from '../version';

/** Schedule for a person-day (PRD 7.3). Owner: WP-5. */
export function resolveSchedule(
  _person: PersonPolicy,
  _date: string,
  _ctx: OrgCalendar,
): DaySchedule {
  throw new EngineNotReady('resolveSchedule');
}
