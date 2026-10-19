import { describe, expect, it } from 'vitest';
import headersFile from '../../public/_headers?raw';
import { SECURITY_HEADERS } from '../middleware/headers';

describe('public/_headers', () => {
  it('matches the Worker security headers exactly', () => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(headersFile, k).toContain(`  ${k}: ${v}\n`);
    }
  });
});
