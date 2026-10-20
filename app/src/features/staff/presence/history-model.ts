/** My data -> Presence (PRD 4.18.4, S-24.4): the month's items by day. Pure. */
import { type AwayIntervalStaff, istDate, istTime, type PresenceHistory } from '@fs/contracts';

export type HistoryItem =
  | { kind: 'roll_call'; key: string; time: string; mark: 'here' | 'not_here' }
  | { kind: 'away'; key: string; time: string; away: AwayIntervalStaff }
  | { kind: 'check'; key: string; time: string; check: PresenceHistory['checks'][number] };

export interface HistoryDay {
  date: string;
  items: HistoryItem[];
}

/** The month's marks, step-outs and checks by day, newest day first, in time order inside a day. */
export function historyByDay(h: PresenceHistory): HistoryDay[] {
  const days = new Map<string, HistoryItem[]>();
  const add = (date: string, item: HistoryItem) => {
    const list = days.get(date) ?? [];
    list.push(item);
    days.set(date, list);
  };
  for (const r of h.rollCalls)
    add(r.workDate, {
      kind: 'roll_call',
      key: `r-${r.workDate}-${r.slotTime}`,
      time: r.slotTime,
      mark: r.mark,
    });
  for (const a of h.away)
    add(a.workDate, { kind: 'away', key: a.id, time: istTime(a.startTs), away: a });
  for (const c of h.checks)
    add(istDate(c.ts), { kind: 'check', key: `c-${c.ts}`, time: istTime(c.ts), check: c });
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({
      date,
      items: items.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0)),
    }));
}
