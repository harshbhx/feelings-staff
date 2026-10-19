/**
 * The Settle credits step on the payroll run (PRD 4.13.3, 4.19.3): who has a balance at the month end
 * and what is settled so far, with the way into the step. Owner only; hidden when no one has a
 * balance. On the payslip review, the `time_credits` line links back to the step while it is a draft.
 */
import { ApiError, type PayslipLine } from '@fs/contracts';
import { Button, Card } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePayrollCredits } from '../api/credits';
import { ErrorCard } from '../components/states';
import { money } from '../lib/format';
import { settleSummary, signedMin } from './credits-model';

/** Answers that mean "nothing to show here", not a broken screen. */
const quiet = (e: unknown) =>
  e instanceof ApiError && (e.code === 'NOT_IMPLEMENTED' || e.code === 'FORBIDDEN');

export function SettleCreditsCard({ runId, final }: { runId: string; final: boolean }) {
  const { t } = useTranslation();
  const query = usePayrollCredits(runId);
  if (query.isError && !query.data)
    return quiet(query.error) ? null : (
      <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
    );
  const rows = query.data?.rows ?? [];
  if (rows.length === 0) return null;
  const s = settleSummary(rows);
  return (
    <Card
      title={t('owner:credits.settle.cardTitle')}
      data-testid="settle-credits-card"
      className="max-w-(--container-narrow)"
    >
      <div className="grid gap-4">
        <p className="text-text-body tabular-nums">
          {t('owner:credits.settle.cardPeople', { count: s.people })}{' '}
          {s.settled > 0
            ? t('owner:credits.settle.cardSettled', {
                settled: s.settled,
                min: signedMin(s.minutes),
                money: money(s.amountPaise),
              })
            : t('owner:credits.settle.cardNothing')}
        </p>
        <div>
          <Button asChild variant="secondary" iconEnd="arrow-right">
            <Link to={`/o/payroll/${runId}/credits`}>
              {final ? t('owner:credits.settle.view') : t('owner:credits.settle.open')}
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Under a draft payslip: the Time credits line and where to change it. */
export function SlipCreditsNote({ runId, line }: { runId: string; line: PayslipLine }) {
  const { t } = useTranslation();
  return (
    <Card title={t('owner:credits.settle.cardTitle')} headingLevel={2}>
      <div className="grid gap-3">
        <p className="flex items-baseline justify-between gap-4 text-text">
          <span>{line.label}</span>
          <span className="whitespace-nowrap font-semibold tabular-nums">
            {money(line.amountPaise)}
          </span>
        </p>
        <div>
          <Button asChild size="sm" variant="secondary" iconEnd="arrow-right">
            <Link to={`/o/payroll/${runId}/credits`}>{t('owner:credits.slip.line')}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
