/**
 * Today board (PRD 5.2, O-03): readable in two seconds. One line says how the day is going, the
 * counters filter the lists, and the lists say who is in, who is not in yet (with Call and
 * WhatsApp), who has checked out and who is away. Polls every 30 s while visible; a push refetches.
 */
import type { TodayBoard } from '@fs/contracts';
import {
  Avatar,
  Button,
  ChipGroup,
  Icon,
  List,
  ListRow,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTodayBoard } from '../api/attendance';
import { Meta, Section, Tag, useNow } from '../components/layout';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { clock, dayLabel, duration } from '../lib/format';
import { telLink, waLink } from '../lib/share';
import { leaveKey } from '../lib/status';
import {
  type BoardAwayRow,
  type BoardInRow,
  type BoardNotInRow,
  boardModel,
  COUNTER_ORDER,
  type CounterKey,
  headlineParts,
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
      <div className="grid gap-4">
        <Meta>{dayMeta}</Meta>
        <Empty>{t('owner:today.closed', { name: m.mode.holidayName })}</Empty>
      </div>
    );
  }

  const options = [
    { value: 'all', label: t('owner:common.everyone') },
    ...COUNTER_ORDER.map((key) => ({
      value: key,
      label: t(`owner:today.counters.${key}`),
      count: board.counters[key],
    })),
  ];

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
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Meta>{dayMeta}</Meta>
        {m.mode.kind === 'before' ? (
          <p className="font-extrabold text-text text-xl tracking-display">
            {m.mode.firstShiftStart
              ? t('owner:today.before', { time: m.mode.firstShiftStart })
              : t('owner:today.beforeNoShift')}
          </p>
        ) : (
          <p
            className="font-extrabold text-2xl text-text tracking-display"
            data-testid="today-headline"
          >
            {headlineParts(board).map((p, i) => (
              <span key={p.key}>
                {i > 0 ? <span className="text-text-muted"> · </span> : null}
                {t(p.key, { count: p.count })}
              </span>
            ))}
          </p>
        )}
      </div>

      {board.actionsCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border bg-bg-soft px-4 py-3">
          <Icon name="warning-circle" className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 font-bold text-text">
            {t('owner:today.needsAction', { count: board.actionsCount })}
          </p>
          <Button asChild variant="primary" size="sm" iconEnd="arrow-right">
            <Link to="/o/actions">{t('owner:today.needsActionCta')}</Link>
          </Button>
        </div>
      ) : null}

      <ChipGroup
        type="radio"
        legend={t('owner:today.counters.label')}
        legendHidden
        layout="scroll"
        options={options}
        value={filter ?? 'all'}
        onValueChange={(v) => setFilter(v === 'all' ? null : (v as CounterKey))}
      />

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
          <div className="grid gap-8">{lists}</div>
          <div className="grid gap-8">{side}</div>
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
      return <Tag>{t('owner:place.edge')}</Tag>;
    case 'inside':
      return <Tag>{t('owner:place.inside')}</Tag>;
    case 'offline':
      return <Tag>{t('owner:place.offline')}</Tag>;
    case 'owner':
      return <Tag>{t('owner:place.owner')}</Tag>;
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
      leading={<Avatar name={row.user.name} />}
      title={row.user.name}
      subtitle={
        <span className="tabular-nums">
          {times} · {hours}
        </span>
      }
      trailing={
        <span className="flex flex-wrap justify-end gap-1.5">
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
          <span className="hidden sm:inline-flex">{placeTag(row, t)}</span>
        </span>
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
      <SkeletonGroup className="grid gap-2">
        <Skeleton width="11rem" />
        <Skeleton width="min(22rem, 90%)" height="2.25rem" />
      </SkeletonGroup>
      <SkeletonGroup className="flex gap-2 overflow-hidden">
        {[5, 6, 7, 6, 6, 7].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder chips
          <Skeleton key={i} shape="pill" width={`${w}rem`} height="2.75rem" />
        ))}
      </SkeletonGroup>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:gap-12">
        <RowsSkeleton rows={6} />
        <RowsSkeleton rows={3} />
      </div>
    </div>
  );
}
