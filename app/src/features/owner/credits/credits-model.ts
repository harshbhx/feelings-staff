/**
 * Time credits view models (PRD 4.19, 7.17): signed minutes in words, the rough rupee estimate, the
 * Credits list filter and sort, the person ledger's order, history and carried-over part, and the
 * Settle credits stepper maths. Pure functions, so the screens stay short and the rules are tested.
 */
import type {
  CreditHistoryItem,
  CreditLedgerKind,
  CreditLedgerRow,
  CreditsRow,
  CreditsSettleRow,
} from '@fs/contracts';
import type { BadgeTone, IconName } from '@fs/ui';

// ---- Minutes and money in words -------------------------------------------------------------

/** `+50`, `−130`, `0`; the minus is U+2212, as in money. */
export function signedMin(min: number): string {
  if (min > 0) return `+${min}`;
  if (min < 0) return `−${Math.abs(min)}`;
  return '0';
}

/** Whole rupees, half up, from signed paise (the sign goes into the words): 4480 -> 45, -9630 -> 96. */
export function roughRupees(paise: number): number {
  return Math.round(Math.abs(paise) / 100);
}

/** Which sentence reads an estimate: "worth about ₹45", "might cut around ₹96", or nothing. */
export type EstimateWord = 'worth' | 'cut' | 'none';

export function estimateWord(paise: number, min: number): EstimateWord {
  // A balance that rounds to ₹0 reads as nothing, not "about ₹0".
  if (min > 0 && roughRupees(paise) !== 0) return 'worth';
  if (min < 0 && roughRupees(paise) !== 0) return 'cut';
  return 'none';
}

// ---- Credits list ---------------------------------------------------------------------------

export type BalanceFilter = 'all' | 'plus' | 'minus';
export type BalanceSort = 'minus' | 'plus' | 'name';

export const BALANCE_FILTERS: readonly BalanceFilter[] = ['all', 'plus', 'minus'];
export const BALANCE_SORTS: readonly BalanceSort[] = ['minus', 'plus', 'name'];

export function balanceCounts(rows: readonly CreditsRow[]): Record<BalanceFilter, number> {
  return {
    all: rows.length,
    plus: rows.filter((r) => r.balanceMin > 0).length,
    minus: rows.filter((r) => r.balanceMin < 0).length,
  };
}

/** Filter by sign, then sort: most minus first (default), most plus first, or by name. */
export function visibleRows(
  rows: readonly CreditsRow[],
  filter: BalanceFilter,
  sort: BalanceSort,
): CreditsRow[] {
  const kept = rows.filter((r) =>
    filter === 'plus' ? r.balanceMin > 0 : filter === 'minus' ? r.balanceMin < 0 : true,
  );
  const byName = (a: CreditsRow, b: CreditsRow) => a.name.localeCompare(b.name);
  return kept.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    const d = sort === 'minus' ? a.balanceMin - b.balanceMin : b.balanceMin - a.balanceMin;
    return d !== 0 ? d : byName(a, b);
  });
}

// ---- Person ledger --------------------------------------------------------------------------

/** Kind chips: tint + icon + word (PRD 12.3); `adjusted` marks an entry the owner changed. */
export const KIND_BADGE: Record<
  CreditLedgerKind | 'adjusted',
  { tone: BadgeTone; icon: IconName }
> = {
  late: { tone: 'warning', icon: 'clock' },
  early: { tone: 'warning', icon: 'sign-out' },
  away: { tone: 'info', icon: 'map-pin' },
  ot: { tone: 'success', icon: 'plus' },
  ot_legal: { tone: 'success', icon: 'plus-square' },
  settled: { tone: 'neutral', icon: 'currency-inr' },
  adjusted: { tone: 'outline', icon: 'pencil-simple' },
};

/** What a row adds to the balance: the entry and its active adjustments. */
export const rowTotal = (r: CreditLedgerRow): number => r.minutes + r.adjustedMin;

/**
 * Newest first on phones, date order on desktop (PRD 4.19.2). The sort is stable, so rows of one day
 * keep the server's kind order.
 */
export function orderRows(items: readonly CreditLedgerRow[], newestFirst: boolean) {
  return [...items].sort((a, b) =>
    newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
  );
}

/** Adjustments still in force: every `adjustment` item without a `void` for the same id. */
export function activeAdjustments(history: readonly CreditHistoryItem[]): CreditHistoryItem[] {
  const voided = new Set(history.filter((h) => h.kind === 'void').map((h) => h.adjustmentId ?? ''));
  return history.filter((h) => h.kind === 'adjustment' && !voided.has(h.adjustmentId ?? ''));
}

/** Whether the owner may adjust this row: every entry kind, never a settlement. */
export const canAdjust = (r: CreditLedgerRow): boolean => r.kind !== 'settled';

/**
 * The part of the balance carried over from earlier months: the balance less this month's rows.
 * Null when this month's rows are not all loaded yet (a later page may hold some).
 */
export function carriedOver(
  items: readonly CreditLedgerRow[],
  balanceMin: number,
  today: string,
  allLoaded: boolean,
): number | null {
  const start = `${today.slice(0, 7)}-01`;
  const complete = allLoaded || items.some((r) => r.date < start);
  if (!complete) return null;
  const thisMonth = items.filter((r) => r.date >= start).reduce((s, r) => s + rowTotal(r), 0);
  return balanceMin - thisMonth;
}

// ---- Adjust form ----------------------------------------------------------------------------

export type Direction = 'add' | 'take';

export interface AdjustDraft {
  direction: Direction;
  /** Whole minutes as typed. */
  minutes: string;
  reason: string;
}

/** The signed change, or null while the form is not complete (minutes 1-1440, a reason). */
export function adjustDelta(d: AdjustDraft): number | null {
  const n = Number(d.minutes.trim());
  if (!Number.isInteger(n) || n <= 0 || n > 1440) return null;
  if (d.reason.trim().length < 3) return null;
  return d.direction === 'add' ? n : -n;
}

/** The form for an existing signed change. */
export function draftFor(deltaMin: number, reason = ''): AdjustDraft {
  return {
    direction: deltaMin < 0 ? 'take' : 'add',
    minutes: deltaMin === 0 ? '' : String(Math.abs(deltaMin)),
    reason,
  };
}

// ---- Settle credits -------------------------------------------------------------------------

export const SETTLE_STEP = 5;

/** A typed or stepped size, kept between 0 and the balance and on the balance's side. */
export function clampSettle(balanceMin: number, magnitude: number): number {
  if (!Number.isFinite(magnitude)) return 0;
  const m = Math.min(Math.abs(balanceMin), Math.max(0, Math.round(magnitude)));
  return balanceMin < 0 && m > 0 ? -m : m;
}

/** A per-minute rate as a fraction of paise over minutes, so estimates round once and exactly. */
export interface PerMinute {
  paise: number;
  min: number;
}

/**
 * The rate for an estimate while a choice is not saved yet: from the saved settlement of the run
 * when there is one (the run month's rate), else from the Credits overview (the current rate).
 * Null when neither is known.
 */
export function perMinute(
  row: CreditsSettleRow,
  overview: Pick<CreditsRow, 'balanceMin' | 'estimatePaise'> | undefined,
): PerMinute | null {
  if (row.appliedMin !== 0)
    return { paise: Math.abs(row.amountPaise), min: Math.abs(row.appliedMin) };
  if (overview && overview.balanceMin !== 0 && overview.estimatePaise !== 0)
    return { paise: Math.abs(overview.estimatePaise), min: Math.abs(overview.balanceMin) };
  return null;
}

/** Signed paise for signed minutes at a rate, one rounding (half up on the size). */
export function estimateFor(min: number, rate: PerMinute): number {
  const v = Math.round((Math.abs(min) * rate.paise) / rate.min);
  return min < 0 ? -v : v;
}

/** Minutes the 50% cap kept on the balance (the note "20 min stay on the balance"). */
export function capKept(row: Pick<CreditsSettleRow, 'settleMin' | 'appliedMin'>): number {
  return Math.max(0, Math.abs(row.settleMin) - Math.abs(row.appliedMin));
}

export interface SettleSummary {
  people: number;
  settled: number;
  minutes: number;
  amountPaise: number;
}

/** The run screen's one line: who has a balance, how many are settled and for how much. */
export function settleSummary(rows: readonly CreditsSettleRow[]): SettleSummary {
  const settled = rows.filter((r) => r.appliedMin !== 0);
  return {
    people: rows.length,
    settled: settled.length,
    minutes: settled.reduce((s, r) => s + r.appliedMin, 0),
    amountPaise: settled.reduce((s, r) => s + r.amountPaise, 0),
  };
}
