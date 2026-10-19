import { TodayView } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { buildTodayModel, firstName, greetingPart, liveWorkedMinutes } from './today-model';

const NOW = Date.parse('2026-10-19T10:42:00+05:30');
const view = (name?: string) => TodayView.parse(name ? variants.meToday?.[name] : fixtures.meToday);

describe('Today model (PRD 5.1, AC S-10)', () => {
  it('S-10.1 checked in: status in, live hours from the server figure, Check out', () => {
    const m = buildTodayModel(view('checked-in'), [], NOW);
    expect(m.status).toBe('in');
    expect(m.primary).toBe('check_out');
    expect(m.workedMin).toBe(40);
    expect(m.lastPunch?.kind).toBe('in');
    expect(m.confirm).toBeNull();
  });

  it('S-10.1 live hours grow each minute while in', () => {
    const v = view('checked-in');
    expect(liveWorkedMinutes(v, NOW + 59_000)).toBe(40);
    expect(liveWorkedMinutes(v, NOW + 60_000)).toBe(41);
    expect(liveWorkedMinutes(v, NOW + 3 * 3_600_000)).toBe(220);
  });

  it('S-10.1 ready: not in yet, Check in, no live hours', () => {
    const m = buildTodayModel(view('ready'), [], NOW);
    expect(m.status).toBe('not_in');
    expect(m.primary).toBe('check_in');
    expect(m.workedMin).toBeNull();
  });

  it('S-10.1 checked out: done with the out time and the day total', () => {
    const m = buildTodayModel(view('checked-out'), [], NOW);
    expect(m.status).toBe('done');
    expect(m.outTs).toBe(1792420702000);
    expect(m.workedMin).toBe(546);
    expect(m.primary).toBe('check_in');
  });

  it('S-10.2 week off asks to confirm before checking in', () => {
    const m = buildTodayModel(view('week-off'), [], NOW);
    expect(m.dayKind).toBe('week_off');
    expect(m.confirm).toBe('week_off');
  });

  it('S-10.2 leave day asks to confirm (checking in cancels the leave)', () => {
    const m = buildTodayModel(view('on-leave'), [], NOW);
    expect(m.dayKind).toBe('on_leave');
    expect(m.confirm).toBe('on_leave');
  });

  it('S-10.2 holiday asks to confirm', () => {
    const v = view('ready');
    v.schedule.dayType = 'HO';
    v.schedule.holidayName = 'Diwali';
    expect(buildTodayModel(v, [], NOW).confirm).toBe('holiday');
  });

  it('S-04.5 before the earliest check-in time the button asks to confirm', () => {
    const v = view('ready');
    const early = (v.earliestCheckInTs ?? 0) - 60_000;
    expect(buildTodayModel(v, [], early).confirm).toBe('too_early');
    expect(buildTodayModel(v, [], NOW).confirm).toBeNull();
  });

  it('S-06 a punch waiting for proof turns the button into Scan door code', () => {
    const m = buildTodayModel(view('pending-proof'), [], NOW);
    expect(m.status).toBe('waiting_proof');
    expect(m.primary).toBe('scan');
    expect(m.pendingPunch?.pendingReason).toBe('needs_proof');
  });

  it('S-09.1 a queued check-in shows as in (waiting to send) with Check out next', () => {
    const queuedAt = Date.parse('2026-10-19T10:03:00+05:30');
    const m = buildTodayModel(
      view('ready'),
      [{ kind: 'in', clientTs: queuedAt, failed: false }],
      NOW,
    );
    expect(m.status).toBe('queued_in');
    expect(m.inSinceTs).toBe(queuedAt);
    expect(m.primary).toBe('check_out');
    expect(m.workedMin).toBe(39);
  });

  it('S-09.1 a queued check-out shows as out (waiting to send)', () => {
    const at = Date.parse('2026-10-19T20:05:00+05:30');
    const m = buildTodayModel(
      view('checked-in'),
      [{ kind: 'out', clientTs: at, failed: false }],
      NOW,
    );
    expect(m.status).toBe('queued_out');
    expect(m.primary).toBe('check_in');
  });

  it('greets by IST part of day and first name', () => {
    expect(greetingPart(NOW)).toBe('morning');
    expect(greetingPart(Date.parse('2026-10-19T13:00:00+05:30'))).toBe('afternoon');
    expect(greetingPart(Date.parse('2026-10-19T19:00:00+05:30'))).toBe('evening');
    expect(firstName('Priya Solanki')).toBe('Priya');
  });
});
