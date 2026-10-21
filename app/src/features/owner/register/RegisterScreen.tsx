/**
 * Register (PRD 5.2, O-05). Phone: a person-first list, one row per person with this week as a
 * strip of seven 36 px cells (a "Month grid" toggle keeps the full table, 96 px first column,
 * 40 px cells). Desktop: the table (36 px cells, sticky header and first column) beside a panel for
 * the selected person and day. Cells carry a letter, or late minutes, on a tint, with no icon
 * (PRD 12.3 amendment); the icon and the word live in the key, the panel and the day screen. Arrow
 * keys move between cells. A month summary is one line; the key opens from a popover.
 */
import type { RegisterView } from '@fs/contracts';
import { istDate, istTime, weekday } from '@fs/contracts';
import {
  Badge,
  Banner,
  Button,
  ChipGroup,
  Icon,
  IconButton,
  Popover,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import {
  type KeyboardEvent,
  type MouseEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useOwnerDay, useRegister } from '../api/attendance';
import { Meta, Tag } from '../components/layout';
import { Empty, QueryView } from '../components/states';
import { dayLabel, days, longDate, monthLabel } from '../lib/format';
import { CHIP_ICON, type ChipStatus, dayStatusMeta, LATE_META, TINT } from '../lib/status';
import { useOwnerTitle } from '../shell/chrome';
import {
  type CellModel,
  cellDetail,
  cellMark,
  cellModel,
  defaultSelection,
  lateText,
  monthNav,
  monthTotals,
  type RegisterRow,
  recentDates,
  type Selection,
  shortName,
  TOTAL_COLUMNS,
  type TotalColumn,
  totalValue,
  weekStrips,
} from './register-model';

/** Tailwind `xl`: the two-column layout with the day panel. */
const DESKTOP = '(min-width: 1280px)';
function useDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const q = window.matchMedia?.(DESKTOP);
      q?.addEventListener('change', notify);
      return () => q?.removeEventListener('change', notify);
    },
    () => window.matchMedia?.(DESKTOP).matches ?? false,
    () => false,
  );
}

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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton
            icon="caret-left"
            label={t('owner:register.prevMonth')}
            onClick={() => go(nav.prev)}
          />
          <h2 className="min-w-40 text-center font-bold text-lg text-text" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <IconButton
            icon="caret-right"
            label={t('owner:register.nextMonth')}
            onClick={() => nav.next && go(nav.next)}
            disabled={!nav.next}
          />
        </div>
        <Popover
          align="end"
          aria-label={t('owner:register.legend')}
          className="w-72"
          trigger={
            <Button size="sm" variant="secondary">
              {t('owner:register.legend')}
            </Button>
          }
        >
          <Legend />
        </Popover>
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
            <div className={person ? 'hidden xl:block' : 'block'}>
              <Body view={view} today={today} />
            </div>
          </>
        )}
      </QueryView>
    </div>
  );
}

function Body({ view, today }: { view: RegisterView; today: string }) {
  const { t } = useTranslation();
  const desktop = useDesktop();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [picked, setPicked] = useState<Selection | null>(null);
  const valid =
    picked !== null &&
    view.rows.some((r) => r.user.id === picked.userId) &&
    view.dates.includes(picked.date);
  const sel = valid ? picked : defaultSelection(view, today);
  const showGrid = desktop || mode === 'month';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start xl:gap-6">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <MonthSummary view={view} />
        {desktop ? null : (
          <ChipGroup
            legend={t('owner:register.viewLabel')}
            legendHidden
            layout="segmented"
            value={mode}
            onValueChange={(v) => setMode(v === 'month' ? 'month' : 'week')}
            options={[
              { value: 'week', label: t('owner:register.viewWeek') },
              { value: 'month', label: t('owner:register.viewMonth') },
            ]}
          />
        )}
        {showGrid ? (
          <Grid view={view} today={today} desktop={desktop} sel={sel} onSelect={setPicked} />
        ) : (
          <WeekList view={view} today={today} />
        )}
      </div>
      {desktop && sel ? <DayPanel view={view} sel={sel} /> : null}
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

const MARK_SIZE = {
  week: 'size-9 text-sm',
  grid: 'size-10 text-xs xl:size-9',
  strip: 'h-12 w-full text-sm',
} as const;

/** A day cell: letter or late minutes on the tint, no icon (PRD 12.3 amendment 2). */
function CellMark({ c, size }: { c: CellModel; size: keyof typeof MARK_SIZE }) {
  const m = cellMark(c);
  if (!m) return null;
  return (
    <span
      className={`grid place-items-center rounded-sm font-bold tabular-nums leading-none ${TINT[m.tone]} ${MARK_SIZE[size]}`}
      aria-hidden="true"
    >
      {m.text}
    </span>
  );
}

function Dot({ c }: { c: CellModel }) {
  return c.flagged || c.pending || c.edited ? (
    <span
      aria-hidden="true"
      className="-top-0.5 -right-0.5 absolute size-2 rounded-full border border-bg bg-accent"
    />
  ) : null;
}

function WeekList({ view, today }: { view: RegisterView; today: string }) {
  const { t } = useTranslation();
  const cellText = useCellText();
  const [params, setParams] = useSearchParams();
  const dates = recentDates(view, today);
  const openPerson = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('user', id);
    setParams(next);
  };
  return (
    <section
      aria-label={t('owner:register.weekList')}
      className="rounded-md border border-border bg-bg"
    >
      <div className="grid grid-cols-7 px-3 pt-2 pb-1" aria-hidden="true">
        {dates.map((d) => (
          <span key={d} className="grid text-center text-text-muted text-xs leading-tight">
            <span className={d === today ? 'font-bold text-text' : 'font-semibold'}>
              {Number(d.slice(8))}
            </span>
            <span>{dayLabel(d).slice(0, 2)}</span>
          </span>
        ))}
      </div>
      <ul>
        {view.rows.map((row) => (
          <li key={row.user.id} className="border-border border-t px-3 py-1">
            <button
              type="button"
              onClick={() => openPerson(row.user.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-sm text-left"
            >
              <span className="min-w-0 flex-1 truncate font-bold text-base text-text">
                {row.user.name}
              </span>
              <Icon name="caret-right" className="size-4 shrink-0 text-text-muted" />
              <span className="sr-only">{t('owner:register.openMonth')}</span>
            </button>
            <ol className="grid grid-cols-7">
              {dates.map((date) => {
                const cell = row.cells[view.dates.indexOf(date)];
                const d = cell ? cellModel(date, cell) : null;
                return (
                  <li key={date} className="grid place-items-center">
                    {d?.meta ? (
                      <Link
                        to={`/o/register/${row.user.id}/${date}`}
                        className="relative grid h-11 w-full place-items-center rounded-sm"
                      >
                        <span className="relative">
                          <CellMark c={d} size="week" />
                          <Dot c={d} />
                        </span>
                        <span className="sr-only">{cellText(row.user.name, d)}</span>
                      </Link>
                    ) : (
                      <span className="grid h-11 w-full place-items-center">
                        <span className="size-9 rounded-sm border border-border border-dashed" />
                        {d ? <span className="sr-only">{cellText(row.user.name, d)}</span> : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Grid({
  view,
  today,
  desktop,
  sel,
  onSelect,
}: {
  view: RegisterView;
  today: string;
  desktop: boolean;
  sel: Selection | null;
  onSelect: (s: Selection) => void;
}) {
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
      className="relative overflow-auto rounded-md border border-border bg-bg xl:max-h-[calc(100dvh-16rem)]"
    >
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          {t('owner:register.caption', { month: monthLabel(view.month) })}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 w-24 min-w-24 max-w-24 border-border border-r border-b bg-bg px-3 py-2 text-left font-semibold text-text-muted text-xs xl:w-auto xl:min-w-44 xl:max-w-none"
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
                  className={`sticky top-0 z-20 border-border border-b px-0.5 py-1.5 text-center font-semibold text-xs ${future ? 'w-7' : 'w-10 xl:w-9'} ${sunday ? 'bg-bg-soft' : 'bg-bg'} ${isToday ? 'text-text' : 'text-text-muted'}`}
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
                className="sticky left-0 z-10 w-24 min-w-24 max-w-24 border-border border-r border-b bg-bg px-2.5 py-0.5 text-left font-bold text-sm text-text xl:w-auto xl:max-w-none xl:px-3 xl:text-base"
              >
                <button
                  type="button"
                  onClick={() => openPerson(row.user.id)}
                  className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center rounded-sm px-1 text-left xl:hidden"
                >
                  <span className="truncate" aria-hidden="true">
                    {shortName(row.user.name)}
                  </span>
                  <span className="sr-only">
                    {row.user.name}, {t('owner:register.openMonth')}
                  </span>
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
                const selected = desktop && sel?.userId === row.user.id && sel.date === date;
                const pick = (e: MouseEvent) => {
                  if (!desktop) return;
                  e.preventDefault();
                  onSelect({ userId: row.user.id, date });
                };
                return (
                  <td key={date} className="border-border border-b p-px text-center">
                    {m.meta ? (
                      <Link
                        id={`reg-${r}-${c}`}
                        to={`/o/register/${row.user.id}/${date}`}
                        tabIndex={active ? 0 : -1}
                        onFocus={() => setFocus([r, c])}
                        onKeyDown={(e) => move(e, r, c)}
                        onClick={pick}
                        title={label}
                        aria-current={selected ? 'true' : undefined}
                        className={`relative inline-block rounded-sm ${selected ? 'outline-2 outline-text outline-offset-1' : ''}`}
                      >
                        <CellMark c={m} size="grid" />
                        <span className="sr-only">{label}</span>
                        <Dot c={m} />
                      </Link>
                    ) : (
                      <span className="inline-block h-10 w-6 xl:h-9">
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

/** The selected person and day on desktop: status, punches, source, note and the way to fix it. */
function DayPanel({ view, sel }: { view: RegisterView; sel: Selection }) {
  const { t } = useTranslation();
  const row = view.rows.find((r) => r.user.id === sel.userId);
  const cell = row?.cells[view.dates.indexOf(sel.date)];
  const detail = useOwnerDay(sel.userId, sel.date);
  if (!row || !cell) return null;
  const m = cellModel(sel.date, cell);
  const meta = m.meta ?? dayStatusMeta(cell.status);
  // Source and notes come from the day itself; show them only when they are this person-day.
  const day =
    detail.data?.user.id === sel.userId && detail.data.day.workDate === sel.date
      ? detail.data
      : null;
  const note = day?.punches.map((p) => p.note ?? p.reviewNote).find(Boolean) ?? null;
  return (
    <section
      aria-label={t('owner:register.panel.label')}
      aria-live="polite"
      className="grid gap-4 rounded-md border border-border bg-bg p-5 xl:sticky xl:top-4"
    >
      <div className="grid gap-0.5">
        <h2 className="font-extrabold text-lg text-text">{row.user.name}</h2>
        <Meta>
          {longDate(sel.date)}
          {row.user.designation ? ` · ${row.user.designation}` : ''}
        </Meta>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={meta.chip} label={t(meta.labelKey)} />
        {m.late && cell.lateMin > 0 ? (
          <StatusChip
            status={LATE_META.chip}
            label={t('owner:today.row.lateLabel', { min: cell.lateMin })}
          />
        ) : null}
        {m.flagged ? <Tag>{t('owner:status.flagged')}</Tag> : null}
        {m.pending ? <Tag>{t('owner:status.pending')}</Tag> : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">{t('owner:punch.in')}</dt>
        <dd className="text-right font-semibold text-text tabular-nums">
          {cell.inTs !== null ? istTime(cell.inTs) : t('owner:register.panel.none')}
        </dd>
        <dt className="text-text-muted">{t('owner:punch.out')}</dt>
        <dd className="text-right font-semibold text-text tabular-nums">
          {cell.outTs !== null ? istTime(cell.outTs) : t('owner:register.panel.none')}
        </dd>
        <dt className="text-text-muted">{t('owner:register.panel.source')}</dt>
        <dd className="flex flex-wrap justify-end gap-1.5">
          {day && day.punches.length > 0 ? (
            [...new Set(day.punches.map((p) => p.source))].map((s) => (
              <Tag key={s}>{t(`owner:punch.source.${s}`)}</Tag>
            ))
          ) : (
            <span className="font-semibold text-text">{t('owner:register.panel.none')}</span>
          )}
        </dd>
        <dt className="text-text-muted">{t('owner:register.panel.note')}</dt>
        <dd className="text-right text-text-body">{note ?? t('owner:register.panel.none')}</dd>
      </dl>
      <Button variant="primary" block asChild>
        <Link to={`/o/register/${sel.userId}/${sel.date}`}>{t('owner:register.panel.fix')}</Link>
      </Button>
    </section>
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
                  <Dot c={d} />
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

/** One line of text with the month's counts for everyone (late and overtime join from 640 px). */
function MonthSummary({ view }: { view: RegisterView }) {
  const { t } = useTranslation();
  const totals = monthTotals(view);
  const part = (c: TotalColumn) =>
    t(`owner:register.line.${c}`, { n: c === 'otHours' ? totals[c].toFixed(1) : days(totals[c]) });
  return (
    <p className="text-sm text-text-body">
      <span className="sr-only">{t('owner:register.summaryShort')} </span>
      {(['present', 'half', 'absent', 'leave'] as const)
        .filter((c) => totals[c] > 0)
        .map(part)
        .join(' · ')}
      <span className="hidden sm:inline">
        {(['lateMin', 'otHours'] as const)
          .filter((c) => totals[c] > 0)
          .map((c) => ` · ${part(c)}`)
          .join('')}
      </span>
    </p>
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
  { chip: 'late', key: 'owner:status.late', letter: lateText(28) },
  { chip: 'half', key: 'owner:status.H', letter: 'H' },
  { chip: 'absent', key: 'owner:status.A', letter: 'A' },
  { chip: 'leave', key: 'owner:status.L', letter: 'L' },
  { chip: 'off', key: 'owner:status.WO', letter: 'WO' },
  { chip: 'holiday', key: 'owner:status.HO', letter: 'HO' },
  { chip: 'venue', key: 'owner:status.OD', letter: 'OD' },
  { chip: 'waiting', key: 'owner:status.OPEN', letter: 'In' },
];

/** The key (popover): the full chip, icon, letter and word, which the 36 px cells leave out. */
function Legend() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('owner:register.legend')} className="grid gap-2">
      <h2 className="font-semibold text-sm text-text-muted">{t('owner:register.legend')}</h2>
      <ul className="grid gap-2">
        {LEGEND.map((l) => (
          <li key={l.key} className="flex items-center gap-2 text-sm text-text-body">
            <span
              className={`inline-grid h-7 min-w-14 grid-flow-col place-items-center gap-1 rounded-sm px-1.5 ${TINT[l.chip]}`}
              aria-hidden="true"
            >
              <Icon name={CHIP_ICON[l.chip]} className="size-4" />
              <span className="font-bold text-xs">{l.letter}</span>
            </span>
            {t(l.key)}
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-text-body">
          <span className="grid h-7 min-w-14 place-items-center" aria-hidden="true">
            <span className="size-2 rounded-full bg-accent" />
          </span>
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
