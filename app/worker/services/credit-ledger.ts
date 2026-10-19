/**
 * The Time credits ledger as the owner reads it (PRD 4.19.2, 9.4): one row per entry with its
 * adjustments and history, settlements as `settled` rows, and a running balance. Also the per-minute
 * rate used to show "worth about Rs 45" next to a balance. Owner only. Owner: WP-9.
 */
import {
  type CreditAdjustment,
  type CreditHistoryItem,
  type CreditKind,
  type CreditLedgerKind,
  type CreditLedgerRow,
  daysInMonth,
  type MinuteRate,
  type OrgSettings,
  type PersonPay,
  weekday,
} from '@fs/contracts';
import { creditRate, salaryParts, templateMinutes } from '@fs/engine';
import { json } from '../db';
import type { CreditAdjustmentRow, LedgerRows } from './credit-entries';
import type { Ctx } from './ports';

export const monthEndOf = (month: string) =>
  `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

export const KIND_ORDER: Record<CreditLedgerKind, number> = {
  late: 0,
  early: 1,
  away: 2,
  ot: 3,
  settled: 4,
};

export function adjustmentView(a: CreditAdjustmentRow): CreditAdjustment {
  return {
    id: a.id,
    userId: a.user_id,
    workDate: a.work_date,
    kind: a.kind,
    deltaMin: a.delta_min,
    reason: a.reason,
    status: a.status,
    createdBy: a.created_by,
    createdAt: a.created_at,
    voidedBy: a.voided_by,
    voidedAt: a.voided_at,
    voidReason: a.void_reason,
  };
}

type Who = { id: string; name: string };
const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

/** Ledger rows in date order with the running balance (PRD 9.4). Settlement rows are `settled`. */
export function buildLedger(
  rows: LedgerRows,
  names: ReadonlyMap<string, string>,
): CreditLedgerRow[] {
  const who = (id: string | null): Who | null =>
    id && names.has(id) ? { id, name: names.get(id) as string } : null;
  const byKey = new Map<string, CreditAdjustmentRow[]>();
  for (const a of rows.adjustments) {
    const k = `${a.work_date}|${a.kind}`;
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }
  const claimed = new Set<string>();

  const historyOf = (original: number | null, at: number, adj: CreditAdjustmentRow[]) => {
    const items: CreditHistoryItem[] = [];
    if (adj.length === 0) return items;
    if (original !== null) {
      items.push({
        kind: 'original',
        minutes: original,
        reason: null,
        by: null,
        at,
        adjustmentId: null,
      });
    }
    for (const a of adj) {
      items.push({
        kind: 'adjustment',
        minutes: a.delta_min,
        reason: a.reason,
        by: who(a.created_by),
        at: a.created_at,
        adjustmentId: a.id,
      });
      if (a.status === 'void') {
        items.push({
          kind: 'void',
          minutes: -a.delta_min,
          reason: a.void_reason,
          by: who(a.voided_by),
          at: a.voided_at ?? a.created_at,
          adjustmentId: a.id,
        });
      }
    }
    return items;
  };
  const activeSum = (adj: CreditAdjustmentRow[]) =>
    adj.filter((a) => a.status === 'active').reduce((s, a) => s + a.delta_min, 0);

  interface Built extends Omit<CreditLedgerRow, 'runningBalanceMin'> {
    order: number;
  }
  const built: Built[] = [];
  for (const e of rows.entries) {
    const key = `${e.work_date}|${e.kind}`;
    const adj = claimed.has(key) ? [] : (byKey.get(key) ?? []);
    claimed.add(key);
    const by = who(e.confirmed_by);
    built.push({
      date: e.work_date,
      kind: e.kind,
      minutes: e.minutes,
      adjustedMin: activeSum(adj),
      source: { kind: e.source_kind, id: e.source_id },
      ...(by ? { confirmedBy: by } : {}),
      history: historyOf(e.minutes, e.created_at, adj),
      order: KIND_ORDER[e.kind],
    });
  }
  for (const [key, adj] of byKey) {
    if (claimed.has(key)) continue;
    const first = adj[0] as CreditAdjustmentRow;
    built.push({
      date: first.work_date,
      kind: first.kind,
      minutes: 0,
      adjustedMin: activeSum(adj),
      source: { kind: 'adjustment', id: first.id },
      history: historyOf(null, first.created_at, adj),
      order: KIND_ORDER[first.kind],
    });
  }
  for (const s of rows.settlements) {
    if (s.status !== 'applied') continue;
    const by = who(s.decided_by);
    built.push({
      date: monthEndOf(s.month),
      kind: 'settled',
      minutes: -s.applied_min,
      adjustedMin: 0,
      source: { kind: 'settlement', id: s.id },
      ...(by ? { confirmedBy: by } : {}),
      history: [],
      order: KIND_ORDER.settled,
    });
  }
  built.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let running = 0;
  return built.map(({ order: _order, ...row }) => {
    running += row.minutes + row.adjustedMin;
    return { ...row, runningBalanceMin: running };
  });
}

/** Ledger filters of `GET /owner/credits/:userId/ledger`. */
export interface LedgerFilter {
  from?: string | undefined;
  to?: string | undefined;
  kind?: CreditLedgerKind | undefined;
  unsettled?: boolean | undefined;
}

/** Apply the filters; "unsettled" keeps rows after the last settled period end, never settled rows. */
export function filterLedger(
  all: CreditLedgerRow[],
  f: LedgerFilter,
  lastSettledEnd: string | null,
): CreditLedgerRow[] {
  return all.filter(
    (r) =>
      (f.from === undefined || r.date >= f.from) &&
      (f.to === undefined || r.date <= f.to) &&
      (f.kind === undefined || r.kind === f.kind) &&
      (!f.unsettled ||
        (r.kind !== 'settled' && (lastSettledEnd === null || r.date > lastSettledEnd))),
  );
}

export const kindLabel = (k: CreditKind | 'settled'): string =>
  ({ late: 'Late', early: 'Early leave', away: 'Away', ot: 'Overtime', settled: 'Settled' })[k];

// ---- Per-minute rate ----------------------------------------------------------------------------

interface RateRow {
  user_id: string;
  join_date: string;
  exit_date: string | null;
  week_off_dow: number | null;
  divisor_override: PersonPay['divisor'] | null;
  segments_json: string | null;
  break_min: number | null;
}

/**
 * The 1x rate of each person for display (PRD 7.17.4): the salary in effect at the end of `month`
 * over the standard day of the default template. People without a salary are left out.
 */
export async function ratesFor(
  ctx: Ctx,
  userIds: readonly string[],
  month: string,
  settings: OrgSettings,
): Promise<Map<string, MinuteRate>> {
  const out = new Map<string, MinuteRate>();
  if (userIds.length === 0) return out;
  const ids = jsonIds(userIds);
  const [people, history] = await Promise.all([
    ctx.db.all<RateRow>(
      `SELECT p.user_id, p.join_date, p.exit_date, p.week_off_dow, p.divisor_override,
              t.segments_json, t.break_min
         FROM staff_profiles p LEFT JOIN shift_templates t ON t.id = p.default_template_id
        WHERE p.org_id = ?org AND p.user_id IN (SELECT value FROM json_each(?))`,
      ids,
    ),
    ctx.db.all<{
      user_id: string;
      effective_from: string;
      salary_type: 'monthly' | 'daily';
      amount_paise: number;
    }>(
      `SELECT user_id, effective_from, salary_type, amount_paise FROM salary_history
        WHERE org_id = ?org AND effective_from <= ? AND user_id IN (SELECT value FROM json_each(?))`,
      monthEndOf(month),
      ids,
    ),
  ]);
  const days = Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  for (const p of people) {
    const parts = salaryParts(
      history
        .filter((h) => h.user_id === p.user_id)
        .map((h) => ({
          effectiveFrom: h.effective_from,
          type: h.salary_type,
          amountPaise: h.amount_paise,
        })),
      month,
    );
    if (parts.length === 0) continue;
    const stdMin =
      templateMinutes({
        segments: json(p.segments_json, [] as { start: string; end: string }[]),
        breakMin: p.break_min ?? 0,
      }) || 540;
    const person: PersonPay = {
      userId: p.user_id,
      joinDate: p.join_date,
      exitDate: p.exit_date,
      salaryParts: parts,
      divisor: p.divisor_override ?? settings.pay.divisor,
      otRate: settings.overtime.rate,
      stdMin,
      workingDays: days.filter((d) => weekday(d) !== p.week_off_dow).length,
    };
    out.set(p.user_id, creditRate(person, month));
  }
  return out;
}
