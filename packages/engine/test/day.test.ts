import type { DayResult } from '@fs/contracts';
import { DayResult as DayResultSchema, DEFAULT_ORG_SETTINGS } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { type ComputeDayInput, computeDay, timeRulesFromSettings } from '../src/day';
import { ENGINE_VERSION } from '../src/version';
import {
  at,
  input,
  leave,
  override,
  punch,
  RULES,
  SUN,
  schedule,
  shift,
  TPL,
  TUE,
  WED,
  window,
} from './fixtures';

interface Row {
  name: string;
  in: Partial<ComputeDayInput>;
  expect: Partial<DayResult>;
}

const BREAKS = { ...RULES, breakPunches: true };
const NO_MAKEUP = { ...RULES, makeupEnabled: false };
const workOnTue = schedule(TUE);
const sunday = schedule(SUN, TPL.sunday);
const split = schedule(WED, TPL.split);

function run(rows: Row[]) {
  it.each(rows)('$name', (row) => {
    const r = computeDay(input(row.in));
    expect(r).toMatchObject(row.expect);
    expect(() => DayResultSchema.parse(r)).not.toThrow();
  });
}

describe('worked and breaks (PRD 7.4, 14.2)', () => {
  run([
    {
      name: 'break plateau: 300 min present, nothing taken off',
      in: { punches: shift(WED, '10:00', '15:00') },
      expect: { workedMin: 300, breakMin: 0, status: 'H' },
    },
    {
      name: 'break plateau: 330 min present, 30 taken off',
      in: { punches: shift(WED, '10:00', '15:30') },
      expect: { workedMin: 300, breakMin: 30, status: 'H' },
    },
    {
      name: 'break plateau: 360 min present, 60 taken off',
      in: { punches: shift(WED, '10:00', '16:00') },
      expect: { workedMin: 300, breakMin: 60 },
    },
    {
      name: 'break not reached',
      in: { punches: shift(WED, '10:00', '14:00') },
      expect: { workedMin: 240, breakMin: 0, status: 'H' },
    },
    {
      name: 'break punches on with an actual break',
      in: {
        rules: BREAKS,
        punches: [
          ...shift(WED, '10:00', '20:00'),
          punch(WED, 'break_start', '14:00'),
          punch(WED, 'break_end', '14:45'),
        ],
      },
      expect: { workedMin: 555, breakMin: 45, overbreakMin: 0, status: 'P', tags: [] },
    },
    {
      name: 'break punches on, no break punched: automatic rule and the note',
      in: { rules: BREAKS, punches: shift(WED, '10:00', '20:00') },
      expect: { workedMin: 540, breakMin: 60, tags: ['break_not_punched'] },
    },
    {
      name: 'break punches on, short day: no break and no note',
      in: { rules: BREAKS, punches: shift(WED, '10:00', '14:00') },
      expect: { workedMin: 240, breakMin: 0, tags: ['early'] },
    },
    {
      name: 'overbreak counts as undertime',
      in: {
        rules: BREAKS,
        punches: [
          ...shift(WED, '10:00', '20:00'),
          punch(WED, 'break_start', '14:00'),
          punch(WED, 'break_end', '15:30'),
        ],
      },
      expect: { workedMin: 510, breakMin: 90, overbreakMin: 30, undertimeMin: 30, status: 'P' },
    },
    {
      name: 'an out during a break ends the break',
      in: {
        rules: BREAKS,
        punches: [...shift(WED, '10:00', '20:00'), punch(WED, 'break_start', '19:00')],
      },
      expect: { workedMin: 540, breakMin: 60, earlyMin: 60, earlyBillableMin: 60 },
    },
    {
      name: 'stray break punches are ignored (before check-in, double start, end without start)',
      in: {
        rules: BREAKS,
        punches: [
          punch(WED, 'break_start', '09:00'),
          punch(WED, 'break_end', '09:30'),
          ...shift(WED, '10:00', '20:00'),
          punch(WED, 'break_end', '12:00'),
          punch(WED, 'break_start', '14:00'),
          punch(WED, 'break_start', '14:10'),
          punch(WED, 'break_end', '14:30'),
        ],
      },
      expect: { workedMin: 570, breakMin: 30, overbreakMin: 0 },
    },
    {
      name: 'break punches are ignored when the setting is off',
      in: {
        punches: [
          ...shift(WED, '10:00', '20:00'),
          punch(WED, 'break_start', '14:00'),
          punch(WED, 'break_end', '16:00'),
        ],
      },
      expect: { workedMin: 540, breakMin: 60, overbreakMin: 0 },
    },
    {
      name: 'presence outside the segments is excluded from raw_in',
      in: { punches: shift(WED, '08:00', '20:00') },
      expect: { workedMin: 540, breakMin: 60, lateMin: 0, otCandidateMin: 0, status: 'P' },
    },
    {
      name: 'two separate in/out pairs',
      in: { punches: shift(WED, '10:00', '14:00', '15:00', '20:00') },
      expect: {
        workedMin: 480,
        breakMin: 60,
        lateMin: 0,
        earlyMin: 0,
        status: 'P',
        firstInTs: at(WED, '10:00'),
        lastOutTs: at(WED, '20:00'),
      },
    },
  ]);
});

describe('late and early (PRD 7.5, 14.2)', () => {
  run([
    {
      name: 'late exactly at grace bills 0',
      in: { punches: shift(WED, '10:10', '20:00') },
      expect: { lateMin: 10, lateBillableMin: 0, undertimeMin: 0, tags: [] },
    },
    {
      name: 'late at grace + 1 bills 1',
      in: { punches: shift(WED, '10:11', '20:00') },
      expect: { lateMin: 11, lateBillableMin: 1, undertimeMin: 1, tags: ['late'] },
    },
    {
      name: 'example 2, 7 Oct: in 10:25 bills 15',
      in: { punches: shift(WED, '10:25', '20:00') },
      expect: { lateMin: 25, lateBillableMin: 15, undertimeMin: 15, status: 'P' },
    },
    {
      name: 'example 2, 8 Oct: in 10:12 bills 2',
      in: { punches: shift(WED, '10:12', '20:00') },
      expect: { lateBillableMin: 2, undertimeMin: 2 },
    },
    {
      name: 'example 2, 9 Oct: early 10 is within tolerance',
      in: { punches: shift(WED, '10:00', '19:50') },
      expect: { earlyMin: 10, earlyBillableMin: 0, undertimeMin: 0, tags: [] },
    },
    {
      name: 'early exactly at tolerance bills 0',
      in: { punches: shift(WED, '10:00', '19:45') },
      expect: { earlyMin: 15, earlyBillableMin: 0 },
    },
    {
      name: 'early at tolerance + 1 bills all 16',
      in: { punches: shift(WED, '10:00', '19:44') },
      expect: { earlyMin: 16, earlyBillableMin: 16, undertimeMin: 16, tags: ['early'] },
    },
    {
      name: 'example 2, 13 Oct: early 20 bills 20',
      in: { punches: shift(WED, '10:00', '19:40') },
      expect: { earlyBillableMin: 20, undertimeMin: 20 },
    },
    {
      name: 'split shift: late in segment 2 only',
      in: { schedule: split, punches: shift(WED, '10:00', '14:00', '17:20', '21:00') },
      expect: { lateMin: 20, lateBillableMin: 10, earlyMin: 0, workedMin: 460, status: 'P' },
    },
    {
      name: 'split shift: a missed segment has no late or early',
      in: { schedule: split, punches: shift(WED, '10:00', '14:00') },
      expect: { lateMin: 0, earlyMin: 0, workedMin: 240, status: 'H', undertimeMin: 0 },
    },
    {
      name: 'arrival before the start is not late',
      in: { punches: shift(WED, '09:30', '20:00') },
      expect: { lateMin: 0, lateBillableMin: 0, otCandidateMin: 0, otPreapprovedMin: 0 },
    },
    {
      name: 'seconds are floored: 10:10:59 counts as 10:10',
      in: { punches: [punch(WED, 'in', '10:10', { sec: 59 }), punch(WED, 'out', '20:00')] },
      expect: { lateMin: 10, lateBillableMin: 0, firstInTs: at(WED, '10:10') },
    },
    {
      name: 'example 6: Sunday 10:15-13:00 bills 5 of a 180-minute day',
      in: { schedule: sunday, punches: shift(SUN, '10:15', '13:00') },
      expect: { scheduledMin: 180, lateBillableMin: 5, undertimeMin: 5, status: 'P' },
    },
  ]);
});

describe('make-up and overtime (PRD 7.5-7.6, 14.2)', () => {
  run([
    {
      name: 'example 5: make-up covers all, the rest reaches the threshold',
      in: { punches: shift(WED, '10:20', '20:40') },
      expect: { lateBillableMin: 10, makeupMin: 10, undertimeMin: 0, otCandidateMin: 30 },
    },
    {
      name: 'example 5: make-up covers all, the rest is below the threshold',
      in: { punches: shift(WED, '10:20', '20:25') },
      expect: { makeupMin: 10, undertimeMin: 0, otCandidateMin: 0, tags: ['late'] },
    },
    {
      name: 'example 5: partial make-up leaves 20 undertime',
      in: { punches: shift(WED, '10:40', '20:10') },
      expect: { lateBillableMin: 30, makeupMin: 10, undertimeMin: 20, otCandidateMin: 0 },
    },
    {
      name: 'make-up off: late stays undertime and all after-minutes are candidates',
      in: { rules: NO_MAKEUP, punches: shift(WED, '10:20', '20:40') },
      expect: { makeupMin: 0, undertimeMin: 10, otCandidateMin: 30 },
    },
    {
      name: 'overtime below the threshold (29)',
      in: { punches: shift(WED, '10:00', '20:29') },
      expect: { otCandidateMin: 0, tags: [] },
    },
    {
      name: 'overtime exactly at the threshold (30)',
      in: { punches: shift(WED, '10:00', '20:30') },
      expect: { otCandidateMin: 30, tags: ['ot'] },
    },
    {
      name: 'block rounding down: 44 -> 30',
      in: { punches: shift(WED, '10:00', '20:44') },
      expect: { otCandidateMin: 30 },
    },
    {
      name: 'block rounding: 45 -> 45',
      in: { punches: shift(WED, '10:00', '20:45') },
      expect: { otCandidateMin: 45 },
    },
    {
      name: 'example 4: 09:55-22:10, before ignored, 130 after -> 120',
      in: { punches: shift(WED, '09:55', '22:10') },
      expect: { workedMin: 540, otCandidateMin: 120, otPreapprovedMin: 0, status: 'P' },
    },
    {
      name: 'example 6: Sunday out 13:50 -> 45 minutes',
      in: { schedule: sunday, punches: shift(SUN, '10:00', '13:50') },
      expect: { otCandidateMin: 45, undertimeMin: 0 },
    },
    {
      name: 'before the start inside a duty window is pre-approved',
      in: { punches: shift(WED, '08:30', '20:00'), preapprovals: [window(WED, '08:00', '10:00')] },
      expect: { otPreapprovedMin: 90, otCandidateMin: 0, tags: ['ot'] },
    },
    {
      name: 'pre-approved minutes need no threshold',
      in: {
        punches: shift(WED, '10:00', '20:20'),
        preapprovals: [window(WED, '20:00', '21:00', 'preapproval')],
      },
      expect: { otPreapprovedMin: 15, otCandidateMin: 0 },
    },
    {
      name: 'make-up takes pre-approved minutes when the after-minutes run out',
      in: {
        punches: shift(WED, '10:30', '21:00'),
        preapprovals: [window(WED, '20:00', '21:00', 'preapproval')],
      },
      expect: { lateBillableMin: 20, makeupMin: 20, undertimeMin: 0, otPreapprovedMin: 30 },
    },
    {
      name: 'duty after midnight: the whole window belongs to the start date',
      in: {
        punches: [punch(WED, 'in', '10:00'), punch(WED, 'out', '01:30', { dayOffset: 1 })],
        preapprovals: [window(WED, '20:00', '02:00', 'duty', 1)],
      },
      expect: {
        otPreapprovedMin: 330,
        otCandidateMin: 0,
        lastOutTs: at(WED, '01:30', 1),
        tags: ['ot', 'night_hours'],
      },
    },
    {
      name: 'split shift: presence in the gap counts only inside a window',
      in: {
        schedule: split,
        punches: shift(WED, '10:00', '21:00'),
        preapprovals: [window(WED, '15:00', '16:00', 'preapproval')],
      },
      expect: { workedMin: 480, otPreapprovedMin: 60, otCandidateMin: 0 },
    },
  ]);
});

describe('status (PRD 7.7, 14.2)', () => {
  run([
    {
      name: 'exactly 75% is P (405 of 540)',
      in: { punches: shift(WED, '10:00', '17:45') },
      expect: { workedMin: 405, status: 'P', earlyBillableMin: 135, undertimeMin: 135 },
    },
    {
      name: 'just below 75% is H, with no minute deductions',
      in: { punches: shift(WED, '10:00', '17:44') },
      expect: { workedMin: 404, status: 'H', earlyBillableMin: 136, undertimeMin: 0 },
    },
    {
      name: 'exactly 40% is H (216 of 540)',
      in: { punches: shift(WED, '10:00', '13:36') },
      expect: { workedMin: 216, status: 'H' },
    },
    {
      name: 'just below 40% is A',
      in: { punches: shift(WED, '10:00', '13:35') },
      expect: { workedMin: 215, status: 'A', undertimeMin: 0 },
    },
    {
      name: 'example 3: in 10:00, out 18:15 is P with 105 early',
      in: { punches: shift(WED, '10:00', '18:15') },
      expect: {
        workedMin: 435,
        breakMin: 60,
        status: 'P',
        earlyBillableMin: 105,
        undertimeMin: 105,
      },
    },
    {
      name: 'example 3: in 10:00, out 17:15 is H',
      in: { punches: shift(WED, '10:00', '17:15') },
      expect: { workedMin: 375, breakMin: 60, status: 'H' },
    },
    {
      name: 'no punches is A',
      in: {},
      expect: {
        status: 'A',
        workedMin: 0,
        firstInTs: null,
        lastOutTs: null,
        open: false,
        tags: [],
      },
    },
    {
      name: 'pending, rejected and superseded punches do not count',
      in: {
        punches: [
          punch(WED, 'in', '10:00', { status: 'pending' }),
          punch(WED, 'in', '10:00', { status: 'rejected' }),
          punch(WED, 'out', '20:00', { status: 'superseded' }),
        ],
      },
      expect: { status: 'A', workedMin: 0, tags: ['pending'] },
    },
    {
      name: 'paid leave on a working day is L',
      in: { leave: leave('CL', true) },
      expect: { status: 'L', leaveCode: 'CL' },
    },
    {
      name: 'unpaid leave is LOP',
      in: { leave: leave('LOP', false) },
      expect: { status: 'LOP', leaveCode: 'LOP' },
    },
    {
      name: 'leave on a weekly off is ignored',
      in: { schedule: workOnTue, leave: leave('CL', true) },
      expect: { status: 'WO', leaveCode: null, dayType: 'WO' },
    },
    {
      name: 'paid half-day leave and the other half worked is L',
      in: { leave: leave('CL', true, 'first'), punches: shift(WED, '15:00', '20:00') },
      expect: { status: 'L', leaveCode: 'CL', workedMin: 300, lateMin: 0, tags: [] },
    },
    {
      name: 'paid half-day leave without the other half is H',
      in: { leave: leave('SL', true, 'second') },
      expect: { status: 'H', leaveCode: 'SL' },
    },
    {
      name: 'unpaid half-day leave and the other half worked is H',
      in: { leave: leave('LOP', false, 'first'), punches: shift(WED, '15:00', '20:00') },
      expect: { status: 'H', leaveCode: 'LOP' },
    },
    {
      name: 'unpaid half-day leave without the other half is LOP',
      in: { leave: leave('LOP', false, 'second') },
      expect: { status: 'LOP', leaveCode: 'LOP' },
    },
    {
      name: 'override wins and tags the day edited',
      in: { override: override({ status: 'P' }) },
      expect: { status: 'P', leaveCode: null, tags: ['edited'] },
    },
    {
      name: 'override to A drops the undertime',
      in: { override: override({ status: 'A' }), punches: shift(WED, '10:30', '20:00') },
      expect: { status: 'A', lateBillableMin: 20, undertimeMin: 0 },
    },
    {
      name: 'override to LOP carries the LOP code',
      in: { override: override({ status: 'LOP' }) },
      expect: { status: 'LOP', leaveCode: 'LOP' },
    },
    {
      name: 'override to L with a leave type',
      in: { override: override({ status: 'L', leaveCode: 'SL' }), leave: leave('CL', true) },
      expect: { status: 'L', leaveCode: 'SL' },
    },
    {
      name: 'override without a status keeps the computed one',
      in: { override: override(), punches: shift(WED, '10:00', '20:00') },
      expect: { status: 'P', tags: ['edited'] },
    },
    {
      name: 'example 9: worked the weekly off, credit 1.0',
      in: { schedule: workOnTue, punches: shift(TUE, '10:00', '19:30') },
      expect: {
        dayType: 'WO',
        status: 'WO',
        workedMin: 510,
        breakMin: 60,
        offdayCredit: 1,
        offdayOtMin: 0,
        otCandidateMin: 0,
        scheduledMin: 0,
        tags: ['worked_off_day'],
      },
    },
    {
      name: 'worked the weekly off, credit 0.5',
      in: { schedule: workOnTue, punches: shift(TUE, '10:00', '15:00') },
      expect: { workedMin: 300, offdayCredit: 0.5, offdayOtMin: 0 },
    },
    {
      name: 'worked the weekly off below 40%: minutes only, as overtime candidates',
      in: { schedule: workOnTue, punches: shift(TUE, '10:00', '12:10') },
      expect: {
        workedMin: 130,
        offdayCredit: 0,
        otCandidateMin: 120,
        offdayOtMin: 120,
        tags: ['ot', 'worked_off_day'],
      },
    },
    {
      name: 'duty on the weekly off: window minutes are pre-approved',
      in: {
        schedule: workOnTue,
        punches: shift(TUE, '10:00', '12:10'),
        preapprovals: [window(TUE, '10:00', '12:00')],
      },
      expect: { offdayCredit: 0, otPreapprovedMin: 120, otCandidateMin: 0, offdayOtMin: 120 },
    },
    {
      name: 'weekly off without presence',
      in: { schedule: workOnTue },
      expect: { status: 'WO', workedMin: 0, offdayCredit: 0, tags: [] },
    },
    {
      name: 'holiday worked with break punches on and a punched break',
      in: {
        schedule: schedule('2026-10-02', TPL.full, {
          holidays: [
            { date: '2026-10-02', name: 'Gandhi Jayanti', paid: true, workedComp: 'both' },
          ],
          rosterOverrides: [],
        }),
        rules: BREAKS,
        punches: [
          ...shift('2026-10-02', '10:00', '17:00'),
          punch('2026-10-02', 'break_start', '13:00'),
          punch('2026-10-02', 'break_end', '13:30'),
        ],
      },
      expect: { status: 'HO', dayType: 'HO', workedMin: 390, breakMin: 30, offdayCredit: 0.5 },
    },
    {
      name: 'not employed ignores everything',
      in: {
        schedule: schedule(WED, TPL.full, undefined, { joinDate: '2026-10-12' }),
        punches: shift(WED, '10:00', '20:00'),
        override: override({ status: 'P' }),
      },
      expect: { status: 'NE', dayType: 'NE', workedMin: 0, tags: [], firstInTs: null },
    },
  ]);
});

describe('open sessions', () => {
  run([
    {
      name: 'checked in, late, not out yet',
      in: { punches: [punch(WED, 'in', '10:12')] },
      expect: {
        status: 'OPEN',
        open: true,
        lateMin: 12,
        lateBillableMin: 2,
        earlyMin: 0,
        workedMin: 0,
        firstInTs: at(WED, '10:12'),
        lastOutTs: null,
        tags: ['late'],
      },
    },
    {
      name: 'back in after a closed session',
      in: { punches: [...shift(WED, '10:00', '14:00'), punch(WED, 'in', '15:00')] },
      expect: { status: 'OPEN', workedMin: 240, earlyMin: 0, firstInTs: at(WED, '10:00') },
    },
    {
      name: 'checked in after the shift end',
      in: { punches: [punch(WED, 'in', '20:30')] },
      expect: { status: 'OPEN', lateMin: 0, earlyMin: 0 },
    },
    {
      name: 'checked in on the weekly off',
      in: { schedule: workOnTue, punches: [punch(TUE, 'in', '10:00')] },
      expect: { status: 'OPEN', open: true, tags: ['worked_off_day'] },
    },
    {
      name: 'full-day leave still shows the leave while checked in',
      in: { leave: leave('CL', true), punches: [punch(WED, 'in', '10:00')] },
      expect: { status: 'L', open: true },
    },
    {
      name: 'half-day leave while checked in is OPEN',
      in: { leave: leave('CL', true, 'first'), punches: [punch(WED, 'in', '15:00')] },
      expect: { status: 'OPEN', leaveCode: 'CL' },
    },
  ]);
});

describe('tags and punch handling', () => {
  run([
    {
      name: 'offsite, offline, auto-closed, owner-edited and flagged punches',
      in: {
        punches: [
          punch(WED, 'in', '10:00', { source: 'offline', duty: '01J0000000000000000000D001' }),
          punch(WED, 'out', '20:00', { source: 'auto', status: 'flagged' }),
          punch(WED, 'in', '20:30', { source: 'owner' }),
          punch(WED, 'out', '20:40', { source: 'owner' }),
        ],
      },
      expect: { tags: ['offsite', 'offline', 'auto_closed', 'edited', 'flagged'] },
    },
    {
      name: 'night hours from a night template',
      in: {
        schedule: schedule(WED, TPL.night),
        punches: [punch(WED, 'in', '22:00'), punch(WED, 'out', '02:00', { dayOffset: 1 })],
      },
      expect: { workedMin: 240, status: 'P', tags: ['night_hours'] },
    },
    {
      name: 'night hours from an early-morning duty',
      in: {
        punches: shift(WED, '05:30', '20:00'),
        preapprovals: [window(WED, '05:00', '10:00')],
      },
      expect: { otPreapprovedMin: 270, tags: ['ot', 'night_hours'] },
    },
    {
      name: 'no night tag for a daytime duty or an evening pre-approval',
      in: {
        punches: shift(WED, '10:00', '22:00'),
        preapprovals: [window(WED, '09:00', '10:00'), window(WED, '20:00', '22:00', 'preapproval')],
      },
      expect: { otPreapprovedMin: 120, tags: ['ot'] },
    },
    {
      name: 'no night tag without presence',
      in: { schedule: schedule(WED, TPL.night) },
      expect: { status: 'A', tags: [] },
    },
    {
      name: 'an out without an in and a second in while open are ignored',
      in: {
        punches: [
          punch(WED, 'out', '09:00'),
          punch(WED, 'in', '10:00'),
          punch(WED, 'in', '11:00'),
          punch(WED, 'out', '20:00'),
        ],
      },
      expect: { workedMin: 540, lateMin: 0, open: false },
    },
    {
      name: 'in and out in the same minute leave no presence',
      in: {
        punches: [punch(WED, 'in', '10:00', { sec: 5 }), punch(WED, 'out', '10:00', { sec: 40 })],
      },
      expect: { status: 'A', workedMin: 0, open: false, lastOutTs: at(WED, '10:00') },
    },
    {
      name: 'same instant: in sorts before out',
      in: {
        punches: [
          punch(WED, 'out', '10:00', { id: '01J0000000000000000000000A' }),
          punch(WED, 'in', '10:00'),
        ],
      },
      expect: { status: 'A', open: false },
    },
    {
      name: 'same instant, same kind: ordered by id',
      in: {
        punches: [
          punch(WED, 'in', '10:00', { id: '01J0000000000000000000000B' }),
          punch(WED, 'in', '10:00', { id: '01J0000000000000000000000A' }),
          punch(WED, 'out', '20:00'),
        ],
      },
      expect: { workedMin: 540, status: 'P' },
    },
  ]);
});

describe('day result basics', () => {
  it('carries the engine version, user, date and template', () => {
    const r = computeDay(input({ punches: shift(WED, '10:00', '20:00') }));
    expect(r).toMatchObject({
      version: ENGINE_VERSION,
      userId: schedule().userId,
      workDate: WED,
      templateId: TPL.full.id,
      scheduledMin: 540,
    });
  });

  it('timeRulesFromSettings maps the PRD 7.14 defaults', () => {
    expect(timeRulesFromSettings(DEFAULT_ORG_SETTINGS)).toEqual({
      graceMin: 10,
      earlyToleranceMin: 15,
      makeupEnabled: true,
      presentPct: 75,
      halfPct: 40,
      breakAfterMin: 300,
      breakPunches: false,
      otThresholdMin: 30,
      otBlockMin: 15,
    });
  });

  it('does not mutate its input and ignores punch order', () => {
    const punches = shift(WED, '10:20', '14:00', '15:00', '20:40');
    const a = input({ punches });
    const before = structuredClone(a);
    const r1 = computeDay(a);
    expect(a).toEqual(before);
    expect(computeDay({ ...a, punches: [...punches].reverse() })).toEqual(r1);
  });
});
