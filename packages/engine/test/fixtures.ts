/** Shared builders for engine tests. Times are IST wall clock on a work date. */
import type {
  DayOverride,
  DaySchedule,
  LeaveOnDay,
  OrgCalendar,
  OtWindow,
  PersonPolicy,
  PunchForCalc,
  TemplateRule,
  TimeRules,
} from '@fs/contracts';
import { DEFAULT_ORG_SETTINGS, istToEpoch } from '@fs/contracts';
import { type ComputeDayInput, computeDay, timeRulesFromSettings } from '../src/day';
import { resolveSchedule } from '../src/schedule';

export const USER = '01J00000000000000000000001';
export const OWNER = '01J00000000000000000000002';

const tid = (n: number) => `01J0000000000000000000T${String(n).padStart(3, '0')}`;

export const TPL = {
  full: {
    id: tid(1),
    name: 'Full day',
    segments: [{ start: '10:00', end: '20:00' }],
    breakMin: 60,
  },
  sunday: { id: tid(2), name: 'Sunday', segments: [{ start: '10:00', end: '13:00' }], breakMin: 0 },
  morning: {
    id: tid(3),
    name: 'Morning',
    segments: [{ start: '10:00', end: '15:00' }],
    breakMin: 0,
  },
  split: {
    id: tid(5),
    name: 'Split',
    segments: [
      { start: '10:00', end: '14:00' },
      { start: '17:00', end: '21:00' },
    ],
    breakMin: 0,
  },
  night: { id: tid(6), name: 'Night', segments: [{ start: '22:00', end: '02:00' }], breakMin: 0 },
} satisfies Record<string, TemplateRule>;

/** Default rules (PRD 7.14): grace 10, tolerance 15, make-up on, 75/40, break after 300, OT 30/15. */
export const RULES: TimeRules = timeRulesFromSettings(DEFAULT_ORG_SETTINGS);

export const NO_CAL: OrgCalendar = { holidays: [], rosterOverrides: [] };

/** Priya: Full day, weekly off Tuesday, joined well before October 2026. */
export function person(over: Partial<PersonPolicy> = {}): PersonPolicy {
  return {
    userId: USER,
    joinDate: '2025-04-01',
    exitDate: null,
    weekOffDow: 2,
    defaultTemplate: TPL.full,
    ...over,
  };
}

/** Wednesday 7 Oct 2026 is an ordinary working day for Priya. */
export const WED = '2026-10-07';
/** Tuesday 20 Oct 2026 is Priya's weekly off. */
export const TUE = '2026-10-20';
/** Sunday 4 Oct 2026. */
export const SUN = '2026-10-04';

export function schedule(
  date = WED,
  template: TemplateRule = TPL.full,
  cal: OrgCalendar = NO_CAL,
  over: Partial<PersonPolicy> = {},
): DaySchedule {
  const p = person(over);
  const withTemplate: OrgCalendar =
    template === p.defaultTemplate
      ? cal
      : {
          ...cal,
          rosterOverrides: [...cal.rosterOverrides, { date, kind: 'template', template }],
        };
  return resolveSchedule(p, date, withTemplate);
}

let seq = 0;
/** Deterministic ULID-shaped id (digits only are valid Crockford base32). */
export const nextId = () => `01J${String(++seq).padStart(23, '0')}`;

export interface PunchOpts {
  status?: PunchForCalc['status'];
  source?: PunchForCalc['source'];
  duty?: string | null;
  /** Extra seconds after the minute (floored away by the engine). */
  sec?: number;
  /** Day offset for punches after midnight that belong to this work date. */
  dayOffset?: number;
  id?: string;
}

export function at(date: string, hhmm: string, dayOffset = 0): number {
  return istToEpoch(date, hhmm, dayOffset);
}

export function punch(
  date: string,
  kind: PunchForCalc['kind'],
  hhmm: string,
  o: PunchOpts = {},
): PunchForCalc {
  return {
    id: o.id ?? nextId(),
    kind,
    effectiveTs: at(date, hhmm, o.dayOffset ?? 0) + (o.sec ?? 0) * 1000,
    status: o.status ?? 'accepted',
    source: o.source ?? 'online',
    offsiteDutyId: o.duty ?? null,
  };
}

/** One in/out pair, or several: shift(WED, '10:00', '14:00', '15:00', '20:00'). */
export function shift(date: string, ...times: string[]): PunchForCalc[] {
  return times.map((t, i) => punch(date, i % 2 === 0 ? 'in' : 'out', t));
}

export function window(
  date: string,
  from: string,
  to: string,
  source: OtWindow['source'] = 'duty',
  toDayOffset = 0,
): OtWindow {
  return {
    startTs: at(date, from),
    endTs: at(date, to, toDayOffset),
    source,
    refId: '01J0000000000000000000W001',
  };
}

export const leave = (
  code: LeaveOnDay['code'],
  paid: boolean,
  half: LeaveOnDay['half'] = 'none',
): LeaveOnDay => ({ code, paid, half, requestId: null });

export const override = (o: Partial<DayOverride> = {}): DayOverride => ({
  reason: 'Was at the bridal booking',
  byUserId: OWNER,
  at: at(WED, '21:00'),
  ...o,
});

export function input(over: Partial<ComputeDayInput> = {}): ComputeDayInput {
  return {
    schedule: schedule(),
    punches: [],
    preapprovals: [],
    leave: null,
    rules: RULES,
    override: null,
    ...over,
  };
}

export const day = (over: Partial<ComputeDayInput> = {}) => computeDay(input(over));
