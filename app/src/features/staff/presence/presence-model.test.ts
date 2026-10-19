import type { AwayIntervalStaff, DutyView, PresenceState } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { dutyRunning, historyByDay, minutesOut, presenceUi } from './presence-model';

const NOW = Date.parse('2026-10-19T10:42:00+05:30');
const open: AwayIntervalStaff = {
  id: '01K8WP9AWAY200000000000000',
  workDate: '2026-10-19',
  source: 'step_out',
  reason: 'lunch',
  markedByName: null,
  staffNote: null,
  startTs: NOW - 12 * 60_000,
  endTs: null,
  awayMin: 0,
  state: 'open',
};
const base: PresenceState = { enabled: true, consentNeeded: false, stepOutEnabled: true };
const opts = { duty: null, now: NOW, ownerName: 'Urmi' };

describe('presence on Today (PRD 4.18.4, S-24)', () => {
  it('S-24.2 checked in: Step out shows next to Check out', () => {
    expect(presenceUi({ status: 'in' }, base, opts)).toEqual({
      askConsent: false,
      stepOut: true,
      card: null,
    });
  });

  it('no Step out before check-in, after check-out, with Step out off or presence off', () => {
    expect(presenceUi({ status: 'not_in' }, base, opts).stepOut).toBe(false);
    expect(presenceUi({ status: 'done' }, base, opts).stepOut).toBe(false);
    expect(presenceUi({ status: 'in' }, { ...base, stepOutEnabled: false }, opts).stepOut).toBe(
      false,
    );
    expect(presenceUi({ status: 'in' }, { ...base, enabled: false }, opts).stepOut).toBe(false);
    expect(presenceUi({ status: 'in' }, undefined, opts).stepOut).toBe(false);
  });

  it('4.18.7 a running venue duty pauses Step out', () => {
    const duty = { startTs: NOW - 3_600_000, endTs: NOW + 3_600_000, cancelledAt: null };
    expect(dutyRunning(duty as DutyView, NOW)).toBe(true);
    expect(presenceUi({ status: 'in' }, base, { ...opts, duty: duty as DutyView }).stepOut).toBe(
      false,
    );
    expect(dutyRunning({ ...duty, endTs: NOW - 1 } as DutyView, NOW)).toBe(false);
  });

  it('S-24.2 out: the card says since when, with I am back instead of Step out', () => {
    const ui = presenceUi({ status: 'in' }, { ...base, openAway: open }, opts);
    expect(ui.stepOut).toBe(false);
    expect(ui.card).toEqual({ kind: 'stepped', away: open });
  });

  it('S-24.3 marked away at a roll-call: the card names who marked it', () => {
    const marked = { ...open, source: 'roll_call' as const, reason: null, markedByName: 'Urmi' };
    expect(presenceUi({ status: 'in' }, { ...base, openAway: marked }, opts).card).toEqual({
      kind: 'marked',
      away: marked,
      by: 'Urmi',
    });
    const unnamed = { ...marked, markedByName: null };
    expect(presenceUi({ status: 'in' }, { ...base, openAway: unnamed }, opts).card).toEqual({
      kind: 'marked',
      away: unnamed,
      by: 'Urmi',
    });
  });

  it('S-24.1 the notice is asked for while consent is needed, even before check-in', () => {
    expect(
      presenceUi({ status: 'not_in' }, { ...base, consentNeeded: true }, opts).askConsent,
    ).toBe(true);
  });

  it('minutes out come from the server, else from the times', () => {
    expect(minutesOut({ awayMin: 25, startTs: 0, endTs: 60_000 })).toBe(25);
    expect(minutesOut({ awayMin: 0, startTs: 0, endTs: 40 * 60_000 })).toBe(40);
    expect(minutesOut({ awayMin: 0, startTs: 0, endTs: null })).toBe(0);
  });
});

describe('My data, Presence (S-24.4)', () => {
  it('groups marks, step-outs and checks by day, newest day first, in time order', () => {
    const at = (d: string, hhmm: string) => Date.parse(`${d}T${hhmm}:00+05:30`);
    const days = historyByDay({
      rollCalls: [
        { workDate: '2026-10-19', slotTime: '12:00', mark: 'here' },
        { workDate: '2026-10-18', slotTime: '15:00', mark: 'not_here' },
      ],
      away: [{ ...open, startTs: at('2026-10-19', '09:32'), endTs: at('2026-10-19', '09:57') }],
      checks: [{ ts: at('2026-10-19', '10:07'), result: 'inside', distanceBucket: '0-50' }],
    });
    expect(days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-18']);
    expect(days[0]?.items.map((i) => `${i.kind} ${i.time}`)).toEqual([
      'away 09:32',
      'check 10:07',
      'roll_call 12:00',
    ]);
  });
});
