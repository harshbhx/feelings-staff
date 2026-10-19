/**
 * Half-open minute intervals `[start, end)`. Every function returns a normalised list: sorted,
 * merged where they touch or overlap, and without empty intervals.
 */
export type Iv = readonly [number, number];

export function normalize(ivs: readonly Iv[]): Iv[] {
  const sorted = ivs.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function total(ivs: readonly Iv[]): number {
  return ivs.reduce((sum, [s, e]) => sum + (e - s), 0);
}

export function intersect(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      out.push([Math.max(as, bs), Math.min(ae, be)]);
    }
  }
  return normalize(out);
}

export function subtract(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  let cur = normalize(a);
  for (const [bs, be] of b) {
    const next: Iv[] = [];
    for (const [s, e] of cur) {
      next.push([s, Math.min(e, bs)], [Math.max(s, be), e]);
    }
    cur = normalize(next);
  }
  return cur;
}
