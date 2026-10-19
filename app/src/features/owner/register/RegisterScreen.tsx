/**
 * Register (PRD 5.2, O-05). One real table on every size: staff x days, sticky header row and first
 * column, each cell a letter + icon + tint linking to the day, row totals from the engine, arrow
 * keys move between cells. Future days stay narrow and the grid opens scrolled to today, so a phone
 * shows the last week for everyone at once (WP-10). A month summary sits on top; on a phone a name
 * opens that person's month as week strips.
 */
import type { RegisterView } from '@fs/contracts';
import { istDate, weekday } from '@fs/contracts';
import {
  Badge,
  Banner,
  Button,
  Icon,
  IconButton,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useRegister } from '../api/attendance';
import { Empty, QueryView } from '../components/states';
import { dayLabel, days, monthLabel } from '../lib/format';
import { CHIP_ICON, type ChipStatus, LATE_META, TINT } from '../lib/status';
import { useOwnerTitle } from '../shell/chrome';
import {
  type CellModel,
  cellDetail,
  cellModel,
  monthNav,
  monthTotals,
  type RegisterRow,
  TOTAL_COLUMNS,
  type TotalColumn,
  totalValue,
  weekStrips,
} from './register-model';

export function RegisterScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const today = istDate(Date.now());
  const current = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '')
    ? (params.get('month') as string)
    : current;
  const person = params.get('user');
  const query = useRegister(month);
  const nav = monthNav(month, current);
  useOwnerTitle(null);

  const go = (m: string) => {
    const next = new URLSearchParams(params);
    next.set('month', m);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex items-center gap-2">
        <IconButton
          icon="caret-left"
          label={t('owner:register.prevMonth')}
          onClick={() => go(nav.prev)}
        />
        <h2 className="min-w-44 text-center font-bold text-lg text-text" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <IconButton
          icon="caret-right"
          label={t('owner:register.nextMonth')}
          onClick={() => nav.next && go(nav.next)}
          disabled={!nav.next}
        />
      </div>
      <QueryView
        query={query}
        skeleton={<GridSkeleton />}
        isEmpty={(v) => v.rows.length === 0}
        empty={<Empty>{t('owner:register.empty')}</Empty>}
      >
        {(view) => (
          <>
            {view.locked ? <Banner icon="lock">{t('owner:register.locked')}</Banner> : null}
            {person ? (
              <div className="xl:hidden">
                <PersonMonth view={view} userId={person} />
              </div>
            ) : null}
            <div className={person ? 'hidden xl:grid xl:gap-5' : 'grid gap-5'}>
              <MonthSummary view={view} />
              <Grid view={view} today={today} />
            </div>
            <Legend />
          </>
        )}
      </QueryView>
    </div>
  );
}

function useCellText() {
  const { t } = useTranslation();
  return (name: string, c: CellModel) => {
    if (!c.meta) return `${name}, ${dayLabel(c.date)}: ${t('owner:register.future')}`;
    const status = t(c.meta.labelKey);
    const extra = cellDetail(c.cell).map((p) => t(p.key, p.values));
    return [t('owner:register.dayLink', { name, date: dayLabel(c.date), status }), ...extra].join(
      ' · ',
    );
  };
}

function CellMark({ c, size = 'grid' }: { c: CellModel; size?: 'grid' | 'strip' }) {
  if (!c.meta) return null;
  const chip: ChipStatus = c.meta.chip;
  const icon = c.late && chip === 'present' ? CHIP_ICON[LATE_META.chip] : CHIP_ICON[chip];
  return (
    <span
      className={`grid place-items-center rounded-sm ${TINT[chip]} ${size === 'grid' ? 'h-11 w-9 content-center gap-0.5' : 'h-12 w-full content-center gap-0.5'}`}
    >
      <Icon name={icon} className={`size-3.5 ${c.late && chip === 'present' ? 'text-late' : ''}`} />
      <span className="font-bold text-xs leading-none" aria-hidden="true">
        {c.meta.letter}
      </span>
    </span>
  );
}

function Grid({ view, today }: { view: RegisterView; today: string }) {
  const { t } = useTranslation();
  const cellText = useCellText();
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const [params, setParams] = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const openPerson = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('user', id);
    setParams(next);
  };

  // Open on today: on a phone the last week shows for everyone; past days scroll back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per month shown
  useLayoutEffect(() => {
    const el = box.current;
    const th = el?.querySelector<HTMLElement>('th[data-today]');
    const first = el?.querySelector<HTMLElement>('thead th');
    if (!el || !th || !first) return;
    const end = th.offsetLeft + th.offsetWidth + 2 * 28;
    el.scrollLeft = Math.max(0, end - el.clientWidth);
  }, [view.month]);
  const rows = view.rows.length;
  const cols = view.dates.length;

  // Arrow keys move between day cells (future days are skipped); Home and End jump along the row.
  const move = (e: KeyboardEvent, r: number, c: number) => {
    const steps: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    let target: [number, number] | null = null;
    if (e.key === 'Home' || e.key === 'End') {
      const dir = e.key === 'Home' ? 1 : -1;
      for (let x = e.key === 'Home' ? 0 : cols - 1; x >= 0 && x < cols; x += dir)
        if (document.getElementById(`reg-${r}-${x}`)) {
          target = [r, x];
          break;
        }
    } else {
      const step = steps[e.key];
      if (!step) return;
      let [y, x] = [r + step[0], c + step[1]];
      while (y >= 0 && y < rows && x >= 0 && x < cols) {
        if (document.getElementById(`reg-${y}-${x}`)) {
          target = [y, x];
          break;
        }
        y += step[0];
        x += step[1];
      }
    }
    e.preventDefault();
    if (!target) return;
    setFocus(target);
    document.getElementById(`reg-${target[0]}-${target[1]}`)?.focus();
  };

  return (
    <div
      ref={box}
      className="relative overflow-auto rounded-md border border-border xl:max-h-[calc(100dvh-14rem)]"
    >
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          {t('owner:register.caption', { month: monthLabel(view.month) })}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 w-28 min-w-28 border-border border-r border-b bg-bg px-3 py-2 text-left font-semibold text-text-muted text-xs xl:w-auto xl:min-w-44"
            >
              {t('owner:register.staffColumn')}
            </th>
            {view.dates.map((d) => {
              const isToday = d === today;
              const sunday = weekday(d) === 0;
              const future = d > today;
              return (
                <th
                  key={d}
                  scope="col"
                  data-today={isToday ? '' : undefined}
                  className={`sticky top-0 z-20 border-border border-b px-0.5 py-1.5 text-center font-semibold text-xs ${future ? 'w-7' : 'w-10'} ${sunday ? 'bg-bg-soft' : 'bg-bg'} ${isToday ? 'text-text' : 'text-text-muted'}`}
                  aria-label={dayLabel(d)}
                >
                  <span className="block leading-tight">{Number(d.slice(8))}</span>
                  <span className="block font-normal leading-tight" aria-hidden="true">
                    {dayLabel(d).slice(0, 2)}
                  </span>
                  {isToday ? (
                    <span className="mx-auto mt-0.5 block h-0.5 w-4 rounded-full bg-text" />
                  ) : null}
                </th>
              );
            })}
            {TOTAL_COLUMNS.map((col, i) => (
              <th
                key={col}
                scope="col"
                className={`sticky top-0 z-20 border-border border-b bg-bg px-2 py-2 text-right font-semibold text-text-muted text-xs ${i === 0 ? 'border-l' : ''}`}
              >
                <abbr title={t(`owner:register.totalsLong.${col}`)} className="no-underline">
                  {t(`owner:register.totals.${col}`)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, r) => (
            <tr key={row.user.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-28 border-border border-r border-b bg-bg px-3 py-1 text-left font-bold text-text xl:max-w-none"
              >
                <button
                  type="button"
                  onClick={() => openPerson(row.user.id)}
                  className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center rounded-sm px-1 text-left xl:hidden"
                >
                  <span className="block truncate">{row.user.name}</span>
                  <span className="sr-only">{t('owner:register.openMonth')}</span>
                </button>
                <span className="hidden truncate xl:block">{row.user.name}</span>
                {row.user.designation ? (
                  <span className="hidden truncate font-normal text-text-muted text-xs xl:block">
                    {row.user.designation}
                  </span>
                ) : null}
              </th>
              {row.cells.map((cell, c) => {
                const date = view.dates[c] ?? '';
                const m = cellModel(date, cell);
                const label = cellText(row.user.name, m);
                const active = focus[0] === r && focus[1] === c;
                return (
                  <td key={date} className="border-border border-b px-0.5 py-0.5 text-center">
                    {m.meta ? (
                      <Link
                        id={`reg-${r}-${c}`}
                        to={`/o/register/${row.user.id}/${date}`}
                        tabIndex={active ? 0 : -1}
                        onFocus={() => setFocus([r, c])}
                        onKeyDown={(e) => move(e, r, c)}
                        title={label}
                        className="relative inline-block rounded-sm"
                      >
                        <CellMark c={m} />
                        <span className="sr-only">{label}</span>
                        {m.flagged || m.pending || m.edited ? (
                          <span
                            aria-hidden="true"
                            className="-top-0.5 -right-0.5 absolute size-2 rounded-full border border-bg bg-accent"
                          />
                        ) : null}
                      </Link>
                    ) : (
                      <span className="inline-block h-11 w-6">
                        <span className="sr-only">{label}</span>
                      </span>
                    )}
                  </td>
                );
              })}
              {TOTAL_COLUMNS.map((col, i) => (
                <td
                  key={col}
                  className={`border-border border-b px-2 text-right font-semibold text-text tabular-nums ${i === 0 ? 'border-l' : ''}`}
                >
                  {col === 'otHours' ? totalValue(row, col).toFixed(1) : days(totalValue(row, col))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Strip({
  row,
  strip,
  name,
}: {
  row: RegisterRow;
  strip: ReturnType<typeof weekStrips>[number];
  name: string;
}) {
  const cellText = useCellText();
  return (
    <ol className="grid grid-cols-7 gap-1">
      {strip.days.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: seven fixed weekday slots
        <li key={i} className="grid gap-0.5 text-center">
          {d ? (
            <>
              <span className="text-text-muted text-xs tabular-nums" aria-hidden="true">
                {Number(d.date.slice(8))}
              </span>
              {d.meta ? (
                <Link
                  to={`/o/register/${row.user.id}/${d.date}`}
                  className="relative block rounded-sm"
                >
                  <CellMark c={d} size="strip" />
                  <span className="sr-only">{cellText(name, d)}</span>
                  {d.flagged || d.pending || d.edited ? (
                    <span
                      aria-hidden="true"
                      className="-top-0.5 -right-0.5 absolute size-2 rounded-full border border-bg bg-accent"
                    />
                  ) : null}
                </Link>
              ) : (
                <span className="block h-12 rounded-sm border border-border border-dashed">
                  <span className="sr-only">{cellText(name, d)}</span>
                </span>
              )}
            </>
          ) : (
            <span className="block h-[4.25rem]" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

function rowTotals(row: RegisterRow): Record<TotalColumn, number> {
  return Object.fromEntries(TOTAL_COLUMNS.map((c) => [c, totalValue(row, c)])) as Record<
    TotalColumn,
    number
  >;
}

const TOTAL_STATUS: Record<TotalColumn, 'present' | 'half' | 'absent' | 'leave' | 'late'> = {
  present: 'present',
  half: 'half',
  absent: 'absent',
  leave: 'leave',
  lateMin: 'late',
  otHours: 'present',
  lop: 'absent',
};

/** Totals as tinted chips (colour + icon + word), only the ones that are not zero. */
function TotalChips({ totals }: { totals: Record<TotalColumn, number> }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {TOTAL_COLUMNS.filter((c) => totals[c] > 0).map((c) => {
        const n = c === 'otHours' ? totals[c].toFixed(1) : days(totals[c]);
        const word = t(`owner:register.line.${c}`, { n });
        return (
          <li key={c} className="flex">
            {c === 'otHours' ? (
              <Badge tone="success" icon="clock">
                {word}
              </Badge>
            ) : c === 'lop' ? (
              <Badge tone="neutral" icon="currency-inr">
                {word}
              </Badge>
            ) : (
              <StatusChip status={TOTAL_STATUS[c]} label={word} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MonthSummary({ view }: { view: RegisterView }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('owner:register.summary')}
      className="grid gap-2 rounded-md border border-border bg-bg-soft px-4 py-3"
    >
      <h2 className="font-semibold text-sm text-text-muted">{t('owner:register.summary')}</h2>
      <TotalChips totals={monthTotals(view)} />
    </section>
  );
}

function PersonMonth({ view, userId }: { view: RegisterView; userId: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const row = view.rows.find((r) => r.user.id === userId);
  useOwnerTitle(row?.user.name ?? null);
  const back = () => {
    const next = new URLSearchParams(params);
    next.delete('user');
    setParams(next);
  };
  if (!row) return <Empty>{t('owner:errors.notFound')}</Empty>;
  return (
    <div className="grid gap-4">
      <div>
        <Button size="sm" variant="ghost" icon="caret-left" onClick={back}>
          {t('owner:shell.back')}
        </Button>
      </div>
      <TotalChips totals={rowTotals(row)} />
      <ol className="grid gap-3">
        {weekStrips(view, row).map((s) => (
          <li key={s.start}>
            <Strip row={row} strip={s} name={row.user.name} />
          </li>
        ))}
      </ol>
    </div>
  );
}

const LEGEND: { chip: ChipStatus; key: string; letter: string }[] = [
  { chip: 'present', key: 'owner:status.P', letter: 'P' },
  { chip: 'late', key: 'owner:status.late', letter: 'P' },
  { chip: 'half', key: 'owner:status.H', letter: 'H' },
  { chip: 'absent', key: 'owner:status.A', letter: 'A' },
  { chip: 'leave', key: 'owner:status.L', letter: 'L' },
  { chip: 'off', key: 'owner:status.WO', letter: 'WO' },
  { chip: 'holiday', key: 'owner:status.HO', letter: 'HO' },
  { chip: 'venue', key: 'owner:status.OD', letter: 'OD' },
  { chip: 'waiting', key: 'owner:status.OPEN', letter: 'In' },
];

function Legend() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('owner:register.legend')} className="grid gap-2">
      <h2 className="font-semibold text-sm text-text-muted">{t('owner:register.legend')}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {LEGEND.map((l) => (
          <li key={l.key} className="flex items-center gap-2 text-sm text-text-body">
            <span
              className={`inline-grid h-7 min-w-9 grid-flow-col place-items-center gap-0.5 rounded-sm px-1 ${TINT[l.chip === 'late' ? 'present' : l.chip]}`}
              aria-hidden="true"
            >
              <Icon
                name={CHIP_ICON[l.chip]}
                className={`size-4 ${l.chip === 'late' ? 'text-late' : ''}`}
              />
              <span className="font-bold text-xs">{l.letter}</span>
            </span>
            {t(l.key)}
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-text-body">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          {t('owner:status.flagged')}
        </li>
      </ul>
    </section>
  );
}

function GridSkeleton() {
  return (
    <SkeletonGroup className="grid gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="flex items-center gap-3">
          <Skeleton width="10rem" />
          <Skeleton shape="block" height="2.75rem" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
