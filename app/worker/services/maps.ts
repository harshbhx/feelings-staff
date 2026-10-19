/** Google Maps link resolver: Google hosts only, max 3 redirects (PRD 4.6). Owner: WP-4. */
import { fail } from '../lib/errors';
import type { MapsResolver } from './ports';

export function createMapsResolver(): MapsResolver {
  return {
    async resolve() {
      return fail('NOT_IMPLEMENTED', 'Map links are not ready yet.');
    },
  };
}
