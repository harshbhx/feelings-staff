import type {
  AwayInterval,
  ConfirmedAway,
  PresenceCheck,
  PresenceRules,
  RollCallMark,
  StepOut,
  TemplateRule,
} from '@fs/contracts';
import { AwayInterval as AwaySchema, MINUTE_MS, minToHhmm } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { creditEntriesForDay } from '../src/credits';
import { computeDay } from '../src/day';
import { awayMinutes, type BuildAwayInput, buildAwayIntervals } from '../src/presence';
import {
  at,
  input as dayInput,
  leave,
  OWNER,
  punch,
  schedule,
  shift,
  RULES as TIME_RULES,
  TPL,
  TUE,
  USER,
  WED,
} from './fixtures';

const PRESENCE: PresenceRules = { enabled: true, minAwayMin: 5 };
const id = (k: string, n: number) => `01J0000000000000000000${k}${String(n).padStart(3, '0')}`;

const mark = (n: number, hhmm: string, value: RollCallMark['mark'] = 'not_here'): RollCallMark => ({
  rollCallId: id('R', n),
  userId: USER,
  slotTs: at(WED, hhmm),
  mark: value,
  markedBy: OWNER,
});

const stepOut = (
  n: number,
  from: string,
  to: string | null,
  over: Partial<StepOut> = {},
): StepOut => ({
  id: id('S', n),
  startTs: at(WED, from),
  endTs: to === null ? null : at(WED, to),
  reason: 'personal',
  state: 'open',
  backMissing: false,
  ...over,
});

const check = (hhmm: string, result: PresenceCheck['result']): PresenceCheck => ({
  ts: at(WED, hhmm),
  result,
});

const build = (over: Partial<BuildAwayInput> = {}) =>
  buildAwayIntervals({
    rollCalls: [],
    stepOuts: [],
    checks: [],
    punches: shift(WED, '10:00', '20:00'),
    schedule: schedule(),
    breakWindow: null,
    leave: null,
    rules: PRESENCE,
    ...over,
  });

/** "HH:MM" IST of an instant. */
const hm = (ts: number) => minToHhmm((Math.floor(ts / MINUTE_MS) + 330) % 1440);

const brief = (i: AwayInterval) => ({
  from: hm(i.startTs),
  to: i.endTs === null ? null : hm(i.endTs),
  minutes: i.minutes,
  source: i.source,
  state: i.state,
  endReason: i.endReason,
  backMissing: i.backMissing,
});

const briefs = (over: Partial<BuildAwayInput> = {}) => {
  const r = build(over);
  for (const i of r.intervals) expect(() => AwaySchema.parse(i)).not.toThrow();
  return r.intervals.map(brief);
};

describe('PRD 14.2 presence: roll-call intervals', () => {
  it('Not here starts at the slot time and ends at I am back; confirmed at once (example 15)', () => {
    const r = build({ rollCalls: [mark(1, '18:00')], backs: [at(WED, '18:40')] });
    expect(r.intervals.map(brief)).toEqual([
      {
        from: '18:00',
        to: '18:40',
        minutes: 40,
        source: 'roll_call',
        state: 'confirmed',
        endReason: 'back',
        backMissing: false,
      },
    ]);
    expect(r.intervals[0]).toMatchObject({
      reason: null,
      rollCallIds: [id('R', 1)],
      stepOutIds: [],
    });
  });

  it('a later Not here continues the open interval; a later Here ends it', () => {
    const r = build({
      rollCalls: [mark(3, '18:00', 'here'), mark(2, '15:00'), mark(1, '12:00')],
      backs: [at(WED, '11:00')],
    });
    expect(r.intervals.map(brief)).toEqual([
      expect.objectContaining({
        from: '12:00',
        to: '18:00',
        minutes: 360,
        endReason: 'roll_call_here',
      }),
    ]);
    expect(r.intervals[0]?.rollCallIds).toEqual([id('R', 1), id('R', 2)]);
  });

  it('Not here while still open before now continues it; after I am back a new one starts', () => {
    const open = build({
      rollCalls: [mark(1, '12:00'), mark(2, '15:00')],
      nowTs: at(WED, '16:00'),
      punches: [punch(WED, 'in', '10:00')],
    });
    expect(open.intervals.map(brief)).toEqual([
      {
        from: '12:00',
        to: null,
        minutes: 0,
        source: 'roll_call',
        state: 'confirmed',
        endReason: null,
        backMissing: false,
      },
    ]);
    expect(open.intervals[0]?.rollCallIds).toHaveLength(2);
    const two = build({
      rollCalls: [mark(1, '12:00'), mark(2, '15:00')],
      backs: [at(WED, '12:30'), at(WED, '15:20')],
    });
    expect(two.intervals.map((i) => [hm(i.startTs), i.minutes])).toEqual([
      ['12:00', 30],
      ['15:00', 20],
    ]);
  });

  it('ends at check-out, at auto-close, or at the end of the shift segment', () => {
    expect(
      briefs({ rollCalls: [mark(1, '15:00')], punches: shift(WED, '10:00', '17:30') }),
    ).toEqual([expect.objectContaining({ to: '17:30', minutes: 150, endReason: 'check_out' })]);
    const auto = [punch(WED, 'in', '10:00'), punch(WED, 'out', '20:00', { source: 'auto' })];
    expect(briefs({ rollCalls: [mark(1, '19:00')], punches: auto })).toEqual([
      expect.objectContaining({ to: '20:00', minutes: 60, endReason: 'auto_close' }),
    ]);
    const split = schedule(WED, TPL.split);
    expect(
      briefs({
        rollCalls: [mark(1, '13:00')],
        schedule: split,
        punches: shift(WED, '10:00', '21:00'),
      }),
    ).toEqual([expect.objectContaining({ to: '14:00', minutes: 60, endReason: 'shift_end' })]);
  });
});

describe('PRD 14.2 presence: step-outs', () => {
  it('closed with I am back: pending until the owner decides, reason kept (example 15, work errand)', () => {
    const r = build({ stepOuts: [stepOut(1, '16:05', '16:30', { reason: 'errand' })] });
    expect(r.intervals.map(brief)).toEqual([
      {
        from: '16:05',
        to: '16:30',
        minutes: 25,
        source: 'step_out',
        state: 'pending',
        endReason: 'back',
        backMissing: false,
      },
    ]);
    expect(r.intervals[0]).toMatchObject({ reason: 'errand', stepOutIds: [id('S', 1)] });
  });

  it.each(['confirmed', 'work', 'ignored', 'pending'] as const)(
    'the owner decision %s is kept on a recompute',
    (state) => {
      expect(briefs({ stepOuts: [stepOut(1, '16:00', '16:30', { state })] })[0]?.state).toBe(state);
    },
  );

  it('with no I am back it closes at the next Here or at check-out, flagged back missing', () => {
    expect(
      briefs({ stepOuts: [stepOut(1, '15:30', null)], rollCalls: [mark(1, '18:00', 'here')] }),
    ).toEqual([
      expect.objectContaining({
        to: '18:00',
        endReason: 'roll_call_here',
        backMissing: true,
        state: 'pending',
      }),
    ]);
    expect(
      briefs({ stepOuts: [stepOut(1, '18:30', null)], punches: shift(WED, '10:00', '19:00') }),
    ).toEqual([
      expect.objectContaining({ to: '19:00', endReason: 'check_out', backMissing: true }),
    ]);
  });

  it('still out before now: open, 0 minutes', () => {
    expect(
      briefs({
        stepOuts: [stepOut(1, '16:00', null)],
        nowTs: at(WED, '16:10'),
        punches: [punch(WED, 'in', '10:00')],
      }),
    ).toEqual([
      {
        from: '16:00',
        to: null,
        minutes: 0,
        source: 'step_out',
        state: 'open',
        endReason: null,
        backMissing: false,
      },
    ]);
  });

  it('a stored end with back missing keeps what closed it; one matching nothing was the owner', () => {
    const r = briefs({
      rollCalls: [mark(1, '18:00', 'here')],
      stepOuts: [
        stepOut(1, '15:30', '18:00', { backMissing: true, state: 'pending' }),
        stepOut(2, '12:00', '12:45', { backMissing: true, state: 'pending' }),
      ],
    });
    expect(r.map((i) => [i.from, i.endReason])).toEqual([
      ['12:00', 'owner_edit'],
      ['15:30', 'roll_call_here'],
    ]);
    const early = briefs({
      stepOuts: [stepOut(1, '15:30', '15:50', { backMissing: true })],
      nowTs: at(WED, '15:40'),
    });
    expect(early[0]?.endReason).toBe('owner_edit');
  });
});

describe('PRD 14.2 presence: merge, clip and drop', () => {
  it('overlapping roll-call and step-out merge into one mixed, confirmed interval', () => {
    const r = build({
      stepOuts: [stepOut(1, '14:40', '16:00', { reason: 'lunch', state: 'pending' })],
      rollCalls: [mark(1, '15:00'), mark(2, '18:00', 'here')],
    });
    expect(r.intervals.map(brief)).toEqual([
      {
        from: '14:40',
        to: '18:00',
        minutes: 200,
        source: 'mixed',
        state: 'confirmed',
        endReason: 'roll_call_here',
        backMissing: false,
      },
    ]);
    expect(r.intervals[0]).toMatchObject({
      reason: 'lunch',
      rollCallIds: [id('R', 1)],
      stepOutIds: [id('S', 1)],
    });
    const inside = build({
      rollCalls: [mark(1, '15:00'), mark(2, '18:00', 'here')],
      stepOuts: [stepOut(1, '16:00', '16:30', { reason: 'other' })],
    });
    expect(inside.intervals.map(brief)).toEqual([
      expect.objectContaining({ from: '15:00', to: '18:00', source: 'mixed', state: 'confirmed' }),
    ]);
    expect(inside.intervals[0]?.reason).toBe('other');
  });

  it('two overlapping step-outs: the stronger decision wins; touching ones stay apart', () => {
    const r = briefs({
      stepOuts: [
        stepOut(1, '14:00', '14:30', { state: 'ignored' }),
        stepOut(2, '14:20', '14:50', { state: 'work' }),
        stepOut(3, '14:50', '15:05', { state: 'ignored' }),
      ],
    });
    expect(r.map((i) => [i.from, i.to, i.state])).toEqual([
      ['14:00', '14:50', 'work'],
      ['14:50', '15:05', 'ignored'],
    ]);
  });

  it('a merge with an open part stays open', () => {
    const now = { nowTs: at(WED, '15:00'), punches: [punch(WED, 'in', '10:00')] };
    const laterOpen = briefs({
      ...now,
      stepOuts: [stepOut(1, '14:00', '14:30'), stepOut(2, '14:20', null)],
    });
    const firstOpen = briefs({
      ...now,
      stepOuts: [stepOut(1, '14:00', null), stepOut(2, '14:20', '14:30')],
    });
    for (const r of [laterOpen, firstOpen]) {
      expect(r).toEqual([
        expect.objectContaining({ from: '14:00', to: null, state: 'open', minutes: 0 }),
      ]);
    }
  });

  it('minutes are clipped to presence, the shift segments and the break window', () => {
    const brk = { startTs: at(WED, '14:00'), endTs: at(WED, '15:00') };
    const r = briefs({
      punches: shift(WED, '09:30', '20:00'),
      breakWindow: brk,
      stepOuts: [stepOut(1, '09:40', '10:30'), stepOut(2, '13:30', '15:30')],
    });
    expect(r.map((i) => i.minutes)).toEqual([30, 60]);
  });

  it('after the last segment the interval has no length and is dropped; under 5 minutes is dropped', () => {
    expect(
      briefs({ stepOuts: [stepOut(1, '20:30', null)], punches: [punch(WED, 'in', '10:00')] }),
    ).toEqual([]);
    expect(briefs({ stepOuts: [stepOut(1, '16:00', '16:04')] })).toEqual([]);
    expect(briefs({ stepOuts: [stepOut(1, '16:00', '16:05')] })[0]?.minutes).toBe(5);
  });
});

describe('PRD 14.2 presence: skip rules', () => {
  const skips: Array<{ name: string; over: Partial<BuildAwayInput> }> = [
    { name: 'presence off', over: { rules: { enabled: false, minAwayMin: 5 } } },
    { name: 'a weekly off', over: { schedule: schedule(TUE) } },
    { name: 'full-day leave', over: { leave: leave('CL', true) } },
    { name: 'not checked in', over: { punches: [] } },
  ];
  it.each(skips)('$name: no intervals and no hints', ({ over }) => {
    expect(
      build({ rollCalls: [mark(1, '15:00')], checks: [check('16:00', 'outside')], ...over }),
    ).toEqual({ intervals: [], hints: [] });
  });

  it('a half-day leave still records the worked half', () => {
    expect(
      briefs({
        rollCalls: [mark(1, '15:00')],
        backs: [at(WED, '15:30')],
        leave: leave('CL', true, 'first'),
      }),
    ).toHaveLength(1);
  });

  it('an interval on an H day is shown but makes no credits (minus only on P days)', () => {
    const punches = shift(WED, '10:00', '15:00');
    const r = build({ punches, rollCalls: [mark(1, '12:00')], backs: [at(WED, '13:00')] });
    const day = computeDay(dayInput({ punches, rules: { ...TIME_RULES, credits: true } }));
    expect(day.status).toBe('H');
    const counted = toConfirmed(r.intervals);
    expect(counted.map((a) => a.minutes)).toEqual([60]);
    const credit = {
      enabled: true,
      otApprovedMin: 0,
      lateSourceId: null,
      earlySourceId: null,
      otSourceId: null,
    };
    expect(creditEntriesForDay(day, counted, credit)).toEqual([]);
  });
});

/** What the API stores as counted away time: confirmed intervals only (never work or ignored). */
function toConfirmed(intervals: AwayInterval[]): ConfirmedAway[] {
  return intervals
    .filter((i) => i.state === 'confirmed' && i.endTs !== null)
    .map((i, n) => ({
      id: id('Y', n + 1),
      workDate: WED,
      startTs: i.startTs,
      endTs: i.endTs ?? i.startTs,
      minutes: i.minutes,
      confirmedBy: OWNER,
    }));
}

describe('PRD 14.2 presence: decisions and edits', () => {
  it('confirm makes a minus entry; work and ignore make none', () => {
    const credit = {
      enabled: true,
      otApprovedMin: 0,
      lateSourceId: null,
      earlySourceId: null,
      otSourceId: null,
    };
    const day = computeDay(
      dayInput({ punches: shift(WED, '10:00', '20:00'), rules: { ...TIME_RULES, credits: true } }),
    );
    for (const [state, minutes] of [
      ['confirmed', [-25]],
      ['work', []],
      ['ignored', []],
    ] as const) {
      const r = build({ stepOuts: [stepOut(1, '16:05', '16:30', { state })] });
      const entries = creditEntriesForDay(day, toConfirmed(r.intervals), credit);
      expect(entries.map((e) => e.minutes)).toEqual(minutes);
    }
  });

  it('edits and punch changes recompute the minutes and the entry follows', () => {
    const ctx = { punches: shift(WED, '10:00', '20:00'), schedule: schedule(), breakWindow: null };
    const iv = { startTs: at(WED, '18:00'), endTs: at(WED, '18:40') };
    expect(awayMinutes(iv, ctx)).toBe(40);
    expect(awayMinutes({ ...iv, endTs: at(WED, '18:30') }, ctx)).toBe(30);
    expect(awayMinutes(iv, { ...ctx, punches: shift(WED, '10:00', '18:20') })).toBe(20);
    expect(awayMinutes({ ...iv, endTs: null }, ctx)).toBe(0);
  });
});

describe('PRD 14.2 presence: foreground hints', () => {
  it('an outside check raises a hint but never an interval or credits', () => {
    const r = build({
      checks: [check('15:30', 'outside'), check('15:00', 'outside')],
      punches: [punch(WED, 'in', '10:00')],
    });
    expect(r).toEqual({
      intervals: [],
      hints: [{ sinceTs: at(WED, '15:00'), lastCheckTs: at(WED, '15:30') }],
    });
  });

  it.each([
    {
      name: 'an inside check clears it',
      checks: [check('15:00', 'outside'), check('15:30', 'inside')],
    },
    {
      name: 'an edge check (uncertain) clears it',
      checks: [check('15:00', 'outside'), check('15:30', 'edge')],
    },
  ])('$name', ({ checks }) => {
    expect(build({ checks, punches: [punch(WED, 'in', '10:00')] }).hints).toEqual([]);
  });

  it('no fix is ignored; checks in the break window or after the shift do not count; check-out clears', () => {
    const brk = { startTs: at(WED, '14:00'), endTs: at(WED, '15:00') };
    expect(
      build({
        breakWindow: brk,
        checks: [check('14:30', 'outside'), check('20:30', 'outside'), check('16:00', 'no_fix')],
        punches: [punch(WED, 'in', '10:00')],
      }).hints,
    ).toEqual([]);
    expect(
      build({ checks: [check('16:00', 'outside')], punches: shift(WED, '10:00', '17:00') }).hints,
    ).toEqual([]);
    expect(
      build({
        checks: [check('16:00', 'outside'), check('16:10', 'no_fix')],
        punches: [punch(WED, 'in', '10:00')],
      }).hints,
    ).toEqual([{ sinceTs: at(WED, '16:00'), lastCheckTs: at(WED, '16:00') }]);
  });
});

describe('PRD 7.15 example 15, presence part', () => {
  const EVENING: TemplateRule = {
    id: '01J0000000000000000000T007',
    name: 'Evening',
    segments: [{ start: '15:00', end: '20:00' }],
    breakMin: 0,
  };
  it('roll-call at 18:00, back at 18:40 on the Evening shift: 40 counted minutes', () => {
    const r = build({
      schedule: schedule(WED, EVENING),
      punches: shift(WED, '15:00', '20:00'),
      rollCalls: [mark(1, '18:00')],
      backs: [at(WED, '18:40')],
    });
    expect(r.intervals.map((i) => [i.minutes, i.state])).toEqual([[40, 'confirmed']]);
  });
});
