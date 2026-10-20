/**
 * Time credits ledger rows (PRD 7.17, 8.2.1): the entries a day recompute writes, and the readers
 * the balance needs. Owner-only data: nothing here is reachable from a staff route. Owner: WP-9.
 *
 * `creditStmts` is called from `planDay`, so the entries change in the same batch as the day row.
 * It only ever supersedes and inserts; an owner's adjustment is its own row and survives a recompute.
 */
import type {
  ConfirmedAway,
  CreditEntryDraft,
  CreditKind,
  CreditRules,
  CreditSourceKind,
  Id,
} from '@fs/contracts';
import { creditBalance, creditEntriesForDay } from '@fs/engine';
import { ulid } from '../lib/ulid';
import type { Computed } from './day';
import type { Ctx } from './ports';

export interface CreditEntryRow {
  id: string;
  user_id: string;
  work_date: string;
  kind: CreditKind;
  minutes: number;
  source_kind: CreditSourceKind;
  source_id: string;
  confirmed_by: string | null;
  confirmed_at: number | null;
  status: 'active' | 'superseded';
  engine_version: string;
  created_at: number;
}

export interface CreditAdjustmentRow {
  id: string;
  user_id: string;
  work_date: string;
  kind: CreditKind;
  delta_min: number;
  reason: string;
  status: 'active' | 'void';
  created_by: string;
  created_at: number;
  voided_by: string | null;
  voided_at: number | null;
  void_reason: string | null;
}

export interface CreditSettlementRow {
  id: string;
  user_id: string;
  payroll_run_id: string;
  month: string;
  balance_min: number;
  settle_min: number;
  applied_min: number;
  amount_paise: number;
  rate_json: string;
  warnings_json: string;
  status: 'draft' | 'applied' | 'void';
  decided_by: string;
  decided_at: number;
  note: string | null;
}

interface AwayRow {
  id: string;
  work_date: string;
  start_ts: number;
  end_ts: number;
  minutes: number;
  decided_by: string | null;
  opened_by: string;
}

/** The punch ids and decision an entry points at, found by the day recompute (PRD 7.17.2). */
export interface CreditDayContext {
  /** Overtime decision id, or the pre-approval or duty id when no decision exists. */
  otSourceId: string | null;
  /** Who decided the overtime; null for an automatic (pre-approved) one. */
  otConfirmedBy: string | null;
  /** `legal_d` of the day (PRD 7.17.7); 0 when "Pay legal overtime at 2x" is off. */
  legalOtMin: number;
}

const COUNTED = new Set(['accepted', 'flagged']);
const jsonList = (ids: readonly string[]) => JSON.stringify(ids);

/**
 * The statements that bring the day's ledger entries in line with the recomputed day: entries that
 * changed or disappeared are marked superseded, new ones inserted. Locked days are left alone by the
 * caller. Away entries follow the confirmed away intervals of the day.
 */
export async function creditStmts(
  ctx: Ctx,
  c: Computed,
  dayCtx: CreditDayContext,
): Promise<D1PreparedStatement[]> {
  const [existing, awayRows] = await Promise.all([
    ctx.db.all<CreditEntryRow>(
      `SELECT * FROM credit_entries
        WHERE org_id = ?org AND user_id = ? AND work_date = ? AND status = 'active'`,
      c.userId,
      c.date,
    ),
    ctx.db.all<AwayRow>(
      `SELECT id, work_date, start_ts, end_ts, minutes, decided_by, opened_by FROM away_intervals
        WHERE org_id = ?org AND user_id = ? AND work_date = ? AND state = 'confirmed'
          AND end_ts IS NOT NULL AND minutes > 0`,
      c.userId,
      c.date,
    ),
  ]);
  const counted = c.punches
    .filter((p) => COUNTED.has(p.status))
    .sort((a, b) => a.effective_ts - b.effective_ts);
  const firstIn = counted.find((p) => p.kind === 'in');
  const lastOut = [...counted].reverse().find((p) => p.kind === 'out');
  const rules: CreditRules = {
    enabled: c.creditsOn,
    otApprovedMin: c.otApprovedMin,
    lateSourceId: firstIn?.id ?? null,
    earlySourceId: lastOut?.id ?? null,
    otSourceId: dayCtx.otSourceId,
    legalOtMin: dayCtx.legalOtMin,
  };
  const away: ConfirmedAway[] = awayRows.map((a) => ({
    id: a.id as Id,
    workDate: a.work_date,
    startTs: a.start_ts,
    endTs: a.end_ts,
    minutes: a.minutes,
    confirmedBy: (a.decided_by ?? a.opened_by) as Id,
  }));
  const drafts = creditEntriesForDay(c.result, away, rules);
  const confirmedBy = (d: CreditEntryDraft): string | null =>
    d.kind === 'away'
      ? (away.find((a) => a.id === d.sourceId)?.confirmedBy ?? null)
      : d.kind === 'ot' || d.kind === 'ot_legal'
        ? dayCtx.otConfirmedBy
        : null;

  const same = (e: CreditEntryRow, d: CreditEntryDraft) =>
    e.kind === d.kind &&
    e.minutes === d.minutes &&
    e.source_id === d.sourceId &&
    e.confirmed_by === confirmedBy(d);
  const keep = new Set<string>();
  const insert: CreditEntryDraft[] = [];
  for (const d of drafts) {
    const match = existing.find((e) => !keep.has(e.id) && same(e, d));
    if (match) keep.add(match.id);
    else insert.push(d);
  }
  const now = ctx.now();
  const stmts: D1PreparedStatement[] = [];
  for (const e of existing) {
    if (!keep.has(e.id)) {
      stmts.push(ctx.db.update('credit_entries', { status: 'superseded' }, 'id = ?', e.id));
    }
  }
  for (const d of insert) {
    const by = confirmedBy(d);
    stmts.push(
      ctx.db.insert('credit_entries', {
        id: ulid(now),
        user_id: c.userId,
        work_date: c.date,
        kind: d.kind,
        minutes: d.minutes,
        source_kind: d.sourceKind,
        source_id: d.sourceId,
        confirmed_by: by,
        confirmed_at: by ? now : null,
        status: 'active',
        engine_version: c.result.version,
        created_at: now,
      }),
    );
  }
  return stmts;
}

export interface LedgerRows {
  entries: CreditEntryRow[];
  adjustments: CreditAdjustmentRow[];
  settlements: CreditSettlementRow[];
}

/** Every entry, adjustment and settlement row of some people (active and not, for the history). */
export async function loadLedgerRows(
  ctx: Ctx,
  userIds: readonly string[],
): Promise<Map<string, LedgerRows>> {
  const out = new Map<string, LedgerRows>(
    userIds.map((id) => [id, { entries: [], adjustments: [], settlements: [] }]),
  );
  if (userIds.length === 0) return out;
  const ids = jsonList(userIds);
  const [entries, adjustments, settlements] = await Promise.all([
    ctx.db.all<CreditEntryRow>(
      `SELECT * FROM credit_entries WHERE org_id = ?org AND status = 'active'
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY work_date, created_at, id`,
      ids,
    ),
    ctx.db.all<CreditAdjustmentRow>(
      `SELECT * FROM credit_adjustments WHERE org_id = ?org
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY work_date, created_at, id`,
      ids,
    ),
    ctx.db.all<CreditSettlementRow>(
      `SELECT * FROM credit_settlements WHERE org_id = ?org AND status <> 'void'
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY month, decided_at, id`,
      ids,
    ),
  ]);
  for (const e of entries) out.get(e.user_id)?.entries.push(e);
  for (const a of adjustments) out.get(a.user_id)?.adjustments.push(a);
  for (const s of settlements) out.get(s.user_id)?.settlements.push(s);
  return out;
}

/** Signed balance of one person on `asOf` (PRD 7.17.3), through the engine. */
export function balanceOf(rows: LedgerRows, asOf: string): number {
  return creditBalance(
    rows.entries.map((e) => ({ workDate: e.work_date, minutes: e.minutes, status: e.status })),
    rows.adjustments.map((a) => ({
      workDate: a.work_date,
      deltaMin: a.delta_min,
      status: a.status,
    })),
    rows.settlements.map((s) => ({ month: s.month, appliedMin: s.applied_min, status: s.status })),
    asOf,
  );
}

/** Balances of several people on `asOf`. */
export async function balancesOn(
  ctx: Ctx,
  userIds: readonly string[],
  asOf: string,
): Promise<Map<string, number>> {
  const rows = await loadLedgerRows(ctx, userIds);
  return new Map(userIds.map((id) => [id, balanceOf(rows.get(id) as LedgerRows, asOf)]));
}
