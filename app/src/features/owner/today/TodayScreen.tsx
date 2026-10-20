/**
 * Today board (PRD 5.2, O-03): readable in two seconds. One line says how the day is going, the
 * counters filter the lists, and the lists say who is in, who is not in yet (with Call and
 * WhatsApp), who has checked out and who is away. Polls every 30 s while visible; a push refetches.
 */
import type { TodayBoard } from '@fs/contracts';
import {
  Avatar,
  Badge,
  Button,
  Icon,
  List,
  ListRow,
  ProgressStrip,
  Skeleton,
  SkeletonGroup,
  StatChipGroup,
  type StatOption,
  type StatTone,
  StatusChip,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTodayBoard } from '../api/attendance';
import { Meta, Section, useNow, WRAP_ROW } from '../components/layout';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { clock, dayLabel, duration } from '../lib/format';
import { telLink, waLink } from '../lib/share';
import { leaveKey } from '../lib/status';
import { AwayNowSection } from '../rollcall/AwayNow';
import { RollCallCard } from '../rollcall/RollCallCard';
import {
  type BoardAwayRow,
  type BoardInRow,
  type BoardNotInRow,
  boardModel,
  COUNTER_ORDER,
  type CounterKey,
  dayProgress,
  liveWorkedMin,
} from './today-model';

/** Each counter's tint and icon (PRD 12.3). Not in yet waits; it is not an absence. */
const COUNTER_TONE: Record<CounterKey, { tone: StatTone; icon?: StatOption['icon'] }> = {
  present: { tone: 'present' },
  late: { tone: 'late' },
  notInYet: { tone: 'waiting', icon: 'hourglass' },
  onLeave: { tone: 'leave' },
  weekOff: { tone: 'off' },
  atVenue: { tone: 'venue' },
};

export function TodayScreen() {
  const board = useTodayBoard();
  return (
    <QueryView query={board} skeleton={<TodaySkeleton />}>
      {(data) => <Board board={data} />}
    </QueryView>
  );
}

function Board({ board }: { board: TodayBoard }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<CounterKey | null>(null);
  const now = useNow();
  const m = boardModel(board, filter);
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
  // Zero counts stay out of the way, unless that filter is the one on.
  const options: StatOption[] = [
    { value: 'all', label: t('owner:today.stats.all'), count: p.everyone },
    ...COUNTER_ORDER.filter(
      (key) => key === 'present' || board.counters[key] > 0 || filter === key,
    ).map((key) => ({
      value: key,
      label: t(`owner:today.stats.${key}`),
      count: board.counters[key],
      ...COUNTER_TONE[key],
    })),
  ];
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
  const progressLabel = t('owner:today.progress', { in: p.inCount, total: p.total });

  const lists = (
    <>
      {s.in.length > 0 || (filter === null && m.mode.kind === 'live') ? (
        <Section title={t('owner:today.sections.in')} count={s.in.length}>
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
      ) : null}
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

  const side = (
    <>
      {filter === null ? <AwayNowSection /> : null}
      {s.notIn.length > 0 ? (
        <Section title={t('owner:today.sections.notIn')} count={s.notIn.length}>
          <List>
            {s.notIn.map((r) => (
              <NotInRow key={r.user.id} row={r} />
            ))}
          </List>
        </Section>
      ) : null}
      {s.dueLater.length > 0 ? (
        <Section title={t('owner:today.sections.dueLater')} count={s.dueLater.length}>
          <List>
            {s.dueLater.map((r) => (
              <ListRow
                key={r.user.id}
                leading={<Avatar name={r.user.name} />}
                title={r.user.name}
                subtitle={
                  r.shiftStart ? t('owner:today.row.shiftAt', { time: r.shiftStart }) : undefined
                }
              />
            ))}
          </List>
        </Section>
      ) : null}
      {s.away.length > 0 ? (
        <Section title={t('owner:today.sections.away')} count={s.away.length}>
          <List>
            {s.away.map((r) => (
              <AwayRow key={r.user.id} row={r} />
            ))}
          </List>
        </Section>
      ) : null}
    </>
  );

  const nothing =
    m.filtered &&
    s.in.length + s.out.length + s.notIn.length + s.dueLater.length + s.away.length === 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-2">
        <Meta>{dayMeta}</Meta>
        {m.mode.kind === 'before' ? (
          <p className="font-extrabold text-text text-xl tracking-display">
            {m.mode.firstShiftStart
              ? t('owner:today.before', { time: m.mode.firstShiftStart })
              : t('owner:today.beforeNoShift')}
          </p>
        ) : (
          <ProgressStrip
            size="lg"
            label={<span data-testid="today-headline">{progressLabel}</span>}
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

      {board.actionsCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border-strong bg-bg-soft px-4 py-3">
          <Icon name="warning-circle" className="size-6 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 basis-48 font-bold text-text">
            {t('owner:today.needsAction', { count: board.actionsCount })}
          </p>
          <Button asChild variant="primary" size="sm" iconEnd="arrow-right">
            <Link to="/o/actions">{t('owner:today.needsActionCta')}</Link>
          </Button>
        </div>
      ) : null}

      {/* PRD 4.18.3: the roll-call that is open or missed (N33), else one quiet line. */}
      <RollCallCard slot={board.rollCall} primary={board.actionsCount === 0} />

      <div className="xl:sticky xl:top-16 xl:z-20 xl:-my-3 xl:bg-bg xl:py-3">
        <StatChipGroup
          legend={t('owner:today.counters.label')}
          legendHidden
          options={options}
          value={filter ?? 'all'}
          onValueChange={(v) => setFilter(v === 'all' ? null : (v as CounterKey))}
        />
      </div>

      {nothing ? (
        <Empty
          action={
            <Button size="sm" variant="secondary" onClick={() => setFilter(null)}>
              {t('owner:today.showAll')}
            </Button>
          }
        >
          {t('owner:today.emptyFilter')}
        </Empty>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:items-start xl:gap-12">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-8">{lists}</div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:sticky xl:top-36">{side}</div>
        </div>
      )}
    </div>
  );
}

function placeTag(row: BoardInRow, t: TFunction) {
  switch (row.place) {
    case 'venue':
      return <StatusChip status="venue" label={row.placeName ?? t('owner:place.venue')} />;
    case 'edge':
      return (
        <Badge tone="warning" icon="warning-circle">
          {t('owner:place.edge')}
        </Badge>
      );
    case 'inside':
      return (
        <Badge tone="success" icon="map-pin">
          {t('owner:place.inside')}
        </Badge>
      );
    case 'offline':
      return (
        <Badge tone="neutral" icon="wifi-slash">
          {t('owner:place.offline')}
        </Badge>
      );
    case 'owner':
      return (
        <Badge tone="outline" icon="pencil-simple">
          {t('owner:place.owner')}
        </Badge>
      );
  }
}

function InRow({ row, date, worked }: { row: BoardInRow; date: string; worked: number }) {
  const { t } = useTranslation();
  const times =
    row.outTs !== null
      ? `${t('owner:today.row.inAt', { time: clock(row.inTs) })} · ${t('owner:today.row.outAt', { time: clock(row.outTs) })}`
      : t('owner:today.row.inAt', { time: clock(row.inTs) });
  const hours =
    row.outTs !== null
      ? t('owner:today.row.worked', { duration: duration(worked) })
      : t('owner:today.row.soFar', { duration: duration(worked) });
  return (
    <ListRow
      asChild
      className={WRAP_ROW}
      leading={<Avatar name={row.user.name} />}
      title={row.user.name}
      subtitle={
        <span className="tabular-nums">
          {times} · {hours}
        </span>
      }
      meta={
        <>
          {row.lateMin > 0 ? (
            <StatusChip
              status="late"
              label={t('owner:today.row.lateBy', { min: row.lateMin })}
              title={t('owner:today.row.lateLabel', { min: row.lateMin })}
            />
          ) : null}
          {row.flagged ? <StatusChip status="flag" label={t('owner:today.row.flagged')} /> : null}
          {row.pending ? (
            <StatusChip status="waiting" label={t('owner:today.row.pending')} />
          ) : null}
          {placeTag(row, t)}
        </>
      }
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
      leading={<Avatar name={row.user.name} />}
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
    <ListRow leading={<Avatar name={row.user.name} />} title={row.user.name} trailing={chip} />
  );
}

function TodaySkeleton() {
  return (
    <div className="grid gap-6">
      <SkeletonGroup className="grid gap-3">
        <Skeleton width="11rem" />
        <Skeleton width="min(14rem, 70%)" height="2.25rem" />
        <Skeleton height="0.5rem" />
      </SkeletonGroup>
      {/* Phones show the counts as tiles (StatChipGroup `tiles`), wider screens as pills. */}
      <SkeletonGroup className="grid grid-cols-3 gap-2 md:hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} shape="block" height="3.75rem" />
        ))}
      </SkeletonGroup>
      <SkeletonGroup className="hidden gap-2 overflow-hidden md:flex">
        {[8, 6, 6, 9, 8].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder chips
          <Skeleton key={i} shape="pill" width={`${w}rem`} height="3rem" />
        ))}
      </SkeletonGroup>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:gap-12">
        <RowsSkeleton rows={6} />
        <RowsSkeleton rows={3} />
      </div>
    </div>
  );
}
