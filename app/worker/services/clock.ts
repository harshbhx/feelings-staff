/** Request clock (WP-1). In preview/local a test clock set by POST /__test/clock flows from its set point. */
import { SystemDb } from '../db';
import type { Env } from '../env';
import { isNonProd } from '../env';
import type { Clock } from './ports';

export const TEST_CLOCK_KEY = 'test_clock';

interface StoredClock {
  nowMs: number;
  setAt: number;
}

export async function createClock(env: Env): Promise<Clock> {
  if (!isNonProd(env)) return { now: () => Date.now(), fake: false };
  let stored: StoredClock | null = null;
  try {
    const row = await new SystemDb(env.DB).first<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = ?1',
      TEST_CLOCK_KEY,
    );
    stored = row ? (JSON.parse(row.value) as StoredClock) : null;
  } catch {
    stored = null; // schema not applied yet
  }
  if (!stored) return { now: () => Date.now(), fake: false };
  const { nowMs, setAt } = stored;
  return { now: () => nowMs + (Date.now() - setAt), fake: true };
}
