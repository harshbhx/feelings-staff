/**
 * My data -> Presence (`/me/data/presence`, PRD 4.18.4, 5.1 My data, 10.6; S-24.4): the person's
 * own roll-call marks (Here, Not here), step-outs with their reason, note and state (Waiting,
 * Counted, Work, Ignored), and location checks (inside, edge, outside, no fix, distance bucket).
 * Never credits, balances or rupees (7.17.9). One month at a time (`?month=YYYY-MM`).
 */
import { istDate, type PresenceHistory } from '@fs/contracts';
import {
  Badge,
  type BadgeTone,
  Icon,
  IconButton,
  type IconName,
  List,
  ListRow,
  Skeleton,
  SkeletonGroup,
  StatusChip,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useOwnerName } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { monthNav } from '../month/month-model';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { withPresenceCopy } from './copy';
import { type HistoryItem, historyByDay } from './history-model';
import { usePresenceHistory } from './sheet-api';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function HistoryScreenView() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const [params, setParams] = useSearchParams();
  const asked = params.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : istDate(Date.now()).slice(0, 7);
  const history = usePresenceHistory(month);
  const nav = monthNav(month, istDate(Date.now()).slice(0, 7));
  const go = (m: string) => setParams({ month: m }, { replace: true });
  return (
    <>
      <ScreenHeader
        title={t('presence:history.title')}
        back="/me/data"
        dataAt={history.dataUpdatedAt || undefined}
      />
      <main id="main" className="staff-main flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <IconButton
              icon="caret-left"
              label={t('staff:month.prev')}
              onClick={() => go(nav.prev)}
            />
            <p className="text-lg font-bold text-text" aria-live="polite">
              {fmt.month(month)}
            </p>
            <IconButton
              icon="caret-right"
              label={t('staff:month.next')}
              onClick={() => nav.next && go(nav.next)}
              disabled={!nav.next}
            />
          </div>
          <p className="text-text-muted">{t('presence:history.intro', { owner })}</p>
        </div>
        {history.data ? (
          <HistoryBody history={history.data} fmt={fmt} />
        ) : history.isError ? (
          <QueryError
            error={history.error}
            message={t('presence:history.loadError')}
            onRetry={() => void history.refetch()}
          />
        ) : (
          <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-4">
            <Skeleton width="40%" />
            <Skeleton shape="block" height="10rem" />
          </SkeletonGroup>
        )}
      </main>
    </>
  );
}

function HistoryBody({ history, fmt }: { history: PresenceHistory; fmt: Fmt }) {
  const { t } = useTranslation();
  const days = historyByDay(history);
  if (days.length === 0)
    return <p className="staff-card text-text-body">{t('presence:history.empty')}</p>;
  return (
    <>
      {days.map((d) => (
        <section key={d.date} aria-labelledby={`p-${d.date}`} className="flex flex-col gap-2">
          <h2 id={`p-${d.date}`} className="text-sm font-semibold text-text-muted">
            {fmt.weekday(d.date)}
          </h2>
          <List framed>
            {d.items.map((item) => (
              <HistoryRow key={item.key} item={item} fmt={fmt} t={t} />
            ))}
          </List>
        </section>
      ))}
    </>
  );
}

const STATE: Record<
  'open' | 'waiting' | 'counted' | 'work' | 'ignored',
  { tone: BadgeTone; icon: IconName }
> = {
  open: { tone: 'info', icon: 'sign-out' },
  waiting: { tone: 'neutral', icon: 'hourglass' },
  counted: { tone: 'neutral', icon: 'check' },
  work: { tone: 'success', icon: 'check-circle' },
  ignored: { tone: 'outline', icon: 'x' },
};

const CHECK: Record<'inside' | 'edge' | 'outside' | 'no_fix', { tone: BadgeTone; icon: IconName }> =
  {
    inside: { tone: 'success', icon: 'map-pin' },
    edge: { tone: 'warning', icon: 'map-pin' },
    outside: { tone: 'warning', icon: 'navigation' },
    no_fix: { tone: 'neutral', icon: 'wifi-slash' },
  };

function HistoryRow({ item, fmt, t }: { item: HistoryItem; fmt: Fmt; t: TFunction }) {
  switch (item.kind) {
    case 'roll_call':
      return (
        <ListRow
          leading={<Icon name="users" />}
          title={
            <span className="tabular">{t('presence:history.rollCall', { time: item.time })}</span>
          }
          trailing={
            item.mark === 'here' ? (
              <StatusChip status="present" label={t('presence:history.here')} />
            ) : (
              <StatusChip status="absent" label={t('presence:history.notHere')} />
            )
          }
        />
      );
    case 'away': {
      const a = item.away;
      const title =
        a.endTs === null
          ? t('presence:history.outSince', { time: fmt.clock(a.startTs) })
          : t('presence:history.out', {
              from: fmt.clock(a.startTs),
              to: fmt.clock(a.endTs),
              min: a.awayMin,
            });
      const parts = [
        a.reason ? t(`presence:reason.${a.reason}`) : null,
        a.markedByName ? t('presence:history.markedBy', { name: a.markedByName }) : null,
        a.staffNote ? t('presence:card.yourNote', { note: a.staffNote }) : null,
      ].filter(Boolean);
      const s = STATE[a.state];
      return (
        <ListRow
          leading={<Icon name="sign-out" />}
          title={<span className="tabular">{title}</span>}
          subtitle={parts.length > 0 ? parts.join(' · ') : undefined}
          trailing={
            <Badge tone={s.tone} icon={s.icon}>
              {t(`presence:history.state.${a.state}`)}
            </Badge>
          }
        />
      );
    }
    case 'check': {
      const c = item.check;
      const s = CHECK[c.result];
      return (
        <ListRow
          leading={<Icon name="map-pin" />}
          title={
            <span className="tabular">{t('presence:history.check', { time: item.time })}</span>
          }
          subtitle={
            c.distanceBucket
              ? t('presence:history.distance', { bucket: c.distanceBucket.replace('-', '–') })
              : undefined
          }
          trailing={
            <Badge tone={s.tone} icon={s.icon}>
              {t(`presence:history.result.${c.result}`)}
            </Badge>
          }
        />
      );
    }
  }
}

export const PresenceHistoryScreen = withPresenceCopy(HistoryScreenView);
