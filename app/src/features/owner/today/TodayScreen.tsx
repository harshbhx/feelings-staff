/**
 * Today board (PRD 5.2, O-03; UI redesign Fix 3): readable in two seconds. One hero card says how
 * the day is going ("8 of 9 in", the strip, one sentence) and holds the one sindoor button when
 * something needs the owner's OK. On a phone a three-way switch (In, Not in yet, Away) picks the
 * list; on a wide screen the people who are in sit on the left and the rest on the right. Polls
 * every 30 s while visible; a push refetches.
 */
import type { TodayBoard } from '@fs/contracts';
import {
  Avatar,
  Button,
  ChipGroup,
  List,
  ListRow,
  ProgressStrip,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTodayBoard } from '../api/attendance';
import { Meta, NoBreakParts, Section, useNow, WRAP_ROW } from '../components/layout';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { clock, dayLabel, duration } from '../lib/format';
import { roleTone } from '../lib/people';
import { telLink, waLink } from '../lib/share';
import { inRowStatus, leaveKey, type RowStatus } from '../lib/status';
import { AwayNowSection } from '../rollcall/AwayNow';
import { RollCallCard } from '../rollcall/RollCallCard';
import {
  BOARD_VIEWS,
  type BoardAwayRow,
  type BoardInRow,
  type BoardNotInRow,
  type BoardView,
  boardModel,
  dayProgress,
  heroParts,
  liveWorkedMin,
} from './today-model';

export function TodayScreen() {
  const board = useTodayBoard();
  return (
    <QueryView query={board} skeleton={<TodaySkeleton />}>
      {(data) => <Board board={data} />}
    </QueryView>
  );
}

/** Below the two-column width only the chosen view shows; from `xl` every view does. */
const shownWhen = (on: boolean) =>
  on
    ? 'grid grid-cols-[minmax(0,1fr)] gap-8'
    : 'hidden xl:grid xl:grid-cols-[minmax(0,1fr)] xl:gap-8';

function Board({ board }: { board: TodayBoard }) {
  const { t } = useTranslation();
  const [view, setView] = useState<BoardView>('in');
  const now = useNow();
  const m = boardModel(board);
  const s = m.sections;
  const dayMeta = t('owner:today.dateUpdated', {
    date: dayLabel(board.date),
    time: clock(board.updatedAt),
  });

  if (m.mode.kind === 'closed') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Meta>{dayMeta}</Meta>
        <Empty>{t('owner:today.closed', { name: m.mode.holidayName })}</Empty>
      </div>
    );
  }

  const p = dayProgress(board);
  const stripParts = [
    {
      key: 'onTime',
      value: p.onTime,
      tone: 'present' as const,
      label: t('owner:today.strip.onTime', { count: p.onTime }),
    },
    {
      key: 'late',
      value: p.late,
      tone: 'late' as const,
      label: t('owner:today.headline.late', { count: p.late }),
    },
    {
      key: 'notInYet',
      value: p.notInYet,
      tone: 'waiting' as const,
      label: t('owner:today.headline.notInYet', { count: p.notInYet }),
    },
  ];
  const dueLaterPart =
    p.dueLater > 0 ? [t('owner:today.strip.dueLater', { count: p.dueLater })] : [];
  const parts = heroParts(board, p);
  const sentence =
    parts.length > 0
      ? t('owner:today.hero.sentence', {
          parts: parts.map((x) => t(`owner:today.hero.${x.key}`, { count: x.count })).join(', '),
        })
      : m.mode.kind === 'live'
        ? t('owner:today.hero.allIn')
        : null;

  const hero = (
    <section
      aria-label={t('owner:today.hero.label')}
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-md border border-border bg-bg p-4"
      data-testid="today-hero"
    >
      <div className="grid gap-1">
        <Meta className="leading-[1.4]">{dayMeta}</Meta>
        {m.mode.kind === 'before' ? (
          <p className="text-balance font-extrabold text-text text-xl tracking-display">
            {m.mode.firstShiftStart
              ? t('owner:today.before', { time: m.mode.firstShiftStart })
              : t('owner:today.beforeNoShift')}
          </p>
        ) : (
          <ProgressStrip
            size="lg"
            className="gap-2"
            label={
              <span data-testid="today-headline">
                {t('owner:today.progress', { in: p.inCount, total: p.total })}
              </span>
            }
            total={p.total}
            legend={false}
            segments={stripParts}
            description={t('owner:today.progressDesc', {
              in: p.inCount,
              total: p.total,
              parts: [
                ...stripParts.filter((x) => x.value > 0).map((x) => x.label),
                ...dueLaterPart,
              ].join(', '),
            })}
          />
        )}
      </div>
      {sentence ? (
        <p
          className="text-pretty text-sm text-text-body leading-[1.45]"
          data-testid="today-sentence"
        >
          {sentence}
        </p>
      ) : null}
      {/* The screen's one sindoor button, only when something waits for the owner (PRD 12.2). */}
      {board.actionsCount > 0 ? (
        <Button
          asChild
          variant="primary"
          iconEnd="arrow-right"
          className="mt-1 sm:justify-self-start"
        >
          <Link to="/o/actions">{t('owner:today.needsAction', { count: board.actionsCount })}</Link>
        </Button>
      ) : null}
    </section>
  );

  const inView = (
    <>
      <Section title={t('owner:today.sections.in')} count={s.in.length} headingHidden="phone">
        {s.in.length > 0 ? (
          <List>
            {s.in.map((r) => (
              <InRow
                key={r.user.id}
                row={r}
                date={board.date}
                worked={liveWorkedMin(r, board.updatedAt, now)}
              />
            ))}
          </List>
        ) : (
          <Meta>{t('owner:today.nobodyIn')}</Meta>
        )}
      </Section>
      <AwayNowSection />
      {s.out.length > 0 ? (
        <Section title={t('owner:today.sections.out')} count={s.out.length}>
          <List>
            {s.out.map((r) => (
              <InRow key={r.user.id} row={r} date={board.date} worked={r.workedMin} />
            ))}
          </List>
        </Section>
      ) : null}
    </>
  );

  const notInView = (
    <>
      <Section title={t('owner:today.sections.notIn')} count={s.notIn.length} headingHidden="phone">
        {s.notIn.length > 0 ? (
          <List>
            {s.notIn.map((r) => (
              <NotInRow key={r.user.id} row={r} />
            ))}
          </List>
        ) : (
          <Meta>{t('owner:today.nobodyNotIn')}</Meta>
        )}
      </Section>
      {s.dueLater.length > 0 ? (
        <Section title={t('owner:today.sections.dueLater')} count={s.dueLater.length}>
          <List>
            {s.dueLater.map((r) => (
              <ListRow
                key={r.user.id}
                leading={<Avatar name={r.user.name} tone={roleTone(r.user.designation)} />}
                title={r.user.name}
                subtitle={
                  r.shiftStart ? t('owner:today.row.shiftAt', { time: r.shiftStart }) : undefined
                }
              />
            ))}
          </List>
        </Section>
      ) : null}
    </>
  );

  const awayView = (
    <Section title={t('owner:today.sections.away')} count={s.away.length} headingHidden="phone">
      {s.away.length > 0 ? (
        <List>
          {s.away.map((r) => (
            <AwayRow key={r.user.id} row={r} />
          ))}
        </List>
      ) : (
        <Meta>{t('owner:today.nobodyAway')}</Meta>
      )}
    </Section>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] xl:items-start xl:gap-x-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:gap-8">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {hero}
          {/* PRD 4.18.3: the roll-call that is open or missed (N33), else one quiet line. */}
          <RollCallCard slot={board.rollCall} primary={board.actionsCount === 0} />
          <ChipGroup
            type="radio"
            layout="segmented"
            className="xl:hidden"
            legend={t('owner:today.views.label')}
            legendHidden
            value={view}
            onValueChange={(v) => setView(v as BoardView)}
            options={BOARD_VIEWS.map((v) => ({
              value: v,
              label: t(`owner:today.views.${v}`),
              count: m.viewCounts[v],
            }))}
          />
        </div>
        <div className={shownWhen(view === 'in')}>{inView}</div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:gap-8">
        <div className={shownWhen(view === 'notIn')}>{notInView}</div>
        <div className={shownWhen(view === 'away')}>{awayView}</div>
      </div>
    </div>
  );
}

/** Where the check-in was, as words for the row's quiet line (Fix 2: location is never a chip). */
function placeWords(row: BoardInRow, t: TFunction): string {
  if (row.place === 'venue')
    return row.placeName
      ? t('owner:place.venueNamed', { name: row.placeName })
      : t('owner:place.venue');
  return t(`owner:place.${row.place}`);
}

/**
 * The row's one chip (PRD 12.3 as amended): the highest status from `inRowStatus`. Late reads as
 * minutes ("+28 m") with the clock, and says "Late by 28 min" to screen readers.
 */
function InRowChip({ row, status }: { row: BoardInRow; status: RowStatus }) {
  const { t } = useTranslation();
  switch (status) {
    case 'pending':
      return <StatusChip status="waiting" label={t('owner:today.row.pending')} />;
    case 'flag':
      return <StatusChip status="flag" label={t('owner:today.row.flagged')} />;
    case 'late':
      return (
        <StatusChip
          status="late"
          className="text-sm"
          label={
            <>
              <span aria-hidden="true">{t('owner:today.row.lateBy', { min: row.lateMin })}</span>
              <span className="sr-only">
                {t('owner:today.row.lateLabel', { min: row.lateMin })}
              </span>
            </>
          }
        />
      );
    case 'venue':
      return <StatusChip status="venue" label={row.placeName ?? t('owner:status.OD')} />;
    default:
      return <StatusChip status="present" label={t('owner:today.row.onTime')} />;
  }
}

function InRow({ row, date, worked }: { row: BoardInRow; date: string; worked: number }) {
  const { t } = useTranslation();
  const status = inRowStatus(row);
  // The statuses that lost to the chip become words in the quiet line, never a second chip.
  const parts = [
    t('owner:today.row.inAt', { time: clock(row.inTs) }),
    row.outTs !== null ? t('owner:today.row.outAt', { time: clock(row.outTs) }) : null,
    row.lateMin > 0 && status !== 'late'
      ? t('owner:today.row.lateWords', { min: row.lateMin })
      : null,
    row.outTs !== null
      ? t('owner:today.row.worked', { duration: duration(worked) })
      : t('owner:today.row.soFar', { duration: duration(worked) }),
    status === 'venue' ? null : placeWords(row, t),
  ];
  return (
    <ListRow
      asChild
      className={WRAP_ROW}
      leading={<Avatar name={row.user.name} tone={roleTone(row.user.designation)} />}
      title={row.user.name}
      subtitle={
        <span className="tabular-nums">
          <NoBreakParts parts={parts} />
        </span>
      }
      trailing={<InRowChip row={row} status={status} />}
    >
      <Link to={`/o/register/${row.user.id}/${date}`} />
    </ListRow>
  );
}

function NotInRow({ row }: { row: BoardNotInRow }) {
  const { t } = useTranslation();
  const first = row.user.name.split(' ')[0] ?? row.user.name;
  const when = [
    row.shiftStart ? t('owner:today.row.shiftAt', { time: row.shiftStart }) : null,
    row.minutesLate > 0 ? t('owner:today.row.lateNow', { min: row.minutesLate }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListRow
      className={WRAP_ROW}
      leading={<Avatar name={row.user.name} tone={roleTone(row.user.designation)} />}
      title={row.user.name}
      subtitle={<span className="tabular-nums">{when}</span>}
      trailing={
        row.user.phone ? (
          <span className="flex gap-2">
            <Button asChild size="sm" variant="secondary" icon="phone">
              <a
                href={telLink(row.user.phone)}
                aria-label={t('owner:today.row.callName', { name: first })}
              >
                {t('owner:common.call')}
              </a>
            </Button>
            <Button asChild size="sm" variant="secondary" icon="whatsapp-logo">
              <a
                href={waLink(row.user.phone)}
                target="_blank"
                rel="noreferrer"
                aria-label={t('owner:today.row.whatsappName', { name: first })}
              >
                {t('owner:common.whatsapp')}
              </a>
            </Button>
          </span>
        ) : (
          <Meta>{t('owner:common.noPhone')}</Meta>
        )
      }
    />
  );
}

function AwayRow({ row }: { row: BoardAwayRow }) {
  const { t } = useTranslation();
  const chip =
    row.reason === 'leave' ? (
      <StatusChip
        status="leave"
        label={row.leaveCode ? t(leaveKey(row.leaveCode)) : t('owner:today.row.away.leave')}
      />
    ) : row.reason === 'holiday' ? (
      <StatusChip status="holiday" label={t('owner:today.row.away.holiday')} />
    ) : (
      <StatusChip status="off" label={t('owner:today.row.away.week_off')} />
    );
  return (
    <ListRow
      leading={<Avatar name={row.user.name} tone={roleTone(row.user.designation)} />}
      title={row.user.name}
      trailing={chip}
    />
  );
}

function TodaySkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] xl:items-start xl:gap-x-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:gap-8">
        <SkeletonGroup className="grid gap-3 rounded-md border border-border bg-bg p-4">
          <Skeleton width="11rem" />
          <Skeleton width="min(12rem, 60%)" height="2.25rem" />
          <Skeleton height="0.5rem" />
          <Skeleton width="85%" />
          <Skeleton shape="pill" height="3rem" />
        </SkeletonGroup>
        {/* The In, Not in yet, Away switch is a phone control. */}
        <Skeleton shape="pill" height="3.375rem" className="xl:hidden" />
        <RowsSkeleton rows={6} />
      </div>
      <div className="hidden xl:block">
        <RowsSkeleton rows={3} />
      </div>
    </div>
  );
}
