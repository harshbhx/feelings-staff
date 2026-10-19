/**
 * Day detail and owner override (PRD 4.12 owner override, 5.2 day detail, O-06): the shift line,
 * the audit trail in words, and the override request (status, punch edits, required reason).
 */
import type {
  AuditEntryView,
  DayOverrideRequest,
  LeaveCode,
  OverrideStatus,
  OwnerPunchView,
  PunchEdit,
  ScheduleView,
} from '@fs/contracts';
import { istTime, istToEpoch } from '@fs/contracts';

/** "10:00–20:00" or "10:00–14:00, 17:00–21:00". */
export function shiftTimes(schedule: ScheduleView): string {
  return schedule.segments.map((s) => `${s.start}–${s.end}`).join(', ');
}

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number' && v > 1_000_000_000_000) return istTime(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Changed fields between `before` and `after` snapshots ("status: A → P"). */
export function auditChanges(entry: Pick<AuditEntryView, 'before' | 'after'>): AuditChange[] {
  const b = (entry.before ?? {}) as Record<string, unknown>;
  const a = (entry.after ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || typeof a !== 'object') return [];
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ field: k, before: show(b[k]), after: show(a[k]) }));
}

export interface PunchDraft {
  /** Existing punch id, or null for an added one. */
  id: string | null;
  kind: 'in' | 'out';
  /** `HH:MM` as typed. */
  time: string;
  /** The time it had when the sheet opened (for existing punches). */
  original: string | null;
  removed: boolean;
}

export interface OverrideDraft {
  /** null = keep working it out from the punches. */
  status: OverrideStatus | null;
  leaveCode: LeaveCode | null;
  punches: PunchDraft[];
  reason: string;
}

export function draftFromDay(punches: readonly OwnerPunchView[]): OverrideDraft {
  return {
    status: null,
    leaveCode: null,
    punches: punches
      .filter((p) => (p.kind === 'in' || p.kind === 'out') && p.status !== 'superseded')
      .map((p) => ({
        id: p.id,
        kind: p.kind as 'in' | 'out',
        time: istTime(p.effectiveTs),
        original: istTime(p.effectiveTs),
        removed: false,
      })),
    reason: '',
  };
}

export type OverrideProblem = 'reason' | 'nothing' | 'time' | null;

/** The request, or why it cannot be sent yet (O-06.1: overrides need a reason). */
export function overrideRequest(
  draft: OverrideDraft,
  workDate: string,
): { request: DayOverrideRequest; problem: null } | { request: null; problem: OverrideProblem } {
  const edits: PunchEdit[] = [];
  for (const p of draft.punches) {
    if (!/^\d{2}:\d{2}$/.test(p.time)) return { request: null, problem: 'time' };
    const ts = istToEpoch(workDate, p.time);
    if (p.id === null) {
      if (!p.removed) edits.push({ op: 'add', kind: p.kind, ts });
    } else if (p.removed) edits.push({ op: 'delete', punchId: p.id });
    else if (p.time !== p.original) edits.push({ op: 'edit', punchId: p.id, ts });
  }
  if (draft.status === null && edits.length === 0) return { request: null, problem: 'nothing' };
  const reason = draft.reason.trim();
  if (!reason) return { request: null, problem: 'reason' };
  const request: DayOverrideRequest = { reason };
  if (draft.status !== null) request.status = draft.status;
  if (draft.status === 'L' && draft.leaveCode) request.leaveCode = draft.leaveCode;
  if (edits.length > 0) request.punches = edits;
  return { request, problem: null };
}
