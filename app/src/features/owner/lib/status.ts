/**
 * Status vocabulary for owner screens (PRD 12.3): every status is colour + icon + word, never colour
 * alone. These helpers map contract values to a tone, a Phosphor icon name, a short letter and an
 * i18n key; the components (StatusChip, register cells) only draw them.
 */
import type {
  DayStatus,
  DayTag,
  LeaveCode,
  PunchStatus,
  RiskReason,
  RosterCell,
} from '@fs/contracts';

/** Tones match the app tokens `--status-*` (PRD 12.3). `pending` is white with a dashed border. */
export type StatusTone =
  | 'present'
  | 'late'
  | 'half'
  | 'absent'
  | 'leave'
  | 'off'
  | 'flag'
  | 'pending';

/** Phosphor regular icons used for statuses (PRD 12.7 set). */
export type StatusIcon =
  | 'check-circle'
  | 'clock'
  | 'circle-half'
  | 'x-circle'
  | 'airplane-tilt'
  | 'minus'
  | 'confetti'
  | 'warning-circle'
  | 'hourglass'
  | 'map-pin';

export interface StatusMeta {
  tone: StatusTone;
  icon: StatusIcon;
  /** Short code shown in grid cells (P, H, A, L, WO, HO). */
  letter: string;
  /** `owner:status.*` key with the word. */
  labelKey: string;
}

const DAY: Record<DayStatus, StatusMeta> = {
  P: { tone: 'present', icon: 'check-circle', letter: 'P', labelKey: 'owner:status.P' },
  H: { tone: 'half', icon: 'circle-half', letter: 'H', labelKey: 'owner:status.H' },
  A: { tone: 'absent', icon: 'x-circle', letter: 'A', labelKey: 'owner:status.A' },
  L: { tone: 'leave', icon: 'airplane-tilt', letter: 'L', labelKey: 'owner:status.L' },
  LOP: { tone: 'leave', icon: 'airplane-tilt', letter: 'L', labelKey: 'owner:status.LOP' },
  WO: { tone: 'off', icon: 'minus', letter: 'WO', labelKey: 'owner:status.WO' },
  HO: { tone: 'off', icon: 'confetti', letter: 'HO', labelKey: 'owner:status.HO' },
  NE: { tone: 'off', icon: 'minus', letter: '–', labelKey: 'owner:status.NE' },
  OPEN: { tone: 'pending', icon: 'hourglass', letter: 'In', labelKey: 'owner:status.OPEN' },
};

export function dayStatusMeta(status: DayStatus): StatusMeta {
  return DAY[status];
}

/** At a venue (off-site) shows as OD in plum with a pin (PRD 12.3). */
export const VENUE_META: StatusMeta = {
  tone: 'leave',
  icon: 'map-pin',
  letter: 'OD',
  labelKey: 'owner:status.OD',
};

export const LATE_META: StatusMeta = {
  tone: 'late',
  icon: 'clock',
  letter: '',
  labelKey: 'owner:status.late',
};

export const FLAG_META: StatusMeta = {
  tone: 'flag',
  icon: 'warning-circle',
  letter: '',
  labelKey: 'owner:status.flagged',
};

export const PENDING_META: StatusMeta = {
  tone: 'pending',
  icon: 'hourglass',
  letter: '',
  labelKey: 'owner:status.pending',
};

/**
 * The meta for a register cell: present days spent at a venue read as OD, flagged or pending days
 * keep their status but carry the tag separately.
 */
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
      return {
        tone: 'absent',
        icon: 'x-circle',
        letter: '',
        labelKey: 'owner:status.rejected',
      };
    default:
      return null;
  }
}

/** `owner:leave.CL` etc. */
export function leaveKey(code: LeaveCode): string {
  return `owner:leave.${code}`;
}

/** Risk reasons in words (S-05.4); positive signals are listed separately. */
export const POSITIVE_SIGNALS: readonly RiskReason[] = ['salon_network', 'door_qr', 'offsite_duty'];

export function riskKey(reason: RiskReason): string {
  return `owner:risk.${reason}`;
}

/** Roster cell vocabulary (PRD 5.2 Roster: template, WO, HO, L, duty). */
export function rosterCellMeta(cell: RosterCell): StatusMeta | null {
  switch (cell.kind) {
    case 'WO':
      return DAY.WO;
    case 'HO':
      return DAY.HO;
    case 'L':
      return DAY.L;
    case 'NE':
      return DAY.NE;
    default:
      return null;
  }
}
