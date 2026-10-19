/**
 * Today screen model (PRD 5.1 Today, 4.3.2, 4.3.6; AC S-10). Pure: the screen renders it, tests
 * assert it. Queued offline punches (not yet on the server) are applied on top of the server view,
 * so "In at 10:02 (waiting to send)" and the right button show while offline.
 */
import type { PunchKind, PunchView, TodayView } from '@fs/contracts';

export type TodayStatus =
  | 'not_in'
  | 'in'
  | 'on_break'
  | 'done'
  | 'waiting_proof'
  | 'waiting_owner'
  | 'queued_in'
  | 'queued_out';

export type DayKind = 'work' | 'week_off' | 'holiday' | 'on_leave' | 'not_scheduled';

/** What the one sindoor button does. */
export type TodayPrimary = 'check_in' | 'check_out' | 'scan';

/** Confirmation needed before a check-in (PRD 4.3.2). */
export type PunchConfirm = 'week_off' | 'holiday' | 'on_leave' | 'too_early';

/** A punch waiting in the offline queue, as far as Today needs it. */
export interface QueuedPunchBrief {
  kind: PunchKind;
  clientTs: number;
  failed: boolean;
}

export interface TodayModel {
  status: TodayStatus;
  dayKind: DayKind;
  primary: TodayPrimary;
  /** Confirmation to ask before a check-in, if any. */
  confirm: PunchConfirm | null;
  /** Live worked minutes (null when there is nothing to show yet). */
  workedMin: number | null;
  /** Start of the open session, when in (server or queued). */
  inSinceTs: number | null;
  /** Time of the last check-out, when done. */
  outTs: number | null;
  lastPunch: PunchView | null;
  /** The punch waiting for a door code or the owner. */
  pendingPunch: PunchView | null;
  /** The newest queued punch that changes the state. */
  queued: QueuedPunchBrief | null;
  /** Shift start/end for copy ("Your shift starts at 10:00"). */
  shiftStartTs: number | null;
  shiftEndTs: number | null;
  /** Earliest check-in without approval. */
  earliestCheckInTs: number | null;
}

const PROOF_REASONS = new Set(['needs_proof', 'outside_fence', 'strong_mode']);

export function dayKindOf(view: TodayView): DayKind {
  const s = view.schedule;
  if (s.leave && s.leave.half === 'none') return 'on_leave';
  if (s.dayType === 'WO') return 'week_off';
  if (s.dayType === 'HO') return 'holiday';
  if (s.dayType === 'NE') return 'not_scheduled';
  return 'work';
}

function lastOf<T>(xs: readonly T[]): T | null {
  return xs.length ? (xs[xs.length - 1] as T) : null;
}

/** Live worked minutes: the server's figure plus whole minutes since the server computed it. */
export function liveWorkedMinutes(view: TodayView, nowMs: number): number | null {
  const base = view.day?.workedMin ?? null;
  if (view.state === 'in') {
    const sinceServer = Math.max(0, Math.floor((nowMs - view.serverTime) / 60_000));
    if (base !== null) return base + sinceServer;
    if (view.inSinceTs !== null) return Math.max(0, Math.floor((nowMs - view.inSinceTs) / 60_000));
    return null;
  }
  if (base !== null && (view.state === 'on_break' || view.punches.length > 0)) return base;
  return null;
}

export function buildTodayModel(
  view: TodayView,
  queuedItems: readonly QueuedPunchBrief[],
  nowMs: number,
): TodayModel {
  const dayKind = dayKindOf(view);
  const visible = view.punches.filter((p) => p.status !== 'superseded' && p.status !== 'rejected');
  const lastPunch = lastOf(visible);
  const pending = lastPunch && lastPunch.status === 'pending' ? lastPunch : null;
  const queued = lastOf(queuedItems.filter((q) => q.kind === 'in' || q.kind === 'out'));

  let status: TodayStatus;
  let inSinceTs = view.inSinceTs;
  let outTs: number | null = null;

  if (queued && queued.kind === 'in' && view.state !== 'in') {
    status = 'queued_in';
    inSinceTs = queued.clientTs;
  } else if (queued && queued.kind === 'out' && view.state !== 'out') {
    status = 'queued_out';
    outTs = queued.clientTs;
  } else if (pending && PROOF_REASONS.has(pending.pendingReason ?? '')) {
    status = 'waiting_proof';
  } else if (pending && pending.kind === 'in' && view.state === 'out') {
    status = 'waiting_owner';
    inSinceTs = pending.effectiveTs;
  } else if (view.state === 'in') {
    status = 'in';
  } else if (view.state === 'on_break') {
    status = 'on_break';
  } else {
    const lastOut = lastOf(visible.filter((p) => p.kind === 'out'));
    if (lastOut && lastPunch?.kind === 'out') {
      status = 'done';
      outTs = lastOut.effectiveTs;
    } else {
      status = 'not_in';
    }
  }

  const primary: TodayPrimary =
    status === 'waiting_proof'
      ? 'scan'
      : status === 'in' ||
          status === 'on_break' ||
          status === 'queued_in' ||
          status === 'waiting_owner'
        ? 'check_out'
        : 'check_in';

  let confirm: PunchConfirm | null = null;
  if (primary === 'check_in') {
    if (dayKind === 'on_leave') confirm = 'on_leave';
    else if (dayKind === 'week_off') confirm = 'week_off';
    else if (dayKind === 'holiday') confirm = 'holiday';
    else if (
      status === 'not_in' &&
      view.earliestCheckInTs !== null &&
      nowMs < view.earliestCheckInTs &&
      visible.length === 0
    )
      confirm = 'too_early';
  }

  let workedMin = liveWorkedMinutes(view, nowMs);
  if (status === 'queued_in' && inSinceTs !== null)
    workedMin = (view.day?.workedMin ?? 0) + Math.max(0, Math.floor((nowMs - inSinceTs) / 60_000));

  return {
    status,
    dayKind,
    primary,
    confirm,
    workedMin,
    inSinceTs,
    outTs,
    lastPunch,
    pendingPunch: pending,
    queued,
    shiftStartTs: view.schedule.startTs,
    shiftEndTs: view.schedule.endTs,
    earliestCheckInTs: view.earliestCheckInTs,
  };
}

/** IST part of the day for the greeting. */
export function greetingPart(nowMs: number): 'morning' | 'afternoon' | 'evening' {
  const istHour = new Date(nowMs + 330 * 60_000).getUTCHours();
  if (istHour >= 4 && istHour < 12) return 'morning';
  if (istHour >= 12 && istHour < 17) return 'afternoon';
  return 'evening';
}

/** First name for the greeting ("Priya Solanki" -> "Priya"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
