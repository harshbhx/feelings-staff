/**
 * Settle credits (PRD 4.19.3, 4.13.3, 7.17.5, 7.17.7, O-29.4): one row per person with a balance at
 * the month end. Each row has the balance and its money, a stepper (5 min steps, an exact number,
 * **Settle 0** and **Suggested** = the full balance) from 0 up to the balance, the money it makes and
 * the balance after. Nothing is settled unless Urmi chooses (default 0). A cut stays inside the 50%
 * cap: what does not fit stays on the balance ("20 min stay on the balance"). The payroll warnings
 * (weekly hours, minimum wage, legal overtime at 2× or its shortfall) show under the person. Editable
 * until Finalise; **Save settlements** is the one sindoor action. A final run shows what was settled.
 */
import type { CreditsRow, CreditsSettleRow, PayrollRunView } from '@fs/contracts';
import { Banner, Button, Icon, IconButton, Input, Skeleton, SkeletonGroup, useToast } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useCreditsOverview, usePayrollCredits, useSettleCredit } from '../api/credits';
import { usePayrollRun } from '../api/payroll';
import { Meta } from '../components/layout';
import { Empty, ErrorCard, useErrorText } from '../components/states';
import { money, monthLabel } from '../lib/format';
import { useOwnerTitle } from '../shell/chrome';
import {
  capKept,
  clampSettle,
  estimateFor,
  type PerMinute,
  perMinute,
  SETTLE_STEP,
  signedMin,
} from './credits-model';
import { useEstimateText, useMinText } from './parts';

export function SettleCreditsScreen() {
  const { runId = '' } = useParams();
  const run = usePayrollRun(runId);
  const credits = usePayrollCredits(runId);
  if (run.data && credits.data) return <Settle view={run.data} rows={credits.data.rows} />;
  const error = run.error ?? credits.error;
  if (error)
    return (
      <ErrorCard
        error={error}
        onRetry={() => {
          void run.refetch();
          void credits.refetch();
        }}
      />
    );
  return <SettleSkeleton />;
}

function Settle({ view, rows }: { view: PayrollRunView; rows: CreditsSettleRow[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const month = monthLabel(view.run.month);
  useOwnerTitle(t('owner:credits.settle.title'), `/o/payroll/${view.run.id}`);
  const overview = useCreditsOverview();
  const settle = useSettleCredit(view.run.id);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const editable = view.run.status === 'draft' && !view.run.preview;
  const chosen = (r: CreditsSettleRow) => drafts[r.userId] ?? r.settleMin;
  const changed = rows.filter((r) => chosen(r) !== r.settleMin);

  const save = async () => {
    setSaving(true);
    const left: Record<string, number> = {};
    let failed: unknown = null;
    for (const [i, r] of changed.entries()) {
      try {
        await settle.mutateAsync({ userId: r.userId, settleMin: chosen(r) });
      } catch (e) {
        failed = failed ?? e;
        left[r.userId] = chosen(r);
        if (isStepUpCancelled(e)) {
          // The PIN was cancelled: stop here and keep every unsaved choice for the next try.
          for (const rest of changed.slice(i + 1)) left[rest.userId] = chosen(rest);
          break;
        }
      }
    }
    setDrafts(left);
    setSaving(false);
    if (failed) {
      if (!isStepUpCancelled(failed)) toast({ title: errorText(failed), tone: 'error' });
    } else toast({ title: t('owner:credits.settle.saved'), tone: 'success' });
  };

  if (rows.length === 0)
    return <Empty>{t('owner:credits.settle.empty', { month: monthLabel(view.run.month) })}</Empty>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {editable ? (
        <Meta className="max-w-(--container-narrow)">
          {t('owner:credits.settle.lead', { month })}
        </Meta>
      ) : (
        <Banner icon="lock">{t('owner:credits.settle.finalised')}</Banner>
      )}
      <ul className="grid" data-testid="settle-credits">
        {rows.map((r) => (
          <SettleRow
            key={r.userId}
            row={r}
            value={chosen(r)}
            editable={editable && !saving}
            rate={perMinute(
              r,
              overview.data?.staff.find((s: CreditsRow) => s.userId === r.userId),
            )}
            warnings={view.lines.find((l) => l.user.id === r.userId)?.warnings ?? []}
            onChange={(v) => setDrafts((d) => ({ ...d, [r.userId]: v }))}
          />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-border border-t pt-5">
        {editable ? (
          <>
            <Button
              variant="primary"
              icon="check-circle"
              disabled={changed.length === 0 || saving}
              onClick={() => void save()}
            >
              {saving ? t('owner:common.saving') : t('owner:credits.settle.save')}
            </Button>
            {changed.length > 0 && !saving ? (
              <Button onClick={() => setDrafts({})}>{t('owner:credits.settle.undo')}</Button>
            ) : null}
          </>
        ) : null}
        <Button asChild variant={editable ? 'ghost' : 'secondary'} icon="caret-left">
          <Link to={`/o/payroll/${view.run.id}`}>{t('owner:credits.settle.back')}</Link>
        </Button>
      </div>
    </div>
  );
}

function SettleRow({
  row,
  value,
  editable,
  rate,
  warnings,
  onChange,
}: {
  row: CreditsSettleRow;
  value: number;
  editable: boolean;
  rate: PerMinute | null;
  warnings: string[];
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const minText = useMinText();
  const estimate = useEstimateText();
  const saved = value === row.settleMin;
  const kept = saved ? capKept(row) : 0;
  const after = saved ? row.balanceMin - row.appliedMin : row.balanceMin - value;
  const moneyText = saved
    ? money(row.amountPaise)
    : rate
      ? t('owner:credits.settle.about', { money: money(estimateFor(value, rate)) })
      : '–';
  const balanceMoney = rate ? estimate(estimateFor(row.balanceMin, rate), row.balanceMin) : null;

  return (
    <li
      className="grid gap-4 border-border border-t py-5 first:border-t-0 xl:grid-cols-[minmax(0,1fr)_18rem_minmax(0,15rem)] xl:items-start xl:gap-8"
      data-testid="settle-row"
    >
      <div className="grid gap-0.5">
        <p className="font-bold text-lg text-text tracking-name">{row.name}</p>
        <p className="text-text-body tabular-nums">
          {t('owner:credits.settle.balance', { min: signedMin(row.balanceMin) })}
        </p>
        {balanceMoney ? <Meta>{balanceMoney}</Meta> : null}
      </div>

      {editable ? (
        <div className="grid gap-2">
          <MinutesStepper
            name={row.name}
            label={
              row.balanceMin < 0 ? t('owner:credits.settle.toCut') : t('owner:credits.settle.toPay')
            }
            value={Math.abs(value)}
            max={Math.abs(row.balanceMin)}
            onChange={(m) => onChange(clampSettle(row.balanceMin, m))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={value === 0}
              onClick={() => onChange(0)}
            >
              {t('owner:credits.settle.zero')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={value === row.suggestedMin}
              onClick={() => onChange(clampSettle(row.balanceMin, Math.abs(row.suggestedMin)))}
            >
              {t('owner:credits.settle.suggested', { min: Math.abs(row.suggestedMin) })}
            </Button>
          </div>
        </div>
      ) : (
        <p className="font-semibold text-text tabular-nums">
          {row.appliedMin !== 0
            ? t('owner:credits.settle.settledLine', {
                min: signedMin(row.appliedMin),
                money: money(row.amountPaise),
              })
            : t('owner:credits.settle.nothing')}
        </p>
      )}

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 tabular-nums xl:grid-cols-[auto_minmax(0,1fr)] xl:gap-x-4">
        <dt className="text-sm text-text-muted">{t('owner:credits.settle.money')}</dt>
        <dd className="text-right font-bold text-text" data-testid="settle-money">
          {moneyText}
        </dd>
        <dt className="text-sm text-text-muted">{t('owner:credits.settle.after')}</dt>
        <dd className="text-right font-bold text-text">{minText(after)}</dd>
      </dl>

      {kept > 0 || !saved || warnings.length > 0 ? (
        <ul className="grid gap-1.5 xl:col-span-3">
          {kept > 0 ? (
            <Note icon="warning-circle">
              {t('owner:credits.settle.capKept', { count: kept })}{' '}
              <span className="text-text-muted">{t('owner:credits.settle.capHint')}</span>
            </Note>
          ) : null}
          {!saved ? <Note icon="pencil-simple">{t('owner:credits.settle.unsaved')}</Note> : null}
          {warnings.map((w) => (
            <Note key={w} icon="warning-circle">
              {w}
            </Note>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Note({
  icon,
  children,
}: {
  icon: 'warning-circle' | 'pencil-simple';
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-sm text-text-body">
      <Icon name={icon} className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

/** − / exact minutes / + with 44 px targets; the buttons stay focusable at the limits. */
function MinutesStepper({
  name,
  label,
  value,
  max,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  max: number;
  onChange: (magnitude: number) => void;
}) {
  const { t } = useTranslation();
  const atMin = value <= 0;
  const atMax = value >= max;
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 font-semibold text-sm text-text">{label}</legend>
      <div className="flex items-center gap-2">
        <IconButton
          icon="minus"
          variant="outline"
          label={t('owner:credits.settle.less')}
          aria-disabled={atMin || undefined}
          onClick={() => !atMin && onChange(value - SETTLE_STEP)}
        />
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          className="w-32"
          aria-label={t('owner:credits.settle.exact', { name })}
          value={String(value)}
          end={<span className="text-text-muted">{t('owner:settings.units.min')}</span>}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '') || '0'))}
        />
        <IconButton
          icon="plus"
          variant="outline"
          label={t('owner:credits.settle.more')}
          aria-disabled={atMax || undefined}
          onClick={() => !atMax && onChange(value + SETTLE_STEP)}
        />
      </div>
    </fieldset>
  );
}

function SettleSkeleton() {
  return (
    <SkeletonGroup className="grid gap-6">
      <Skeleton width="60%" />
      {Array.from({ length: 3 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="grid gap-3 border-border border-t py-5">
          <Skeleton width="35%" />
          <Skeleton width="20%" />
          <Skeleton shape="pill" width="14rem" height="2.75rem" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
