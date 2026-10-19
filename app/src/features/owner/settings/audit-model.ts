/**
 * Audit rows in words (PRD 10.7, O-18): the fields that changed between `before` and `after`,
 * each as short text ("status: OPEN -> P"). Nested values are shown compactly, never as raw JSON
 * blocks; unchanged fields are left out.
 */

export interface ChangeLine {
  key: string;
  before: string | null;
  after: string | null;
}

function short(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => short(x) ?? '–').join(', ');
  const text = Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k} ${short(x) ?? '–'}`)
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
    .map((k) => ({ key: k, before: short(b?.[k]), after: short(a?.[k]) }));
}
