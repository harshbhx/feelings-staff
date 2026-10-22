/**
 * Status vocabulary for owner screens (PRD 12.3): every status is colour + icon + word, never colour
 * alone. These helpers map contract values to the kit's StatusChip status (which carries the colour
 * and the icon), a register letter and an `owner:status.*` word.
 */
import type {
  BoardInRow,
  DayStatus,
  DayTag,
  LeaveCode,
  PunchStatus,
  RiskReason,
} from '@fs/contracts';
import type { DayStatus as ChipStatus, IconName } from '@fs/ui';

export type { ChipStatus };

export interface StatusMeta {
  /** The kit StatusChip status: colour, tint and icon. */
  chip: ChipStatus;
  /** Short code for grid cells (P, H, A, L, WO, HO, OD); empty for tags. */
  letter: string;
  /** `owner:status.*` key with the word. */
  labelKey: string;
}

const DAY: Record<DayStatus, StatusMeta> = {
  P: { chip: 'present', letter: 'P', labelKey: 'owner:status.P' },
  H: { chip: 'half', letter: 'H', labelKey: 'owner:status.H' },
  A: { chip: 'absent', letter: 'A', labelKey: 'owner:status.A' },
  L: { chip: 'leave', letter: 'L', labelKey: 'owner:status.L' },
  LOP: { chip: 'leave', letter: 'L', labelKey: 'owner:status.LOP' },
  WO: { chip: 'off', letter: 'WO', labelKey: 'owner:status.WO' },
  HO: { chip: 'holiday', letter: 'HO', labelKey: 'owner:status.HO' },
  NE: { chip: 'off', letter: '–', labelKey: 'owner:status.NE' },
  OPEN: { chip: 'waiting', letter: 'In', labelKey: 'owner:status.OPEN' },
};

export function dayStatusMeta(status: DayStatus): StatusMeta {
  return DAY[status];
}

/** At a venue (off-site) shows as OD in plum with a pin (PRD 12.3). */
export const VENUE_META: StatusMeta = { chip: 'venue', letter: 'OD', labelKey: 'owner:status.OD' };
export const LATE_META: StatusMeta = { chip: 'late', letter: '', labelKey: 'owner:status.late' };
export const FLAG_META: StatusMeta = { chip: 'flag', letter: '', labelKey: 'owner:status.flagged' };
export const PENDING_META: StatusMeta = {
  chip: 'waiting',
  letter: '',
  labelKey: 'owner:status.pending',
};

/** A register cell: present days spent at a venue read as OD; tags are drawn separately. */
export function cellMeta(status: DayStatus, tags: readonly DayTag[]): StatusMeta {
  if (status === 'P' && tags.includes('offsite')) return VENUE_META;
  return DAY[status];
}

export function punchStatusMeta(status: PunchStatus): StatusMeta | null {
  switch (status) {
    case 'flagged':
      return FLAG_META;
    case 'pending':
      return PENDING_META;
    case 'rejected':
      return { chip: 'absent', letter: '', labelKey: 'owner:status.rejected' };
    default:
      return null;
  }
}

/** Tint and text classes per chip status, for register and roster cells drawn as table cells. */
export const TINT: Record<ChipStatus, string> = {
  present: 'bg-present-bg text-present',
  late: 'bg-late-bg text-late',
  half: 'bg-half-bg text-half',
  absent: 'bg-absent-bg text-absent',
  leave: 'bg-leave-bg text-leave',
  off: 'bg-off-bg text-off',
  holiday: 'bg-off-bg text-off',
  flag: 'bg-flag-bg text-flag',
  waiting: 'bg-bg text-flag outline-1 outline-border-control outline-dashed -outline-offset-1',
  venue: 'bg-leave-bg text-leave',
};

export const CHIP_ICON: Record<ChipStatus, IconName> = {
  present: 'check-circle',
  late: 'clock',
  half: 'circle-half',
  absent: 'x-circle',
  leave: 'airplane-tilt',
  off: 'minus',
  holiday: 'confetti',
  flag: 'warning-circle',
  waiting: 'hourglass',
  venue: 'map-pin',
};

/**
 * One status per row (UI redesign Fix 2, PRD 12.3 as amended). A row can match several statuses at
 * once (late, waiting for the owner and at the edge of the area); only the highest one becomes the
 * row's chip, the rest go into the row's quiet line as words. Highest first:
 *   1. the owner has to act: waiting for you (the check-in does not count until approved), then
 *      needs a look;
 *   2. absent, then half day;
 *   3. late, shown as minutes ("+28 m");
 *   4. present: at a venue (the more specific word), then present;
 *   5. leave, holiday, week off, not scheduled.
 */
export type RowStatus =
  | 'pending'
  | 'flag'
  | 'absent'
  | 'half'
  | 'late'
  | 'venue'
  | 'present'
  | 'leave'
  | 'holiday'
  | 'off'
  | 'unscheduled';

export const ROW_STATUS_PRIORITY: readonly RowStatus[] = [
  'pending',
  'flag',
  'absent',
  'half',
  'late',
  'venue',
  'present',
  'leave',
  'holiday',
  'off',
  'unscheduled',
];

const RANK = new Map(ROW_STATUS_PRIORITY.map((s, i) => [s, i]));

/** The kit chip (colour, tint and icon) for each row status. */
export const ROW_CHIP: Record<RowStatus, ChipStatus> = {
  pending: 'waiting',
  flag: 'flag',
  absent: 'absent',
  half: 'half',
  late: 'late',
  venue: 'venue',
  present: 'present',
  leave: 'leave',
  holiday: 'holiday',
  off: 'off',
  unscheduled: 'off',
};

/** The one status a row shows: the highest of the statuses it matches, or null when none. */
export function rowStatus(matches: Iterable<RowStatus>): RowStatus | null {
  let best: RowStatus | null = null;
  let rank = Number.POSITIVE_INFINITY;
  for (const s of matches) {
    const r = RANK.get(s) ?? Number.POSITIVE_INFINITY;
    if (r < rank) {
      best = s;
      rank = r;
    }
  }
  return best;
}

/** What a Today row (checked in, or in and out) matches, before the priority picks one. */
export function inRowMatches(
  row: Pick<BoardInRow, 'pending' | 'flagged' | 'lateMin' | 'place'>,
): RowStatus[] {
  const out: RowStatus[] = ['present'];
  if (row.pending) out.push('pending');
  if (row.flagged) out.push('flag');
  if (row.lateMin > 0) out.push('late');
  if (row.place === 'venue') out.push('venue');
  return out;
}

/** The chip of a Today row: never null, a row that came in is at least present. */
export function inRowStatus(
  row: Pick<BoardInRow, 'pending' | 'flagged' | 'lateMin' | 'place'>,
): RowStatus {
  return rowStatus(inRowMatches(row)) ?? 'present';
}

/** `owner:leave.CL` etc. */
export function leaveKey(code: LeaveCode): string {
  return `owner:leave.${code}`;
}

/** Signals that lower the score (shown as reassurance, not as a reason to worry). */
export const POSITIVE_SIGNALS: readonly RiskReason[] = ['salon_network', 'door_qr', 'offsite_duty'];

/** Risk reasons in words (S-05.4). */
export function riskKey(reason: RiskReason): string {
  return `owner:risk.${reason}`;
}
