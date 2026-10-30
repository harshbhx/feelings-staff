import { ApiError } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { chunkDays, newRun, runDemo } from './demo-run';

const guard = <T>(call: () => Promise<T>) => call();

function fakeApi(opts: { sessionKept?: boolean; failRecomputeOnce?: string } = {}) {
  const calls: string[] = [];
  let failed = false;
  return {
    calls,
    api: {
      async ownerDemoSeed({ body }: { body: { mode: string } }) {
        calls.push(`seed:${body.mode}`);
        return {
          staff: 12,
          from: '2026-10-01',
          to: '2026-10-07',
          sessionKept: opts.sessionKept ?? true,
        };
      },
      async ownerDemoRecompute({ body }: { body: { from: string; to: string } }) {
        if (opts.failRecomputeOnce === body.from && !failed) {
          failed = true;
          throw new ApiError({ code: 'INTERNAL', status: 500, message: 'boom' });
        }
        calls.push(`recompute:${body.from}..${body.to}`);
        return { from: body.from, to: body.to, days: 1, people: 12 };
      },
      async ownerDemoFinish({ body }: { body: { from: string } }) {
        calls.push(`finish:${body.from}`);
        return {
          creditsStart: body.from,
          overtimeApproved: 1,
          payrollMonth: null,
          payrollPaid: true,
        };
      },
    },
  };
}

describe('chunkDays', () => {
  it('covers the range in chunks of at most three days', () => {
    expect(chunkDays('2026-10-01', '2026-10-07')).toEqual([
      { from: '2026-10-01', to: '2026-10-03' },
      { from: '2026-10-04', to: '2026-10-06' },
      { from: '2026-10-07', to: '2026-10-07' },
    ]);
    expect(chunkDays('2026-10-01', '2026-10-01')).toEqual([
      { from: '2026-10-01', to: '2026-10-01' },
    ]);
  });
});

describe('runDemo', () => {
  it('seeds, recomputes every chunk in order, then finishes', async () => {
    const { api, calls } = fakeApi();
    const seen: string[] = [];
    const out = await runDemo(api as never, newRun('load'), guard, (p) => seen.push(p.step));
    expect(out).toBe('done');
    expect(calls).toEqual([
      'seed:load',
      'recompute:2026-10-01..2026-10-03',
      'recompute:2026-10-04..2026-10-06',
      'recompute:2026-10-07..2026-10-07',
      'finish:2026-10-01',
    ]);
    expect(seen[0]).toBe('seed');
    expect(seen.at(-1)).toBe('finish');
  });

  it('resumes at the failed chunk without seeding again', async () => {
    const { api, calls } = fakeApi({ failRecomputeOnce: '2026-10-04' });
    const run = newRun('reset');
    await expect(runDemo(api as never, run, guard, () => {})).rejects.toBeInstanceOf(ApiError);
    expect(calls).toEqual(['seed:reset', 'recompute:2026-10-01..2026-10-03']);
    await runDemo(api as never, run, guard, () => {});
    expect(calls).toEqual([
      'seed:reset',
      'recompute:2026-10-01..2026-10-03',
      'recompute:2026-10-04..2026-10-06',
      'recompute:2026-10-07..2026-10-07',
      'finish:2026-10-01',
    ]);
  });

  it('stops with signed-out when the session was not carried over', async () => {
    const { api, calls } = fakeApi({ sessionKept: false });
    expect(await runDemo(api as never, newRun('load'), guard, () => {})).toBe('signed-out');
    expect(calls).toEqual(['seed:load']);
  });
});
