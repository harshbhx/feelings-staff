/**
 * Payroll (PRD 4.13, 5.2, O-13): one row per month with its status (Draft, Finalised, Paid,
 * Replaced, Revision 2), people, net and how many are paid; "Payroll so far" for the running month;
 * **Start payroll** once last month has ended and has no run yet (the cron also makes it on the 1st).
 */
import type { PayrollRunSummary } from '@fs/contracts';
import { Button, List, ListRow, StatusChip, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { usePayrollRuns, useStartPayroll } from '../api/payroll';
import { Section, Tag } from '../components/layout';
import { Empty, QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { money, monthLabel, shortDate, todayIst } from '../lib/format';
import { firstDraftDate, runWord, startableMonth } from './run-model';

export function PayrollListScreen() {
  const { t } = useTranslation();
  const runs = usePayrollRuns();
  const today = todayIst();
  const thisMonth = today.slice(0, 7);
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8">
      <QueryView
        query={runs}
        skeleton={<RowsSkeleton rows={4} />}
        isEmpty={(list) => list.length === 0}
        empty={
          <div className="grid gap-6">
            <Empty>{t('owner:payroll.empty', { date: shortDate(firstDraftDate(today)) })}</Empty>
            <SoFar month={thisMonth} />
          </div>
        }
      >
        {(list) => (
          <>
            <StartPayroll month={startableMonth(list, today)} />
            <Section title={t('owner:screens.payroll')}>
              <List>
                <SoFarRow month={thisMonth} />
                {list.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </List>
            </Section>
          </>
        )}
      </QueryView>
    </div>
  );
}

function StartPayroll({ month }: { month: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const errorText = useErrorText();
  const start = useStartPayroll();
  if (!month) return null;
  return (
    <div>
      <Button
        variant="primary"
        icon="currency-inr"
        disabled={start.isPending}
        onClick={() =>
          start.mutate(month, {
            onSuccess: (view) => navigate(`/o/payroll/${view.run.id}`),
            onError: (e) => {
              if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
            },
          })
        }
      >
        {start.isPending
          ? t('owner:payroll.starting')
          : t('owner:payroll.startMonth', { month: monthLabel(month) })}
      </Button>
    </div>
  );
}

function SoFar({ month }: { month: string }) {
  return (
    <List>
      <SoFarRow month={month} />
    </List>
  );
}

function SoFarRow({ month }: { month: string }) {
  const { t } = useTranslation();
  return (
    <ListRow
      asChild
      title={t('owner:payroll.soFar')}
      subtitle={t('owner:payroll.soFarHint', { month: monthLabel(month) })}
    >
      <Link to="/o/payroll/so-far" />
    </ListRow>
  );
}

function RunRow({ run }: { run: PayrollRunSummary }) {
  const { t } = useTranslation();
  const w = runWord(run);
  const parts = [
    t('owner:payroll.people', { count: run.people }),
    money(run.netPaise),
    run.status === 'finalised'
      ? t('owner:payroll.paidOf', { paid: run.paidCount, count: run.people })
      : null,
  ].filter(Boolean);
  return (
    <ListRow
      asChild
      title={monthLabel(run.month)}
      subtitle={<span className="tabular-nums">{parts.join(' · ')}</span>}
      trailing={
        <span className="flex flex-wrap justify-end gap-1.5">
          {run.revision > 1 ? (
            <Tag>{t('owner:payroll.status.revision', { n: run.revision })}</Tag>
          ) : null}
          <StatusChip status={w.chip} label={t(`owner:payroll.status.${w.word}`)} />
        </span>
      }
    >
      <Link to={`/o/payroll/${run.id}`} />
    </ListRow>
  );
}
