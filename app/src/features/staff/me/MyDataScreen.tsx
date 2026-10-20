/**
 * My data (`/me/data`, PRD 5.1, 10.6; AC S-16): the check-ins and check-outs the app keeps, with
 * the location result and how long the exact location stays, selfies while kept, what I agreed
 * to, retention, a correction request and the grievance contact. The presence list is a later
 * slice. Never credits, balances or rupees.
 */
import { formatIndianPhone, type MyData } from '@fs/contracts';
import { Badge, Button, Card, EmptyState, List, ListRow, SkeletonList } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { telLink, waLink } from '../../owner/lib/share';
import { useMyData, useOwnerName } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { latestConsents, nextSelfieDeletion } from './my-data-model';

type Punch = MyData['punches'][number];

export function MyDataScreen() {
  const { t } = useTranslation();
  const data = useMyData();
  return (
    <>
      <ScreenHeader
        title={t('staff:screens.myData')}
        back="/me"
        dataAt={data.dataUpdatedAt || undefined}
      />
      <main id="main" className="staff-main flex flex-col gap-5">
        {data.data ? (
          <Body data={data.data} />
        ) : data.isError ? (
          <QueryError
            error={data.error}
            message={t('errors:loadFailed')}
            onRetry={() => void data.refetch()}
          />
        ) : (
          <SkeletonList rows={4} label={t('common:states.loading')} />
        )}
      </main>
    </>
  );
}

function fenceBadge(t: ReturnType<typeof useTranslation>['t'], p: Punch) {
  const r = p.fenceResult;
  if (r === 'pass')
    return { tone: 'success', icon: 'check-circle', text: t('staff:myData.fence.pass') } as const;
  if (r === 'uncertain')
    return { tone: 'warning', icon: 'map-pin', text: t('staff:myData.fence.uncertain') } as const;
  if (r === 'outside')
    return { tone: 'info', icon: 'map-pin', text: t('staff:myData.fence.outside') } as const;
  if (r === 'approximate')
    return { tone: 'neutral', icon: 'map-pin', text: t('staff:myData.fence.approximate') } as const;
  return { tone: 'outline', icon: 'minus', text: t('staff:myData.fence.none') } as const;
}

function PunchLine({ p, fmt }: { p: Punch; fmt: Fmt }) {
  const { t } = useTranslation();
  const badge = fenceBadge(t, p);
  const where = p.placeName ?? p.siteName;
  return (
    <ListRow
      title={t('staff:myData.punchRow', {
        kind: t(`staff:myData.kind.${p.kind}`),
        date: fmt.date(p.effectiveTs),
        time: fmt.clock(p.effectiveTs),
      })}
      subtitle={
        [where, p.distanceBucket ? t('staff:myData.bucket', { bucket: p.distanceBucket }) : null]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      meta={
        p.locationKept && p.locationDeletesOn
          ? t('staff:myData.locationKept', { date: fmt.date(p.locationDeletesOn) })
          : t('staff:myData.locationGone')
      }
      trailing={
        <Badge tone={badge.tone} icon={badge.icon}>
          {badge.text}
        </Badge>
      }
    />
  );
}

function Body({ data }: { data: MyData }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const nextGone = nextSelfieDeletion(data.selfies);
  return (
    <>
      <p className="text-text-muted">{t('staff:myData.lead')}</p>

      <section aria-labelledby="md-punches" className="flex flex-col gap-2">
        <h2 id="md-punches" className="text-base">
          {t('staff:myData.punches')}
        </h2>
        {data.punches.length ? (
          <List framed>
            {data.punches.map((p) => (
              <PunchLine key={p.id} p={p} fmt={fmt} />
            ))}
          </List>
        ) : (
          <EmptyState>{t('staff:myData.punchesNone')}</EmptyState>
        )}
      </section>

      <section aria-labelledby="md-presence" className="flex flex-col gap-2">
        <h2 id="md-presence" className="text-base">
          {t('staff:myData.presence')}
        </h2>
        <List framed>
          <ListRow
            asChild
            title={t('staff:myData.presenceRow')}
            subtitle={t('staff:myData.presenceHint')}
          >
            <Link to="/me/data/presence" />
          </ListRow>
        </List>
      </section>

      <section aria-labelledby="md-selfies" className="flex flex-col gap-2">
        <h2 id="md-selfies" className="text-base">
          {t('staff:myData.selfies')}
        </h2>
        <p className="text-sm text-text-muted">
          {nextGone
            ? t('staff:myData.selfieRule', {
                days: data.retention.selfieDays,
                date: fmt.date(nextGone),
              })
            : t('staff:myData.selfiesNone')}
        </p>
        {data.selfies.length ? (
          <List framed>
            {data.selfies.map((s) => (
              <ListRow
                key={s.punchId}
                leading={
                  <img
                    src={s.url}
                    alt={t('staff:myData.selfieAlt', { date: fmt.date(s.takenAt) })}
                    width={56}
                    height={56}
                    loading="lazy"
                    className="size-14 rounded-md object-cover"
                  />
                }
                title={t('staff:myData.selfieRow', {
                  date: fmt.date(s.takenAt),
                  deletes: fmt.date(s.deletesOn),
                })}
              />
            ))}
          </List>
        ) : null}
      </section>

      <section aria-labelledby="md-consents" className="flex flex-col gap-2">
        <h2 id="md-consents" className="text-base">
          {t('staff:myData.consents')}
        </h2>
        <List framed>
          {latestConsents(data.consents).map((c) => (
            <ListRow
              key={c.kind}
              title={t(`staff:myData.consentKind.${c.kind}`)}
              subtitle={t('staff:myData.consentRow', {
                version: c.version,
                date: fmt.date(c.acceptedAt),
              })}
              meta={
                c.withdrawnAt
                  ? t('staff:myData.consentWithdrawn', { date: fmt.date(c.withdrawnAt) })
                  : undefined
              }
            />
          ))}
        </List>
      </section>

      <Card title={t('staff:myData.retention')}>
        <p className="text-sm tabular">
          {t('staff:myData.retentionLine', {
            location: data.retention.locationDays,
            selfie: data.retention.selfieDays,
            wage: data.retention.wageYears,
          })}
        </p>
      </Card>

      <Card title={t('staff:myData.grievance')} tone="soft">
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-text tabular">
            {t('staff:myData.grievanceLine', {
              name: data.grievance.name,
              phone: formatIndianPhone(data.grievance.phone),
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" icon="phone" asChild>
              <a href={telLink(data.grievance.phone)}>{t('common:actions.call')}</a>
            </Button>
            <Button variant="secondary" icon="whatsapp-logo" asChild>
              <a
                href={waLink(data.grievance.phone, t('staff:myData.correctionText', { owner }))}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('staff:myData.correction')}
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
