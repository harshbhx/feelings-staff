/**
 * Day detail (`/day/:date`, PRD 5.1; AC S-11.2): the day's status and shift, worked against
 * scheduled, every punch with its tags, the pay effect line by line ("−₹26.88 for 30 min late"),
 * owner edits, and "Something's wrong with this day".
 */
import type { DayDetail, PunchView } from '@fs/contracts';
import {
  Button,
  Icon,
  type IconName,
  List,
  ListRow,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useDay, useOwnerName } from '../api';
import { useFmt } from '../lib/format';
import { ActionBar } from '../shell/ActionBar';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { chipStatusOf } from './month-model';

const KIND_ICON: Record<PunchView['kind'], IconName> = {
  in: 'sign-in',
  out: 'sign-out',
  break_start: 'coffee',
  break_end: 'coffee',
};

export function DayScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const { date = '' } = useParams();
  const day = useDay(date);
  const title = /^\d{4}-\d{2}-\d{2}$/.test(date) ? fmt.weekday(date) : t('staff:screens.day');
  return (
    <>
      <ScreenHeader
        title={title}
        back={`/month?m=${date.slice(0, 7)}`}
        dataAt={day.dataUpdatedAt || undefined}
      />
      <main id="main" className="staff-main flex flex-col gap-6">
        {day.data ? (
          <DayBody detail={day.data} />
        ) : day.isError ? (
          <QueryError
            error={day.error}
            message={t('staff:day.loadError')}
            onRetry={() => void day.refetch()}
          />
        ) : (
          <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-4">
            <Skeleton width="40%" height="1.75rem" />
            <Skeleton width="70%" />
            <Skeleton shape="block" height="8rem" />
          </SkeletonGroup>
        )}
      </main>
    </>
  );
}

function DayBody({ detail }: { detail: DayDetail }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const { day, schedule } = detail;
  const chip = chipStatusOf(day);
  const times = schedule.segments
    .map((s) => t('common:time.range', { from: s.start, to: s.end }))
    .join(', ');
  const visible = detail.punches.filter((p) => p.status !== 'superseded');

  return (
    <>
      <section className="flex flex-col gap-2">
        {chip ? (
          <div>
            <StatusChip status={chip} label={t(`staff:status.${day.status}`)} />
          </div>
        ) : null}
        {day.holidayName ? <p>{t('staff:day.holiday', { name: day.holidayName })}</p> : null}
        {times ? (
          <p className="tabular text-text-muted">
            {schedule.templateName
              ? t('staff:today.shift', { name: schedule.templateName, times })
              : t('staff:today.shiftNoName', { times })}
          </p>
        ) : null}
        {day.workedMin > 0 || day.scheduledMin > 0 ? (
          <p className="text-lg font-bold text-text tabular">
            {day.scheduledMin > 0
              ? t('staff:day.worked', {
                  worked: fmt.duration(day.workedMin),
                  scheduled: fmt.duration(day.scheduledMin),
                })
              : t('staff:day.workedOnly', { worked: fmt.duration(day.workedMin) })}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="day-punches" className="flex flex-col gap-2">
        <h2 id="day-punches">{t('staff:day.punches')}</h2>
        {visible.length ? (
          <List framed>
            {visible.map((p) => (
              <PunchRow key={p.id} punch={p} />
            ))}
          </List>
        ) : (
          <p className="text-text-muted">{t('staff:day.noPunches')}</p>
        )}
      </section>

      <section aria-labelledby="day-pay" className="flex flex-col gap-2">
        <h2 id="day-pay">{t('staff:day.pay')}</h2>
        {detail.lines.length ? (
          <List framed>
            {detail.lines.map((line) => (
              <ListRow
                key={`${line.code}-${line.label}`}
                title={line.label}
                subtitle={<span className="tabular">{line.formula}</span>}
                trailing={
                  line.amountPaise !== null ? (
                    <span
                      className={`font-bold tabular ${line.amountPaise < 0 ? 'text-absent' : 'text-text'}`}
                    >
                      {fmt.rupees(line.amountPaise)}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </List>
        ) : (
          <p className="text-text-muted">{t('staff:day.noPayEffect')}</p>
        )}
      </section>

      {detail.edits.length ? (
        <section className="flex flex-col gap-2">
          {detail.edits.map((e) => (
            <div key={e.id} className="staff-card staff-card--soft text-sm">
              <p className="font-semibold text-text">
                {t('staff:day.edited', {
                  name: e.actorName ?? owner,
                  date: fmt.date(e.createdAt),
                })}
              </p>
              {e.reason ? <p>{t('staff:day.editedReason', { reason: e.reason })}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {detail.openRegularisation ? (
        <p className="staff-card text-sm">
          {t('staff:day.openFix', { date: fmt.date(detail.openRegularisation.createdAt), owner })}
        </p>
      ) : !detail.canRegularise ? (
        <p className="text-sm text-text-muted">{t('staff:day.cantFix', { owner })}</p>
      ) : null}

      {detail.canRegularise && !detail.openRegularisation ? (
        <ActionBar>
          <Button variant="secondary" block icon="warning-circle" asChild>
            <Link to={`/requests/fix?date=${day.workDate}`}>{t('staff:day.something')}</Link>
          </Button>
        </ActionBar>
      ) : null}
    </>
  );
}

function PunchRow({ punch }: { punch: PunchView }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const kind = t(`staff:day.kind.${punch.kind}`);
  const place = punch.placeName ?? (punch.offsiteDutyId && punch.siteName ? punch.siteName : null);
  const tags: string[] = [];
  if (punch.source === 'offline') tags.push(t('staff:tags.offline'));
  if (punch.source === 'auto') tags.push(t('staff:tags.auto'));
  if (punch.edited || punch.source === 'owner') tags.push(t('staff:tags.edited', { owner }));
  if (place) tags.push(t('staff:tags.offsite'));
  return (
    <ListRow
      leading={<Icon name={KIND_ICON[punch.kind]} />}
      title={
        <span className="tabular">
          {kind} · {fmt.clock(punch.effectiveTs)}
        </span>
      }
      subtitle={[
        place ? t('staff:today.atPlace', { place }) : t('staff:today.atSalon'),
        ...tags,
      ].join(' · ')}
      trailing={
        punch.status === 'pending' ? (
          <StatusChip status="waiting" label={t('staff:tags.pending')} />
        ) : punch.status === 'rejected' ? (
          <StatusChip status="absent" label={t('staff:tags.rejected')} />
        ) : undefined
      }
    />
  );
}
