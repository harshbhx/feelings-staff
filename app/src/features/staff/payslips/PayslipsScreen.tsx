/**
 * Payslips (`/payslips`, PRD 5.1, 4.14; AC S-14): one row per payslip revision with the net amount and the
 * paid date; tap for the payslip. Empty and "not shown in the app" states in words.
 */
import type { PayslipSummary } from '@fs/contracts';
import { Badge, EmptyState, List, ListRow, SkeletonList } from '@fs/ui';
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
          <EmptyState>{t('staff:payslips.hidden', { owner })}</EmptyState>
        ) : list.isError ? (
          <QueryError
            error={list.error}
            message={t('staff:payslips.loadError')}
            onRetry={() => void list.refetch()}
          />
        ) : !list.data ? (
          <SkeletonList rows={4} label={t('common:states.loading')} />
        ) : list.data.length === 0 ? (
          <EmptyState>{t('staff:payslips.empty')}</EmptyState>
        ) : (
          <List framed>
            {sortPayslips(list.data).map((p) => (
              <PayslipRow key={p.id} slip={p} />
            ))}
          </List>
        )}
      </main>
    </>
  );
}

function PayslipRow({ slip }: { slip: PayslipSummary }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  return (
    <ListRow
      asChild
      title={t('staff:payslips.row', {
        month: fmt.month(slip.month),
        net: fmt.rupees(slip.netPaise),
      })}
      subtitle={
        slip.paidOn && slip.payMode
          ? t('staff:payslips.paid', {
              date: fmt.date(slip.paidOn),
              mode: t(`staff:payslips.mode.${slip.payMode}`),
            })
          : t('staff:payslips.notPaid')
      }
      trailing={
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
