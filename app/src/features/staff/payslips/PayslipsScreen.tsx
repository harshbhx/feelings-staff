/**
 * Payslips (`/payslips`, PRD 5.1, 4.14; AC S-14): one row per payslip revision with the net amount and the
 * paid date; tap for the payslip. Empty and "not shown in the app" states in words.
 */
import type { PayslipSummary } from '@fs/contracts';
import { Badge, EmptyState, List, ListRow, SkeletonList, StatusChip } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useOwnerName, usePayslips, useStaffMe } from '../api';
import { useFmt } from '../lib/format';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { sortPayslips } from './payslip-model';

export function PayslipsScreen() {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const me = useStaffMe();
  const list = usePayslips(me.flags.showPayslips);
  return (
    <>
      <ScreenHeader title={t('staff:screens.payslips')} dataAt={list.dataUpdatedAt || undefined} />
      <main id="main" className="staff-main flex flex-col gap-4">
        {!me.flags.showPayslips ? (
          <EmptyState icon="lock">{t('staff:payslips.hidden', { owner })}</EmptyState>
        ) : list.isError ? (
          <QueryError
            error={list.error}
            message={t('staff:payslips.loadError')}
            onRetry={() => void list.refetch()}
          />
        ) : !list.data ? (
          <SkeletonList rows={4} label={t('common:states.loading')} />
        ) : list.data.length === 0 ? (
          <EmptyState icon="hourglass">{t('staff:payslips.empty')}</EmptyState>
        ) : (
          <PayslipList slips={sortPayslips(list.data)} />
        )}
      </main>
    </>
  );
}

/** The latest month is the page's main number; older months follow as rows. */
function PayslipList({ slips }: { slips: PayslipSummary[] }) {
  const { t } = useTranslation();
  const [latest, ...older] = slips;
  if (!latest) return null;
  return (
    <>
      <PayslipHero slip={latest} />
      {older.length ? (
        <section aria-labelledby="payslips-older" className="flex flex-col gap-2">
          <h2 id="payslips-older" className="text-sm font-semibold text-text-muted">
            {t('staff:payslips.older')}
          </h2>
          <List framed>
            {older.map((p) => (
              <PayslipRow key={p.id} slip={p} />
            ))}
          </List>
        </section>
      ) : null}
    </>
  );
}

function PayslipHero({ slip }: { slip: PayslipSummary }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const { paidOn, payMode } = slip;
  return (
    <Link to={`/payslips/${slip.id}`} className="staff-pay-hero" data-testid="payslip-hero">
      <span className="text-sm font-semibold text-text-body">{fmt.month(slip.month)}</span>
      <span className="staff-pay-hero__amount">{fmt.rupees(slip.netPaise)}</span>
      <span className="flex flex-wrap items-center gap-2">
        {paidOn && payMode ? (
          <StatusChip
            status="present"
            label={t('staff:payslips.paid', {
              date: fmt.date(paidOn),
              mode: t(`staff:payslips.mode.${payMode}`),
            })}
          />
        ) : (
          <StatusChip status="waiting" label={t('staff:payslips.notPaid')} />
        )}
        {slip.revision > 1 ? (
          <Badge tone="outline" icon="clock">
            {t('staff:payslips.revision', { n: slip.revision })}
          </Badge>
        ) : null}
      </span>
    </Link>
  );
}

function PayslipRow({ slip }: { slip: PayslipSummary }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  return (
    <ListRow
      asChild
      title={fmt.month(slip.month)}
      subtitle={
        slip.paidOn && slip.payMode
          ? t('staff:payslips.paid', {
              date: fmt.date(slip.paidOn),
              mode: t(`staff:payslips.mode.${slip.payMode}`),
            })
          : t('staff:payslips.notPaid')
      }
      trailing={<span className="font-bold tabular-nums">{fmt.rupees(slip.netPaise)}</span>}
      meta={
        slip.superseded ? (
          <Badge tone="outline" icon="clock">
            {t('staff:payslips.superseded')}
          </Badge>
        ) : slip.revision > 1 ? (
          <Badge tone="outline" icon="clock">
            {t('staff:payslips.revision', { n: slip.revision })}
          </Badge>
        ) : undefined
      }
    >
      <Link to={`/payslips/${slip.id}`} />
    </ListRow>
  );
}
