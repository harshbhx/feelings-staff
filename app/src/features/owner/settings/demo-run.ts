/**
 * Demo data, client side (preview only). The server splits the work so no request is long: `seed`
 * (wipe and write the raw data), `recompute` (a few days per call, about 10 s a day on remote D1)
 * and `finish` (credits start date, old overtime, last month's payroll). This module plans the
 * steps and drives them; it keeps its place in a `DemoRun`, so a failed step can be repeated
 * without redoing the finished ones.
 */
import { type ApiClient, addDays } from '@fs/contracts';

/** Days per recompute call. The server accepts four; three leaves room on a slow database. */
export const CHUNK_DAYS = 3;

export type DemoMode = 'load' | 'reset';

export interface DemoRun {
  mode: DemoMode;
  /** Set once the seed step has succeeded. */
  seeded?: { from: string; to: string; chunks: { from: string; to: string }[]; next: number };
  finished: boolean;
}

export type DemoStepName = 'seed' | 'recompute' | 'finish';

export interface DemoProgress {
  step: DemoStepName;
  done: number;
  total: number;
}

export type DemoOutcome = 'done' | 'signed-out';

export const newRun = (mode: DemoMode): DemoRun => ({ mode, finished: false });

/** Split an inclusive day range into chunks of `size` days. */
export function chunkDays(from: string, to: string, size = CHUNK_DAYS) {
  const out: { from: string; to: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, size)) {
    const end = addDays(d, size - 1);
    out.push({ from: d, to: end < to ? end : to });
  }
  return out;
}

/** Steps in all: the seed, every chunk, the finish. */
export const totalSteps = (run: DemoRun): number => (run.seeded ? run.seeded.chunks.length : 0) + 2;

type DemoApi = Pick<ApiClient, 'ownerDemoSeed' | 'ownerDemoRecompute' | 'ownerDemoFinish'>;
/** Wraps one call so an expired step-up asks for the PIN and repeats it. */
type Guarded = <T>(call: () => Promise<T>) => Promise<T>;

/**
 * Run (or resume) the steps. A thrown error leaves `run` where it stopped; call again to retry.
 * Resolves `signed-out` when the seed could not carry the owner's session over.
 */
export async function runDemo(
  api: DemoApi,
  run: DemoRun,
  guard: Guarded,
  onProgress: (p: DemoProgress) => void,
): Promise<DemoOutcome> {
  if (!run.seeded) {
    onProgress({ step: 'seed', done: 0, total: 2 });
    const r = await guard(() => api.ownerDemoSeed({ body: { mode: run.mode } }));
    run.seeded = { from: r.from, to: r.to, chunks: chunkDays(r.from, r.to), next: 0 };
    if (!r.sessionKept) return 'signed-out';
  }
  const seeded = run.seeded;
  const total = totalSteps(run);
  while (seeded.next < seeded.chunks.length) {
    const chunk = seeded.chunks[seeded.next];
    if (!chunk) break;
    onProgress({ step: 'recompute', done: 1 + seeded.next, total });
    await guard(() => api.ownerDemoRecompute({ body: chunk }));
    seeded.next += 1;
  }
  if (!run.finished) {
    onProgress({ step: 'finish', done: total - 1, total });
    await guard(() => api.ownerDemoFinish({ body: { from: seeded.from } }));
    run.finished = true;
  }
  onProgress({ step: 'finish', done: total, total });
  return 'done';
}
