/**
 * Privacy notice (`/me/privacy`, PRD 5.1, 10.6; AC S-16): what the app collects, when it checks
 * location, how long it keeps things, who sees it and the person's rights; the choices they gave
 * (take back the photo consent) and who to ask.
 */
import { formatIndianPhone } from '@fs/contracts';
import { Badge, Button, Card, SkeletonList, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { telLink } from '../../owner/lib/share';
import { useConsentWithdraw, useMyData, useOwnerName } from '../api';
import { useFmt } from '../lib/format';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { latestConsents } from './my-data-model';

const SECTIONS = ['1', '2', '3', '4', '5'] as const;

export function PrivacyScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const toast = useToast();
  const data = useMyData();
  const withdraw = useConsentWithdraw();
  const selfie = data.data
    ? latestConsents(data.data.consents).find((c) => c.kind === 'selfie')
    : undefined;
  const vars = {
    owner,
    location: data.data?.retention.locationDays ?? 90,
    selfie: data.data?.retention.selfieDays ?? 30,
  };

  return (
    <>
      <ScreenHeader title={t('staff:screens.privacy')} back="/me" />
      <main id="main" className="staff-main flex flex-col gap-5">
        <p className="text-text-muted">{t('staff:privacy.lead')}</p>
        {SECTIONS.map((n) => (
          <section key={n} aria-labelledby={`pv-${n}`} className="flex flex-col gap-1">
            <h2 id={`pv-${n}`} className="text-base">
              {t(`staff:privacy.h${n}`)}
            </h2>
            <p>{t(`staff:privacy.p${n}`, vars)}</p>
          </section>
        ))}

        <Card title={t('staff:privacy.choices')}>
          {data.isError && !data.data ? (
            <QueryError
              error={data.error}
              message={t('staff:privacy.loadError')}
              onRetry={() => void data.refetch()}
            />
          ) : !data.data ? (
            <SkeletonList rows={1} label={t('common:states.loading')} />
          ) : selfie && !selfie.withdrawnAt ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t('staff:privacy.selfieOn')}</p>
              <div>
                <Button
                  variant="danger-secondary"
                  loading={withdraw.isPending}
                  onClick={() => {
                    if (!window.confirm(t('staff:privacy.withdrawConfirm', { owner }))) return;
                    withdraw.mutate('selfie', {
                      onSuccess: () => toast({ title: t('staff:privacy.withdrawn') }),
                      onError: () => toast({ tone: 'error', title: t('errors:generic') }),
                    });
                  }}
                >
                  {t('staff:privacy.withdraw')}
                </Button>
              </div>
            </div>
          ) : selfie?.withdrawnAt ? (
            <Badge tone="neutral" icon="check-circle">
              {t('staff:privacy.selfieOff', { date: fmt.date(selfie.withdrawnAt) })}
            </Badge>
          ) : (
            <p className="text-sm text-text-muted">{t('staff:privacy.selfieNever')}</p>
          )}
        </Card>

        {data.data ? (
          <Card title={t('staff:myData.grievance')} tone="soft">
            <div className="flex flex-col gap-3">
              <p className="font-semibold text-text tabular">
                {t('staff:myData.grievanceLine', {
                  name: data.data.grievance.name,
                  phone: formatIndianPhone(data.data.grievance.phone),
                })}
              </p>
              <div>
                <Button variant="secondary" icon="phone" asChild>
                  <a href={telLink(data.data.grievance.phone)}>{t('common:actions.call')}</a>
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </main>
    </>
  );
}
