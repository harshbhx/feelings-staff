/**
 * Credits (PRD 4.19.1, O-29): one row per active staff member with the balance in minutes (+50,
 * −130), its rough money at 1× ("worth about ₹45", "might cut around ₹96"), the last settlement and
 * the away intervals still waiting for a decision. Counts filter plus or minus; sort by balance or
 * name. Nothing here changes pay: a row opens the person's ledger. Owner only (PRD 7.17.9).
 */
import type { CreditsOverview, CreditsRow } from '@fs/contracts';
import { Avatar, Badge, Banner, Button, Field, List, ListRow, Select, StatChipGroup } from '@fs/ui';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCreditsOverview } from '../api/credits';
import { Meta, WRAP_ROW } from '../components/layout';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { longDate, money, monthName } from '../lib/format';
import {
  BALANCE_SORTS,
  type BalanceFilter,
  type BalanceSort,
  balanceCounts,
  signedMin,
  visibleRows,
} from './credits-model';
import { Balance, useEstimateText } from './parts';

export function CreditsScreen() {
  const query = useCreditsOverview();
  return (
    <QueryView query={query} skeleton={<RowsSkeleton rows={6} />}>
      {(view) => <Body view={view} />}
    </QueryView>
  );
}

function lastSettled(r: CreditsRow, t: TFunction): string {
  const s = r.lastSettlement;
  if (!s) return t('owner:credits.neverSettled');
  // A word joiner after the sign keeps "−₹44.44" on one line (it broke after the minus).
  return t('owner:credits.lastSettled', {
    month: monthName(s.month),
    min: signedMin(s.appliedMin),
    money: money(s.amountPaise).replace(/^([−-])/, '$1\u2060'),
  });
}

function Body({ view }: { view: CreditsOverview }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<BalanceFilter>('all');
  const [sort, setSort] = useState<BalanceSort>('minus');
  const counts = balanceCounts(view.staff);
  const rows = visibleRows(view.staff, filter, sort);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Meta className="max-w-(--container-narrow)">
        {t('owner:credits.lead', { date: longDate(view.asOf) })}
      </Meta>
      {!view.enabled ? (
        <Banner
          icon="warning-circle"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/o/settings/credits">{t('owner:credits.openSettings')}</Link>
            </Button>
          }
        >
          {t('owner:credits.off')}
        </Banner>
      ) : null}

      {view.staff.length === 0 ? (
        <Empty>{t('owner:credits.empty')}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <StatChipGroup
              legend={t('owner:credits.show')}
              legendHidden
              value={filter}
              onValueChange={(v) => setFilter(v as BalanceFilter)}
              options={[
                { value: 'all', count: counts.all, label: t('owner:credits.filter.all') },
                {
                  value: 'plus',
                  count: counts.plus,
                  label: t('owner:credits.filter.plus'),
                  tone: 'present',
                  icon: 'plus',
                },
                {
                  value: 'minus',
                  count: counts.minus,
                  label: t('owner:credits.filter.minus'),
                  tone: 'late',
                  icon: 'minus',
                },
              ]}
            />
            <Field label={t('owner:credits.sort.label')} className="w-full max-w-60">
              <Select
                value={sort}
                onValueChange={(v) => setSort(v as BalanceSort)}
                options={BALANCE_SORTS.map((s) => ({
                  value: s,
                  label: t(`owner:credits.sort.${s}`),
                }))}
              />
            </Field>
          </div>

          {rows.length === 0 ? (
            <Empty>{t('owner:credits.emptyFilter')}</Empty>
          ) : (
            <>
              <div className="hidden xl:block">
                <CreditsTable rows={rows} asOf={view.asOf} />
              </div>
              <div className="max-w-(--container-narrow) xl:hidden">
                <CreditsList rows={rows} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AwayBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <Badge tone="warning" icon="hourglass">
      {t('owner:credits.awayWaiting', { count })}
    </Badge>
  );
}

function CreditsList({ rows }: { rows: CreditsRow[] }) {
  const { t } = useTranslation();
  const estimate = useEstimateText();
  return (
    <List>
      {rows.map((r) => (
        <ListRow
          key={r.userId}
          asChild
          className={WRAP_ROW}
          leading={<Avatar name={r.name} />}
          title={r.name}
          subtitle={
            <span className="grid gap-0.5">
              <span>{estimate(r.estimatePaise, r.balanceMin)}</span>
              <span className="tabular-nums">{lastSettled(r, t)}</span>
            </span>
          }
          meta={r.awayPending > 0 ? <AwayBadge count={r.awayPending} /> : undefined}
          trailing={<Balance min={r.balanceMin} />}
        >
          <Link to={`/o/credits/${r.userId}`} />
        </ListRow>
      ))}
    </List>
  );
}

const TH =
  'sticky top-0 border-border border-b bg-bg px-3 py-2 font-semibold text-text-muted text-xs';
const TD = 'border-border border-b px-3 py-3';

function CreditsTable({ rows, asOf }: { rows: CreditsRow[]; asOf: string }) {
  const { t } = useTranslation();
  const estimate = useEstimateText();
  return (
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          {t('owner:credits.tableCaption', { date: longDate(asOf) })}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${TH} left-0 z-10 text-left`}>
              {t('owner:credits.col.person')}
            </th>
            <th scope="col" className={`${TH} text-right`}>
              {t('owner:credits.col.balance')}
            </th>
            <th scope="col" className={`${TH} text-left`}>
              {t('owner:credits.col.money')}
            </th>
            <th scope="col" className={`${TH} text-left`}>
              {t('owner:credits.col.last')}
            </th>
            <th scope="col" className={`${TH} text-left`}>
              {t('owner:credits.col.away')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <th scope="row" className={`${TD} sticky left-0 bg-bg text-left font-bold text-text`}>
                <Link
                  to={`/o/credits/${r.userId}`}
                  className="inline-flex min-h-11 items-center underline decoration-border-strong underline-offset-4 hover:decoration-text"
                >
                  {r.name}
                </Link>
              </th>
              <td className={`${TD} text-right`}>
                <Balance min={r.balanceMin} />
              </td>
              <td className={`${TD} text-text-body`}>{estimate(r.estimatePaise, r.balanceMin)}</td>
              <td className={`${TD} text-text-body tabular-nums`}>{lastSettled(r, t)}</td>
              <td className={TD}>
                {r.awayPending > 0 ? (
                  <AwayBadge count={r.awayPending} />
                ) : (
                  <span className="text-text-muted">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
