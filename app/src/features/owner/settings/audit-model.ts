/**
 * Audit rows in words (PRD 10.7, O-18): the fields that changed between `before` and `after`, each
 * as short text with a readable name ("amount: ₹3,000", "status: OPEN → P"). Money in paise reads as
 * rupees, timestamps as IST date and time; nested values stay compact, never raw JSON blocks.
 */
import { formatRupees, istDate, istTime } from '@fs/contracts';

export interface ChangeLine {
  key: string;
  before: string | null;
  after: string | null;
}

/** "amountPaise" -> "amount", "outTs" -> "out", "blockMin" -> "block min". */
export function fieldName(key: string): string {
  return key
    .replace(/(Paise|Ts|At)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/** Fallback for an action without a translation: "device.approve" -> "Device approve". */
export function actionWords(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function short(v: unknown, key = ''): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && /Paise$/.test(key)) return formatRupees(v, { whole: true });
  if (typeof v === 'number' && /(Ts|At)$/.test(key) && v > 1e12)
    return `${istDate(v)} ${istTime(v)}`;
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => short(x) ?? '–').join(', ');
  const text = Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${fieldName(k)} ${short(x, k) ?? '–'}`)
    .join(', ');
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function describeChange(before: unknown, after: unknown): ChangeLine[] {
  const b = asRecord(before);
  const a = asRecord(after);
  if (!b && !a) {
    if (before === after || (before == null && after == null)) return [];
    return [{ key: '', before: short(before), after: short(after) }];
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  return keys
    .filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]))
    .map((k) => ({ key: fieldName(k), before: short(b?.[k], k), after: short(a?.[k], k) }));
}
