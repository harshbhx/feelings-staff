/** Small helpers shared by the payslip stages (not part of the public API). */
import { formatNum } from '../money';

/** The value at `key`, created with `init` on first use. */
export function grouped<T>(map: Map<string, T>, key: string, init: () => T): T {
  let t = map.get(key);
  if (t === undefined) {
    t = init();
    map.set(key, t);
  }
  return t;
}

/** "1 day", "1.5 days". */
export const plural = (n: number, word: string) => `${formatNum(n)} ${word}${n === 1 ? '' : 's'}`;
