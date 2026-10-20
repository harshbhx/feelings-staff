/**
 * Pure rules behind the leave and fix forms (PRD 4.9, 4.11; AC S-12, S-13): what is allowed
 * before "Send" is enabled, and the request bodies. The server checks everything again.
 */
import {
  addDays,
  hhmmToMin,
  istToEpoch,
  type LeavePreview,
  type LeaveRequestCreate,
  type RegularisationCreate,
  type RegularisationKind,
} from '@fs/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---- Leave --------------------------------------------------------------------------------

export interface LeaveDraft {
  typeCode: LeaveRequestCreate['typeCode'] | '';
  fromDate: string;
  toDate: string;
  reason: string;
  /** "I understand N days will be unpaid" ticked. */
  acceptSplit: boolean;
}

export type LeaveIssue = 'pickDates' | 'toBeforeFrom' | 'reasonRequired' | 'splitUnconfirmed';

/** Both dates are chosen and in order; the preview only runs for such a range. */
export function leaveRangeReady(d: Pick<LeaveDraft, 'typeCode' | 'fromDate' | 'toDate'>): boolean {
  return (
    d.typeCode !== '' && DATE.test(d.fromDate) && DATE.test(d.toDate) && d.toDate >= d.fromDate
  );
}

export function leaveIssues(d: LeaveDraft, preview: LeavePreview | undefined): LeaveIssue[] {
  const out: LeaveIssue[] = [];
  if (!DATE.test(d.fromDate) || !DATE.test(d.toDate)) out.push('pickDates');
  else if (d.toDate < d.fromDate) out.push('toBeforeFrom');
  if (d.typeCode === 'LOP' && d.reason.trim() === '') out.push('reasonRequired');
  if (preview && d.typeCode !== 'LOP' && preview.daysUnpaid > 0 && !d.acceptSplit)
    out.push('splitUnconfirmed');
  return out;
}

/** The body for the preview (nothing is confirmed yet) and for Send. */
export function leaveBody(d: LeaveDraft, preview?: LeavePreview): LeaveRequestCreate {
  if (d.typeCode === '') throw new Error('leave type missing');
  const reason = d.reason.trim();
  return {
    typeCode: d.typeCode,
    fromDate: d.fromDate,
    toDate: d.toDate,
    ...(reason ? { reason } : {}),
    acceptUnpaidSplit: preview
      ? d.typeCode === 'LOP' || (preview.daysUnpaid > 0 && d.acceptSplit)
      : false,
  };
}

// ---- Fix a day ------------------------------------------------------------------------------

export interface FixDraft {
  kind: RegularisationKind;
  workDate: string;
  /** Which recorded punch is wrong ("wrong time"). */
  targetPunchId: string;
  /** The punch's kind, so the typed time lands on the right side. */
  targetKind: 'in' | 'out' | '';
  arrived: string;
  left: string;
  /** The right time for "wrong time". */
  rightTime: string;
  place: string;
  reason: string;
}

export type FixIssue =
  | 'needTime'
  | 'timeRange'
  | 'needPunch'
  | 'needPlace'
  | 'needReason'
  | 'order'
  | 'dateRange';

export function timeInRange(hhmm: string): boolean {
  return TIME.test(hhmm) && hhmmToMin(hhmm) >= 240;
}

/** Days a fix can be asked for: today and the 6 days before it (PRD 4.11, 7 days). */
export function fixDateBounds(today: string): { min: string; max: string } {
  return { min: addDays(today, -6), max: today };
}

function timeIssue(v: string): FixIssue | null {
  if (v.trim() === '') return 'needTime';
  return timeInRange(v) ? null : 'timeRange';
}

export function fixIssues(d: FixDraft, today: string): FixIssue[] {
  const out: FixIssue[] = [];
  const { min, max } = fixDateBounds(today);
  if (!DATE.test(d.workDate) || d.workDate < min || d.workDate > max) out.push('dateRange');
  const push = (i: FixIssue | null) => {
    if (i && !out.includes(i)) out.push(i);
  };
  if (d.kind === 'missed_in') push(timeIssue(d.arrived));
  else if (d.kind === 'missed_out') push(timeIssue(d.left));
  else if (d.kind === 'wrong_time') {
    if (d.targetPunchId === '') out.push('needPunch');
    push(timeIssue(d.rightTime));
  } else {
    if (d.place.trim() === '') out.push('needPlace');
    push(timeIssue(d.arrived));
    push(timeIssue(d.left));
    if (!out.includes('needTime') && !out.includes('timeRange') && d.left <= d.arrived)
      out.push('order');
  }
  if (d.reason.trim() === '') out.push('needReason');
  return out;
}

export function fixBody(d: FixDraft): RegularisationCreate {
  const at = (hhmm: string) => istToEpoch(d.workDate, hhmm);
  const reason = d.reason.trim();
  switch (d.kind) {
    case 'missed_in':
      return { workDate: d.workDate, kind: d.kind, proposedInTs: at(d.arrived), reason };
    case 'missed_out':
      return { workDate: d.workDate, kind: d.kind, proposedOutTs: at(d.left), reason };
    case 'wrong_time':
      return {
        workDate: d.workDate,
        kind: d.kind,
        targetPunchId: d.targetPunchId,
        ...(d.targetKind === 'out'
          ? { proposedOutTs: at(d.rightTime) }
          : { proposedInTs: at(d.rightTime) }),
        reason,
      };
    case 'offsite_unplanned':
      return {
        workDate: d.workDate,
        kind: d.kind,
        placeName: d.place.trim(),
        proposedInTs: at(d.arrived),
        proposedOutTs: at(d.left),
        reason,
      };
  }
}
