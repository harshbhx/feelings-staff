/**
 * One person's credits (PRD 4.19.2, O-29.7): the header with the balance, its money, the part
 * carried over from earlier months and "Nothing is cut or paid until you settle it at payroll.";
 * **Adjust minutes** (the one sindoor action) and **Export CSV** (the server asks for the PIN);
 * filters by kind, dates and only unsettled; the ledger as a real table on desktop (date order) and
 * hairline rows on phones (newest first). A row's date opens the day; the pencil opens the entry
 * with its history, where Urmi adjusts, changes or voids. Used at `/o/credits/:userId` and as the
 * Credits tab of the staff profile.
 */
import { CreditLedgerKind, type CreditLedgerRow, type CreditLedger as Ledger } from '@fs/contracts';
import { Button, Card, Field, IconButton, Input, Select, Sheet, Switch, useToast } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useCreditLedger } from '../api/credits';
import type { LedgerFilter } from '../api/keys';
import { useCreateExport } from '../api/payroll';
import { Empty, ErrorCard, RowsSkeleton, useErrorText } from '../components/states';
import { dayLabel, todayIst } from '../lib/format';
import { AdjustSheet } from './AdjustSheet';
import { canAdjust, carriedOver, orderRows, rowTotal, signedMin } from './credits-model';
import { Balance, KindBadge, useEstimateText, useMinText } from './parts';

const ALL = 'all';

export function CreditLedger({ userId, name }: { userId: string; name: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<LedgerFilter>({});
  const head = useCreditLedger(userId, {});
  const list = useCreditLedger(userId, filter);
  const [entry, setEntry] = useState<CreditLedgerRow | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const openAdjust = (row: CreditLedgerRow | null) => {
    setEntry(row);
    setAdjustOpen(true);
  };

  const first = head.data?.pages[0];
  const filtered = Boolean(filter.kind || filter.from || filter.to || filter.unsettled);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {first ? (
        <Header
          ledger={first}
          head={head.data?.pages.flatMap((p) => p.items) ?? []}
          allLoaded={!head.hasNextPage}
        >
          <Button variant="primary" icon="pencil-simple" onClick={() => openAdjust(null)}>
            {t('owner:credits.ledger.adjust')}
          </Button>
          <ExportButton userId={userId} name={name} />
        </Header>
      ) : head.isError ? (
        <ErrorCard error={head.error} onRetry={() => void head.refetch()} />
      ) : (
        <RowsSkeleton rows={2} />
      )}

      <Filters value={filter} onChange={setFilter} active={filtered} />

      {list.data ? (
        items.length === 0 ? (
          <Empty>
            {filtered ? t('owner:credits.ledger.emptyFilter') : t('owner:credits.ledger.empty')}
          </Empty>
        ) : (
          <>
            <div className="hidden xl:block">
              <LedgerTable
                rows={orderRows(items, false)}
                userId={userId}
                name={name}
                onEdit={openAdjust}
              />
            </div>
            <div className="xl:hidden">
              <LedgerList rows={orderRows(items, true)} userId={userId} onEdit={openAdjust} />
            </div>
            {list.hasNextPage ? (
              <div>
                <Button
                  variant="secondary"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage
                    ? t('owner:common.loading')
                    : t('owner:credits.ledger.more')}
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : list.isError ? (
        head.isError ? null : (
          <ErrorCard error={list.error} onRetry={() => void list.refetch()} />
        )
      ) : (
        <RowsSkeleton rows={5} />
      )}

      <AdjustSheet userId={userId} entry={entry} open={adjustOpen} onOpenChange={setAdjustOpen} />
    </div>
  );
}

function Header({
  ledger,
  head,
  allLoaded,
  children,
}: {
  ledger: Ledger;
  head: CreditLedgerRow[];
  allLoaded: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const estimate = useEstimateText();
  const minText = useMinText();
  const carried = carriedOver(head, ledger.balanceMin, todayIst(), allLoaded);
  return (
    <div className="grid max-w-(--container-narrow) gap-4">
      <Card tone="soft" data-testid="credits-balance">
        <div className="grid gap-1">
          <p className="text-sm text-text-muted">{t('owner:credits.ledger.balance')}</p>
          <p className="font-extrabold text-3xl text-text tabular-nums tracking-display">
            {minText(ledger.balanceMin)}
          </p>
          <p className="font-semibold text-text-body">
            {estimate(ledger.estimatePaise, ledger.balanceMin)}
          </p>
          {carried !== null ? (
            <p className="text-sm text-text-muted tabular-nums">
              {carried === 0
                ? t('owner:credits.ledger.carriedNone')
                : t('owner:credits.ledger.carried', { min: signedMin(carried) })}
            </p>
          ) : null}
          <p className="mt-2 text-text-body">{t('owner:credits.ledger.nothingUntil')}</p>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Filters({
  value,
  onChange,
  active,
}: {
  value: LedgerFilter;
  onChange: (f: LedgerFilter) => void;
  active: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid max-w-(--container-narrow) gap-4 xl:max-w-none">
      <div className="grid grid-cols-2 gap-3 xl:flex xl:flex-wrap xl:items-end">
        <Field label={t('owner:credits.ledger.kind')} className="col-span-2 xl:w-52">
          <Select
            value={value.kind ?? ALL}
            onValueChange={(v) =>
              onChange({ ...value, kind: v === ALL ? undefined : (v as CreditLedgerKind) })
            }
            options={[ALL, ...CreditLedgerKind.options].map((k) => ({
              value: k,
              label: t(`owner:credits.kinds.${k}`),
            }))}
          />
        </Field>
        <Field label={t('owner:credits.ledger.from')} className="min-w-0 xl:w-44">
          <Input
            type="date"
            value={value.from ?? ''}
            max={value.to ?? todayIst()}
            onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
          />
        </Field>
        <Field label={t('owner:credits.ledger.to')} className="min-w-0 xl:w-44">
          <Input
            type="date"
            value={value.to ?? ''}
            min={value.from}
            max={todayIst()}
            onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch
          label={t('owner:credits.ledger.unsettled')}
          description={t('owner:credits.ledger.unsettledHint')}
          checked={value.unsettled === true}
          onCheckedChange={(on) => onChange({ ...value, unsettled: on || undefined })}
        />
        {active ? (
          <Button variant="ghost" size="sm" icon="x" onClick={() => onChange({})}>
            {t('owner:credits.ledger.clear')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function useRowWords() {
  const { t } = useTranslation();
  return {
    source: (r: CreditLedgerRow) => t(`owner:credits.ledger.source.${r.source.kind}`),
    confirmed: (r: CreditLedgerRow) =>
      r.confirmedBy?.name ??
      (r.kind === 'late' || r.kind === 'early' ? t('owner:credits.ledger.automatic') : '–'),
    edit: (r: CreditLedgerRow) =>
      t('owner:credits.ledger.editFor', {
        kind: t(`owner:credits.kinds.${r.kind}`),
        date: dayLabel(r.date),
      }),
  };
}

function Kinds({ row }: { row: CreditLedgerRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <KindBadge kind={row.kind} />
      {row.adjustedMin !== 0 ? <KindBadge kind="adjusted" /> : null}
    </span>
  );
}

/** Adjustments and voids on an entry (the original is not a change). */
const changesOf = (r: CreditLedgerRow) => r.history.filter((h) => h.kind !== 'original').length;

const rowKey = (r: CreditLedgerRow) => `${r.date}-${r.kind}-${r.source.id}`;

function LedgerList({
  rows,
  userId,
  onEdit,
}: {
  rows: CreditLedgerRow[];
  userId: string;
  onEdit: (r: CreditLedgerRow) => void;
}) {
  const { t } = useTranslation();
  const words = useRowWords();
  const minText = useMinText();
  return (
    <ul className="grid max-w-(--container-narrow)" data-testid="credits-ledger-list">
      {rows.map((r) => (
        <li
          key={rowKey(r)}
          className="flex items-start gap-3 border-border border-t py-3 first:border-t-0"
        >
          <Link
            to={`/o/register/${userId}/${r.date}`}
            className="grid min-h-11 min-w-0 flex-1 gap-1.5 rounded-sm"
          >
            <Kinds row={r} />
            <span className="font-semibold text-text">{dayLabel(r.date)}</span>
            <span className="text-sm text-text-muted">
              {words.source(r)} · {words.confirmed(r)}
            </span>
          </Link>
          <span className="grid justify-items-end gap-0.5 pt-0.5 text-right">
            <Balance min={rowTotal(r)} />
            <span className="text-sm text-text-muted tabular-nums">
              {t('owner:credits.ledger.balanceAfter', { min: minText(r.runningBalanceMin) })}
            </span>
          </span>
          {canAdjust(r) ? (
            <IconButton icon="pencil-simple" label={words.edit(r)} onClick={() => onEdit(r)} />
          ) : (
            <span className="size-11 shrink-0" aria-hidden="true" />
          )}
        </li>
      ))}
    </ul>
  );
}

const TH =
  'sticky top-0 border-border border-b bg-bg px-3 py-2 font-semibold text-text-muted text-xs';
const TD = 'border-border border-b px-3 py-2';

function LedgerTable({
  rows,
  userId,
  name,
  onEdit,
}: {
  rows: CreditLedgerRow[];
  userId: string;
  name: string;
  onEdit: (r: CreditLedgerRow) => void;
}) {
  const { t } = useTranslation();
  const words = useRowWords();
  const cols = ['date', 'kind', 'minutes', 'balance', 'source', 'confirmed', 'edit'] as const;
  const right = new Set<string>(['minutes', 'balance']);
  return (
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table
        className="w-full border-separate border-spacing-0 text-sm"
        data-testid="credits-ledger"
      >
        <caption className="sr-only">{t('owner:credits.ledger.tableCaption', { name })}</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                className={`${TH} whitespace-nowrap ${right.has(c) ? 'text-right' : 'text-left'}`}
              >
                {c === 'edit' ? (
                  <span className="sr-only">{t('owner:credits.ledger.col.edit')}</span>
                ) : (
                  t(`owner:credits.ledger.col.${c}`)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              <th scope="row" className={`${TD} text-left font-semibold text-text`}>
                <Link
                  to={`/o/register/${userId}/${r.date}`}
                  className="inline-flex min-h-11 items-center whitespace-nowrap underline decoration-border-strong underline-offset-4 hover:decoration-text"
                >
                  {dayLabel(r.date)}
                </Link>
              </th>
              <td className={TD}>
                <Kinds row={r} />
              </td>
              <td className={`${TD} text-right`}>
                <Balance min={rowTotal(r)} />
                {r.adjustedMin !== 0 ? (
                  <span className="block text-text-muted text-xs tabular-nums">
                    {t('owner:credits.entry.recorded', { min: signedMin(r.minutes) })}
                  </span>
                ) : null}
              </td>
              <td className={`${TD} text-right font-semibold text-text-body tabular-nums`}>
                {signedMin(r.runningBalanceMin)}
              </td>
              <td className={`${TD} whitespace-nowrap text-text-body`}>{words.source(r)}</td>
              <td className={`${TD} whitespace-nowrap text-text-body`}>{words.confirmed(r)}</td>
              <td className={`${TD} text-right`}>
                {canAdjust(r) ? (
                  <Button size="sm" variant="ghost" icon="pencil-simple" onClick={() => onEdit(r)}>
                    {changesOf(r) > 0
                      ? t('owner:credits.ledger.changes', { count: changesOf(r) })
                      : t('owner:credits.ledger.col.edit')}
                    <span className="sr-only">
                      {' '}
                      {t('owner:credits.ledger.forEntry', {
                        kind: t(`owner:credits.kinds.${r.kind}`),
                        date: dayLabel(r.date),
                      })}
                    </span>
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const create = useCreateExport();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:credits.exportForm.title')}
      description={t('owner:credits.exportForm.body', { name })}
      trigger={
        <Button variant="secondary" icon="export">
          {t('owner:credits.ledger.export')}
        </Button>
      }
      footer={
        <>
          <Button
            variant="primary"
            icon="lock"
            disabled={!month || create.isPending}
            onClick={() =>
              create.mutate(
                { kind: 'credits_ledger', month, format: 'csv', userIds: [userId] },
                {
                  onSuccess: () => {
                    setOpen(false);
                    toast({ title: t('owner:credits.exportForm.queued'), tone: 'success' });
                  },
                  onError: (e) => {
                    if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
                  },
                },
              )
            }
          >
            {create.isPending ? t('owner:common.saving') : t('owner:credits.exportForm.make')}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/o/reports">{t('owner:credits.exportForm.openReports')}</Link>
          </Button>
        </>
      }
    >
      <Field label={t('owner:credits.exportForm.month')} className="max-w-60">
        <Input
          type="month"
          value={month}
          max={todayIst().slice(0, 7)}
          onChange={(e) => setMonth(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
