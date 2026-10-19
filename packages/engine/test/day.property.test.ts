import type { PunchForCalc, TemplateRule, TimeRules } from '@fs/contracts';
import { DayResult as DayResultSchema, minToHhmm } from '@fs/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ComputeDayInput, computeDay } from '../src/day';
import { resolveSchedule } from '../src/schedule';
import { at, leave, override, person, TPL, WED } from './fixtures';

const DATES = ['2026-10-04', '2026-10-06', WED, '2026-10-20', '2026-10-31'];
const hhmm = fc.integer({ min: 0, max: 1439 }).map(minToHhmm);

const template: fc.Arbitrary<TemplateRule> = fc.oneof(
  ...Object.values(TPL).map((t) => fc.constant<TemplateRule>(t)),
  fc
    .record({ start: hhmm, end: hhmm, breakMin: fc.integer({ min: 0, max: 120 }) })
    .map(({ start, end, breakMin }) => ({
      id: '01J0000000000000000000T099',
      name: 'Random',
      segments: [{ start, end }],
      breakMin,
    })),
);

const rules: fc.Arbitrary<TimeRules> = fc.record({
  graceMin: fc.integer({ min: 0, max: 30 }),
  earlyToleranceMin: fc.integer({ min: 0, max: 60 }),
  makeupEnabled: fc.boolean(),
  presentPct: fc.integer({ min: 41, max: 100 }),
  halfPct: fc.integer({ min: 1, max: 40 }),
  breakAfterMin: fc.integer({ min: 180, max: 480 }),
  breakPunches: fc.boolean(),
  otThresholdMin: fc.integer({ min: 0, max: 60 }),
  otBlockMin: fc.constantFrom(15, 30, 60),
});

/** A punch at any minute from 04:00 on the date to 06:00 the next day, with any kind and status. */
const punchArb = (date: string): fc.Arbitrary<PunchForCalc> =>
  fc
    .record({
      n: fc.integer({ min: 1, max: 999 }),
      offset: fc.integer({ min: 240, max: 1440 + 360 }),
      sec: fc.integer({ min: 0, max: 59 }),
      kind: fc.constantFrom('in', 'out', 'in', 'out', 'break_start', 'break_end'),
      status: fc.constantFrom(
        'accepted',
        'accepted',
        'flagged',
        'pending',
        'rejected',
        'superseded',
      ),
      source: fc.constantFrom('online', 'offline', 'owner', 'auto'),
    })
    .map(({ n, offset, sec, kind, status, source }) => ({
      id: `01J${String(n).padStart(23, '0')}`,
      kind,
      effectiveTs: at(date, '00:00') + offset * 60_000 + sec * 1000,
      status,
      source,
      offsiteDutyId: null,
    }));

const dayInput: fc.Arbitrary<ComputeDayInput> = fc
  .record({
    date: fc.constantFrom(...DATES),
    template,
    weekOffDow: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
    rules,
  })
  .chain(({ date, template: t, weekOffDow, rules: r }) =>
    fc.record({
      schedule: fc.constant(
        resolveSchedule(person({ defaultTemplate: t, weekOffDow }), date, {
          holidays: [],
          rosterOverrides: [],
        }),
      ),
      punches: fc.array(punchArb(date), { maxLength: 10 }),
      preapprovals: fc.array(
        fc
          .tuple(fc.integer({ min: 240, max: 1800 }), fc.integer({ min: 0, max: 600 }))
          .map(([start, len]) => ({
            startTs: at(date, '00:00') + start * 60_000,
            endTs: at(date, '00:00') + (start + len) * 60_000,
            source: 'duty' as const,
            refId: '01J0000000000000000000W001',
          })),
        { maxLength: 2 },
      ),
      leave: fc.option(
        fc.constantFrom(leave('CL', true), leave('LOP', false), leave('SL', true, 'first')),
        { nil: null },
      ),
      rules: fc.constant(r),
      override: fc.option(fc.constantFrom(override(), override({ status: 'P' })), { nil: null }),
    }),
  );

const MINUTE_FIELDS = [
  'workedMin',
  'breakMin',
  'lateMin',
  'lateBillableMin',
  'earlyMin',
  'earlyBillableMin',
  'overbreakMin',
  'makeupMin',
  'undertimeMin',
  'otPreapprovedMin',
  'otCandidateMin',
  'offdayOtMin',
  'scheduledMin',
] as const;

describe('computeDay properties (PRD 14.2)', () => {
  it('day minutes are never negative and the result fits the contract', () => {
    fc.assert(
      fc.property(dayInput, (inp) => {
        const r = computeDay(inp);
        for (const f of MINUTE_FIELDS) expect(r[f]).toBeGreaterThanOrEqual(0);
        expect(r.lateBillableMin).toBeLessThanOrEqual(r.lateMin);
        expect(r.earlyBillableMin).toBeLessThanOrEqual(r.earlyMin);
        expect(r.undertimeMin + r.makeupMin).toBeLessThanOrEqual(
          r.lateBillableMin + r.earlyBillableMin + r.overbreakMin,
        );
        expect(r.otCandidateMin % inp.rules.otBlockMin).toBe(0);
        expect(r.otPreapprovedMin % inp.rules.otBlockMin).toBe(0);
        if (r.status !== 'P') expect(r.undertimeMin).toBe(0);
        DayResultSchema.parse(r);
      }),
      { numRuns: 500 },
    );
  });

  it('computeDay is idempotent and independent of punch order', () => {
    fc.assert(
      fc.property(dayInput, (inp) => {
        const first = computeDay(inp);
        expect(computeDay(structuredClone(inp))).toEqual(first);
        expect(computeDay({ ...inp, punches: [...inp.punches].reverse() })).toEqual(first);
      }),
      { numRuns: 300 },
    );
  });
});
