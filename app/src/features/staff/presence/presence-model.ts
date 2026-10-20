/**
 * What presence adds to Today (PRD 4.18.1, 4.18.4, 4.18.7; S-24). Pure: from the day (TodayModel
 * and the duty) and `GET /me/presence`, decide whether to ask for the presence notice, whether the
 * Step out button shows, and which away card shows. Staff never see credits, balances or rupees
 * here; only times, minutes out and the reason they chose.
 */
import type { AwayIntervalStaff, AwayReason, DutyView, PresenceState } from '@fs/contracts';
import type { TodayModel } from '../today/today-model';

/** Version of the presence notice text (4.18.1); stored with the `presence_checks` consent. */
export const PRESENCE_NOTICE_VERSION = '2026-10-19';

export const STEP_OUT_REASONS: readonly AwayReason[] = ['personal', 'lunch', 'errand', 'other'];

export type AwayCard =
  /** "Urmi marked you away since 15:00" (a roll-call Not here). */
  | { kind: 'marked'; away: AwayIntervalStaff; by: string }
  /** "You're out since 15:30 · Lunch outside". */
  | { kind: 'stepped'; away: AwayIntervalStaff };

export interface PresenceUi {
  /** Show the presence notice (once; the person may also say Not now). */
  askConsent: boolean;
  /** The secondary Step out button next to Check out. */
  stepOut: boolean;
  /** The card for an open away interval, with I'm back. */
  card: AwayCard | null;
}

const NONE: PresenceUi = { askConsent: false, stepOut: false, card: null };

/** A venue duty running now: presence is paused, no Step out (4.18.7). */
export function dutyRunning(duty: DutyView | null, now: number): boolean {
  return duty !== null && duty.cancelledAt === null && now >= duty.startTs && now < duty.endTs;
}

export function presenceUi(
  model: Pick<TodayModel, 'status'>,
  presence: PresenceState | undefined,
  opts: { duty: DutyView | null; now: number; ownerName: string },
): PresenceUi {
  if (!presence?.enabled) return NONE;
  const open = presence.openAway && presence.openAway.endTs === null ? presence.openAway : null;
  const checkedIn = model.status === 'in';
  let card: AwayCard | null = null;
  if (open && (checkedIn || model.status === 'on_break')) {
    const by = open.markedByName ?? (open.source === 'roll_call' ? opts.ownerName : null);
    card = by ? { kind: 'marked', away: open, by } : { kind: 'stepped', away: open };
  }
  return {
    askConsent: presence.consentNeeded,
    stepOut:
      presence.stepOutEnabled && checkedIn && card === null && !dutyRunning(opts.duty, opts.now),
    card,
  };
}

/** Minutes out, for "Welcome back. You were out 40 min." (server time decides). */
export function minutesOut(away: Pick<AwayIntervalStaff, 'awayMin' | 'startTs' | 'endTs'>) {
  if (away.awayMin > 0) return away.awayMin;
  if (away.endTs === null) return 0;
  return Math.max(0, Math.round((away.endTs - away.startTs) / 60_000));
}
