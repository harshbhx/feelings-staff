/** DayService: loads a person-day, calls computeDay, stores attendance_days (PRD 13.2). Owner: WP-4. */
import { fail } from '../lib/errors';
import type { DayService } from './ports';

export function createDayService(): DayService {
  return {
    async recompute() {
      return fail('NOT_IMPLEMENTED', 'Day recompute is not ready yet.');
    },
  };
}
