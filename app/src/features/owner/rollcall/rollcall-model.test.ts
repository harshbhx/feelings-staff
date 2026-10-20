import type { RollCallPerson } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import {
  canOpenSlot,
  checkRollCallTimes,
  countMarks,
  initialMarks,
  istTs,
  nextTime,
  rowHints,
  submitBody,
  toggleMark,
} from './rollcall-model';

const IN = Date.parse('2026-10-19T10:00:00+05:30');
const people: RollCallPerson[] = [
  { userId: 'neha', name: 'Neha Parmar', inAt: IN, state: 'here' },
  {
    userId: 'dhara',
    name: 'Dhara Gohil',
    inAt: IN,
    state: 'away_open',
    awaySince: IN + 24 * 60_000,
    hint: 'stepped_out',
    hintDetail: 'Lunch outside, since 10:24',
  },
  { userId: 'hetal', name: 'Hetal Dave', inAt: IN, state: 'on_break' },
  { userId: 'sejal', name: 'Sejal Makwana', inAt: IN, state: 'here', hint: 'seems_away' },
];

describe('roll-call marks (PRD 4.18.3)', () => {
  it('O-30.2 everyone checked in starts on Here; an open away interval stays Not here', () => {
    expect(initialMarks(people)).toEqual({
      neha: 'here',
      dhara: 'not_here',
      hetal: 'here',
      sejal: 'here',
    });
  });

  it('O-30.2 a tap switches Here to Not here and back', () => {
    const start = initialMarks(people);
    const once = toggleMark(start, 'sejal');
    expect(once.sejal).toBe('not_here');
    expect(toggleMark(once, 'sejal').sejal).toBe('here');
  });

  it('counts here, not here and what changed since the roll-call opened', () => {
    const marks = toggleMark(toggleMark(initialMarks(people), 'sejal'), 'dhara');
    expect(countMarks(people, marks)).toEqual({ here: 3, notHere: 1, changed: 2 });
  });

  it('O-30.3 Done sends every mark: Not here starts or continues, Here ends an open interval', () => {
    const marks = toggleMark(initialMarks(people), 'sejal');
    expect(submitBody(people, marks, 'key-0123456789abcdef')).toEqual({
      notHere: ['dhara', 'sejal'],
      here: ['neha', 'hetal'],
      idempotencyKey: 'key-0123456789abcdef',
    });
  });

  it('shows the step-out, seems-away and break hints in words', () => {
    expect(rowHints(people[1] as RollCallPerson)).toEqual([
      { kind: 'stepped_out', detail: 'Lunch outside, since 10:24', since: IN + 24 * 60_000 },
    ]);
    expect(rowHints(people[2] as RollCallPerson)).toEqual([{ kind: 'on_break' }]);
    expect(rowHints(people[3] as RollCallPerson)).toEqual([{ kind: 'seems_away' }]);
    expect(
      rowHints({ userId: 'x', name: 'X', inAt: IN, state: 'away_open', awaySince: IN }),
    ).toEqual([{ kind: 'away_since', since: IN }]);
  });

  it('an upcoming slot cannot be opened yet', () => {
    expect(canOpenSlot({ status: 'upcoming' })).toBe(false);
    expect(canOpenSlot({ status: 'open' })).toBe(true);
    expect(canOpenSlot({ status: 'done' })).toBe(true);
    expect(canOpenSlot({ status: 'missed' })).toBe(true);
  });
});

describe('roll-call times (Settings -> Presence)', () => {
  it('O-30.10 accepts one to four times in order, before closing', () => {
    expect(checkRollCallTimes(['12:00', '15:00', '18:00'], '20:00')).toBe('none');
    expect(checkRollCallTimes([], '20:00')).toBe('tooMany');
    expect(checkRollCallTimes(['10:00', '12:00', '14:00', '16:00', '18:00'])).toBe('tooMany');
    expect(checkRollCallTimes(['12:00', '9:00'])).toBe('invalid');
    expect(checkRollCallTimes(['15:00', '12:00'])).toBe('order');
    expect(checkRollCallTimes(['12:00', '12:00'])).toBe('order');
    expect(checkRollCallTimes(['12:00', '20:30'], '20:00')).toBe('afterClosing');
  });

  it('suggests the next time an hour after the last one', () => {
    expect(nextTime(['12:00', '15:00', '18:00'])).toBe('19:00');
    expect(nextTime(['12:00', '15:00', '18:00', '19:00'])).toBeNull();
    expect(nextTime(['19:30'], '20:00')).toBeNull();
  });

  it('turns HH:MM on a work date into an IST instant', () => {
    expect(istTs('2026-10-19', '15:30')).toBe(Date.parse('2026-10-19T15:30:00+05:30'));
    expect(istTs('2026-10-19', '25:00')).toBeNull();
  });
});
