import { describe, expect, it } from 'vitest';
import { resetScenario, testEnv } from './helpers';

describe('demo scenario (preview seed)', () => {
  it('seeds about 12 staff with weeks of punches, leave and pending items', async () => {
    const s = await resetScenario('demo');
    expect(s.staff.length).toBe(12);
    const count = async (sql: string) =>
      ((await testEnv.DB.prepare(sql).first<{ n: number }>())?.n ?? 0) as number;
    expect(
      await count("SELECT COUNT(*) AS n FROM users WHERE role = 'staff' AND status = 'active'"),
    ).toBe(12);
    expect(await count('SELECT COUNT(*) AS n FROM punches')).toBeGreaterThan(400);
    expect(await count("SELECT COUNT(*) AS n FROM devices WHERE status = 'pending'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'")).toBe(
      2,
    );
    expect(await count("SELECT COUNT(*) AS n FROM regularisations WHERE status = 'pending'")).toBe(
      1,
    );
    expect(await count('SELECT COUNT(*) AS n FROM offsite_duties')).toBe(2);
  });
});
