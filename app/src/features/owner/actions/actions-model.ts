/**
 * Needs-action view model (PRD 4.12, O-04): one queue, newest first, grouped by type in a fixed
 * order, with filter chips and counts. Bulk approve is for several items of one type, never devices
 * (and not for off-site or advance requests, which need a choice each).
 */
import type { ActionItem, ActionsView, ActionType } from '@fs/contracts';

/** Types that can be approved together (PRD 4.12; the API's BulkDecideRequest). */
export type BulkType =
  | 'flagged_punch'
  | 'pending_punch'
  | 'leave_request'
  | 'regularisation'
  | 'overtime'
  | 'auto_closed';

export const TYPE_ORDER: readonly ActionType[] = [
  'new_device',
  'pending_punch',
  'offsite_request',
  'flagged_punch',
  'leave_request',
  'regularisation',
  'overtime',
  'auto_closed',
  'advance_request',
];

const BULK: ReadonlySet<ActionType> = new Set<BulkType>([
  'flagged_punch',
  'pending_punch',
  'leave_request',
  'regularisation',
  'overtime',
  'auto_closed',
]);

export function canBulk(type: ActionType): type is BulkType {
  return BULK.has(type);
}

export interface ActionGroup {
  type: ActionType;
  items: ActionItem[];
}

/** Items grouped by type (fixed order), newest first inside each group. */
export function groupActions(
  items: readonly ActionItem[],
  filter: ActionType | null,
): ActionGroup[] {
  const groups: ActionGroup[] = [];
  for (const type of TYPE_ORDER) {
    if (filter && filter !== type) continue;
    const list = items.filter((i) => i.type === type).sort((a, b) => b.createdAt - a.createdAt);
    if (list.length > 0) groups.push({ type, items: list });
  }
  return groups;
}

export interface FilterChip {
  type: ActionType;
  count: number;
}

/** Chips for the types that have open items, with their counts. */
export function filterChips(view: ActionsView): FilterChip[] {
  return TYPE_ORDER.map((type) => ({ type, count: view.counts[type] ?? 0 })).filter(
    (c) => c.count > 0,
  );
}

/** Open items across every type: the badge on the tab and on the app icon (O-04.4). */
export function openActionCount(view: ActionsView | undefined): number {
  if (!view) return 0;
  return Object.values(view.counts).reduce((s, n) => s + (n ?? 0), 0);
}

/** Overtime "Approve part": choices in steps of the overtime block, up to the candidate minutes. */
export function overtimeSteps(candidateMin: number, blockMin = 15): number[] {
  const steps: number[] = [];
  for (let m = blockMin; m <= candidateMin; m += blockMin) steps.push(m);
  return steps;
}

/** Clamp a stepper value to a block multiple between one block and the candidate. */
export function clampOvertime(value: number, candidateMin: number, blockMin = 15): number {
  const max = Math.floor(candidateMin / blockMin) * blockMin;
  const snapped = Math.round(value / blockMin) * blockMin;
  return Math.min(max, Math.max(blockMin, snapped));
}

/** Selection is per type: picking an item of another type starts a new selection. */
export function toggleSelected(
  selection: { type: BulkType | null; ids: ReadonlySet<string> },
  item: ActionItem,
): { type: BulkType | null; ids: Set<string> } {
  if (!canBulk(item.type)) return { type: selection.type, ids: new Set(selection.ids) };
  if (selection.type !== item.type) return { type: item.type, ids: new Set([item.id]) };
  const ids = new Set(selection.ids);
  if (ids.has(item.id)) ids.delete(item.id);
  else ids.add(item.id);
  return { type: ids.size > 0 ? item.type : null, ids };
}

/** Items older than 48 h show a quiet "waiting 3 days" note (PRD 4.12, never a nag). */
export function waitingDays(createdAt: number, now: number): number {
  const h = (now - createdAt) / 3_600_000;
  return h >= 48 ? Math.floor(h / 24) : 0;
}
