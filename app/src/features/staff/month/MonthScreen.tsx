/**
 * My month (`/month?m=YYYY-MM`, PRD 5.1; AC S-11): month header with previous/next, a 7-column
 * calendar where each day is a status chip (icon + letter, the word for screen readers) and today
 * is ringed, the month totals in words, and a legend.
 */
import { isApiError, istDate, istMonth, type MonthTotals } from '@fs/contracts';
import { Badge, Button, Icon, IconButton, Skeleton, SkeletonGroup, StatusChip } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMonth } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { ScreenHeader } from '../shell/ScreenHeader';
import { calendarWeeks, chipStatusOf, lateMark, monthNav } from './month-model';

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
          <MonthError
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

function MonthError({
  error,
  message,
  onRetry,
}: {
  error: unknown;
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <div role="alert" className="staff-card flex flex-col gap-3">
      <p className="flex items-start gap-2 font-bold text-text">
        <Icon name="warning-circle" className="mt-0.5 size-5 shrink-0 text-accent" />
        <span>{isApiError(error, 'UNAVAILABLE') ? t('errors:network') : message}</span>
      </p>
      <div>
        <Button size="sm" variant="secondary" icon="arrows-clockwise" onClick={onRetry}>
          {t('common:actions.tryAgain')}
        </Button>
      </div>
      {requestId ? (
        <details className="text-sm text-text-muted">
          <summary className="min-h-11 cursor-pointer py-2">{t('errors:details')}</summary>
          <p>{t('errors:requestId', { id: requestId })}</p>
        </details>
      ) : null}
    </div>
  );
}

/** Totals as chips (colour + icon + word), only the ones that are not zero; no separators to orphan. */
function Totals({ totals, fmt }: { totals: MonthTotals; fmt: Fmt }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2 text-sm">
      <TotalItem
        status="present"
        label={t('staff:month.totals.present', { count: totals.present })}
      />
      {totals.half ? (
        <TotalItem status="half" label={t('staff:month.totals.half', { count: totals.half })} />
      ) : null}
      {totals.absent ? (
        <TotalItem
          status="absent"
          label={t('staff:month.totals.absent', { count: totals.absent })}
        />
      ) : null}
      {totals.leave ? (
        <TotalItem status="leave" label={t('staff:month.totals.leave', { count: totals.leave })} />
      ) : null}
      {totals.lateBillableMin ? (
        <TotalItem
          status="late"
          label={t('staff:month.totals.late', { duration: fmt.duration(totals.lateBillableMin) })}
        />
      ) : null}
      {totals.otApprovedMin ? (
        <li className="flex">
          <Badge tone="success" icon="clock">
            {t('staff:month.totals.ot', { duration: fmt.duration(totals.otApprovedMin) })}
          </Badge>
        </li>
      ) : null}
      {totals.otPendingMin ? (
        <li className="flex">
          <Badge tone="outline" icon="clock">
            {t('staff:month.totals.otPending', { duration: fmt.duration(totals.otPendingMin) })}
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

function TotalItem({
  status,
  label,
}: {
  status: 'present' | 'half' | 'absent' | 'leave' | 'late';
  label: string;
}) {
  return (
    <li className="flex">
      <StatusChip status={status} label={label} />
    </li>
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
              const late = cell.summary && !cell.isFuture ? lateMark(cell.summary) : null;
              const word = cell.isFuture
                ? statusWord('future')
                : cell.summary
                  ? statusWord(cell.summary.status)
                  : '';
              const spoken =
                late && cell.summary
                  ? `${word}, ${t('staff:month.lateDay', { duration: fmt.duration(cell.summary.lateMin) })}`
                  : word;
              const label = t('staff:month.dayLabel', {
                date: fmt.weekday(cell.date),
                status: spoken,
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
                  {late ? (
                    <span
                      aria-hidden="true"
                      className="grid h-6 min-w-9 place-items-center rounded-sm bg-late-bg px-1 text-xs font-bold text-late leading-none tabular-nums"
                    >
                      {late}
                    </span>
                  ) : chip && !cell.isFuture ? (
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
                      aria-current={cell.isToday ? 'date' : undefined}
                      className="block rounded-md no-underline"
                    >
                      {/* Name from content, so it includes the visible day (WCAG 2.5.3). */}
                      <span className="sr-only">{label}</span>
                      <span aria-hidden="true" className="block">
                        {inner}
                      </span>
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
    { status: 'late', word: t('staff:status.late') },
    { status: 'absent', word: t('staff:status.A') },
    { status: 'leave', word: t('staff:status.L') },
    { status: 'off', word: t('staff:status.WO') },
    { status: 'holiday', word: t('staff:status.HO') },
  ] as const;
  return (
    <details className="staff-card group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-2 font-semibold text-text [&::-webkit-details-marker]:hidden">
        {t('staff:month.legend')}
        <Icon
          name="caret-down"
          aria-hidden="true"
          className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
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
