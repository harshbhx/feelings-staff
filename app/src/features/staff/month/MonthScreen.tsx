/**
 * My month (`/month?m=YYYY-MM`, PRD 5.1; AC S-11): month header with previous/next, a 7-column
 * calendar where each day is a status chip (icon + letter, the word for screen readers) and today
 * is ringed, the month totals in words, and a legend.
 */
import { istDate, istMonth, type MonthTotals } from '@fs/contracts';
import { IconButton, Skeleton, SkeletonGroup, StatusChip } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMonth } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { calendarWeeks, chipStatusOf, monthNav } from './month-model';

export function MonthScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const now = Date.now();
  const current = istMonth(now);
  const asked = params.get('m');
  const month = asked && /^\d{4}-\d{2}$/.test(asked) && asked <= current ? asked : current;
  const data = useMonth(month);
  const nav = monthNav(month, current);
  const go = (m: string) => navigate(`/month?m=${m}`, { replace: true });

  return (
    <>
      <ScreenHeader title={t('staff:screens.month')} dataAt={data.dataUpdatedAt || undefined} />
      <main id="main" className="staff-main flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <IconButton
            icon="caret-left"
            label={t('staff:month.prev')}
            onClick={() => go(nav.prev)}
          />
          <h2 className="text-center" aria-live="polite">
            {fmt.month(month)}
          </h2>
          <IconButton
            icon="caret-right"
            label={t('staff:month.next')}
            onClick={() => nav.next && go(nav.next)}
            disabled={!nav.next}
          />
        </div>

        {data.data ? (
          <>
            <Totals totals={data.data.totals} fmt={fmt} />
            <Calendar month={month} days={data.data.days} today={istDate(now)} />
            <Legend />
          </>
        ) : data.isError ? (
          <QueryError
            error={data.error}
            message={t('staff:month.loadError')}
            onRetry={() => void data.refetch()}
          />
        ) : (
          <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-4">
            <Skeleton width="80%" />
            <Skeleton shape="block" height="18rem" />
          </SkeletonGroup>
        )}
      </main>
    </>
  );
}

function Totals({ totals, fmt }: { totals: MonthTotals; fmt: Fmt }) {
  const { t } = useTranslation();
  const parts = [
    t('staff:month.totals.present', { count: totals.present }),
    totals.half ? t('staff:month.totals.half', { count: totals.half }) : null,
    totals.absent ? t('staff:month.totals.absent', { count: totals.absent }) : null,
    totals.leave ? t('staff:month.totals.leave', { count: totals.leave }) : null,
    totals.lateBillableMin
      ? t('staff:month.totals.late', { duration: fmt.duration(totals.lateBillableMin) })
      : null,
    totals.otApprovedMin
      ? t('staff:month.totals.ot', { duration: fmt.duration(totals.otApprovedMin) })
      : null,
    totals.otPendingMin
      ? t('staff:month.totals.otPending', { duration: fmt.duration(totals.otPendingMin) })
      : null,
  ].filter((x): x is string => x !== null);
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-text tabular">
      {parts.map((p, i) => (
        <li key={p} className="flex items-center gap-3">
          {i > 0 ? (
            <span aria-hidden="true" className="text-text-muted">
              ·
            </span>
          ) : null}
          {p}
        </li>
      ))}
    </ul>
  );
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function Calendar({
  month,
  days,
  today,
}: {
  month: string;
  days: Parameters<typeof calendarWeeks>[1];
  today: string;
}) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const weeks = calendarWeeks(month, days, today);
  const wd = {
    mon: t('staff:month.weekdays.mon'),
    tue: t('staff:month.weekdays.tue'),
    wed: t('staff:month.weekdays.wed'),
    thu: t('staff:month.weekdays.thu'),
    fri: t('staff:month.weekdays.fri'),
    sat: t('staff:month.weekdays.sat'),
    sun: t('staff:month.weekdays.sun'),
  };
  const statusWord = (s: string) => t(`staff:status.${s}`);
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">{fmt.month(month)}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="pb-2 text-xs font-semibold text-text-muted">
              {wd[d]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.find((c) => c)?.date}>
            {WEEKDAYS.map((wdName, i) => {
              const cell = week[i] ?? null;
              if (!cell) return <td key={wdName} />;
              const chip = cell.summary ? chipStatusOf(cell.summary) : null;
              const word = cell.isFuture
                ? statusWord('future')
                : cell.summary
                  ? statusWord(cell.summary.status)
                  : '';
              const label = t('staff:month.dayLabel', {
                date: fmt.weekday(cell.date),
                status: word,
              });
              const inner = (
                <span className="flex min-h-14 flex-col items-center gap-1 py-1">
                  <span
                    className={
                      cell.isToday
                        ? 'grid size-7 place-items-center rounded-full border-2 border-text text-sm font-bold text-text tabular'
                        : `grid size-7 place-items-center text-sm tabular ${cell.isFuture ? 'text-text-muted' : 'text-text'}`
                    }
                  >
                    {cell.day}
                  </span>
                  {chip && !cell.isFuture ? (
                    <StatusChip
                      status={chip}
                      variant="letter"
                      label={word}
                      className="staff-cal-chip"
                    />
                  ) : null}
                </span>
              );
              return (
                <td key={cell.date} className="p-0 align-top">
                  {cell.isFuture || !cell.summary ? (
                    <span className="block">{inner}</span>
                  ) : (
                    <Link
                      to={`/day/${cell.date}`}
                      aria-label={label}
                      aria-current={cell.isToday ? 'date' : undefined}
                      className="block rounded-md no-underline"
                    >
                      {inner}
                    </Link>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend() {
  const { t } = useTranslation();
  const items = [
    { status: 'present', word: t('staff:status.P') },
    { status: 'half', word: t('staff:status.H') },
    { status: 'absent', word: t('staff:status.A') },
    { status: 'leave', word: t('staff:status.L') },
    { status: 'off', word: t('staff:status.WO') },
    { status: 'holiday', word: t('staff:status.HO') },
  ] as const;
  return (
    <details className="staff-card">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-text">
        {t('staff:month.legend')}
      </summary>
      <ul className="flex flex-wrap gap-2 pt-2">
        {items.map((i) => (
          <li key={i.status}>
            <StatusChip status={i.status} label={i.word} />
          </li>
        ))}
      </ul>
    </details>
  );
}
