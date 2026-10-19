/**
 * Payroll run (PRD 4.13.2-4.13.6, 5.2, O-13): blockers card with what happens if Urmi goes on
 * anyway, the summary band in maroon (the one deep element on any owner screen), a real table on
 * desktop and hairline rows on phones, warnings in words, and the run's one sindoor action:
 * **Finalise October** (step-up; "Finalise anyway" lists the defaults) on a draft, **Mark all paid**
 * once finalised. Recompute and Reopen (reason, how to settle) sit beside it as outlines.
 * `/o/payroll/so-far` shows "Payroll so far" for the running month, read-only.
 */
import type { PayrollPersonLine, PayrollRunView } from '@fs/contracts';
import {
  Banner,
  Button,
  ChipGroup,
  Field,
  Icon,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  Textarea,
  useToast,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import {
  useFinalise,
  useMarkAllPaid,
  usePayrollPreview,
  usePayrollRun,
  useRecompute,
  useReopen,
} from '../api/payroll';
import { Meta, Section, Tag } from '../components/layout';
import { QueryView, useErrorText } from '../components/states';
import { days, money, monthLabel, shortDate, todayIst } from '../lib/format';
import { useOwnerTitle } from '../shell/chrome';
import { PaidSheet } from './PaidSheet';
import { blockerCount, runActions, runWord } from './run-model';

export function PayrollRunScreen() {
  const { runId = '' } = useParams();
  return runId === 'so-far' ? <SoFar /> : <Run id={runId} />;
}

function Run({ id }: { id: string }) {
  const query = usePayrollRun(id);
  return (
    <QueryView query={query} skeleton={<RunSkeleton />}>
      {(view) => <RunBody view={view} />}
    </QueryView>
  );
}

function SoFar() {
  const query = usePayrollPreview(todayIst().slice(0, 7));
  return (
    <QueryView query={query} skeleton={<RunSkeleton />}>
      {(view) => <RunBody view={view} />}
    </QueryView>
  );
}

function RunBody({ view }: { view: PayrollRunView }) {
  const { t } = useTranslation();
  const { run } = view;
  const month = monthLabel(run.month);
  useOwnerTitle(t('owner:payroll.run.title', { month }), '/o/payroll');
  const actions = runActions(view);
  const w = runWord(run);
  const open = blockerCount(view);
  const lineWarnings = view.lines.flatMap((l) =>
    l.warnings.map((text) => ({ who: l.user.name, text })),
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={w.chip} label={t(`owner:payroll.status.${w.word}`)} />
        {run.revision > 1 ? (
          <Tag>{t('owner:payroll.status.revision', { n: run.revision })}</Tag>
        ) : null}
        {run.reopenedReason ? <Meta>{run.reopenedReason}</Meta> : null}
      </div>

      {run.preview ? <Banner icon="hourglass">{t('owner:payroll.run.preview')}</Banner> : null}

      {open > 0 && actions.finalise ? <Blockers view={view} count={open} /> : null}

      <SummaryBand view={view} month={month} />

      {view.warnings.length + lineWarnings.length > 0 ? (
        <Section title={t('owner:payroll.run.warningsTitle')}>
          <ul className="grid gap-2">
            {view.warnings.map((text) => (
              <Warning key={text}>{text}</Warning>
            ))}
            {lineWarnings.map((x) => (
              <Warning key={`${x.who}-${x.text}`}>{x.text}</Warning>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.finalise ? <FinaliseButton view={view} month={month} blockers={open} /> : null}
        {actions.markAllPaid ? <MarkAllPaid runId={run.id} /> : null}
        {actions.recompute ? <RecomputeButton runId={run.id} /> : null}
        {actions.reopen ? (
          <ReopenButton runId={run.id} month={month} next={run.revision + 1} />
        ) : null}
      </div>

      <div className="hidden xl:block">
        <PeopleTable view={view} month={month} />
      </div>
      <div className="xl:hidden">
        <PeopleList view={view} />
      </div>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-text-body">
      <Icon name="warning-circle" className="mt-1 size-5 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

function Blockers({ view, count }: { view: PayrollRunView; count: number }) {
  const { t } = useTranslation();
  return (
    <section
      className="grid gap-3 rounded-md border border-border bg-bg-soft p-4"
      aria-labelledby="payroll-blockers"
      data-testid="payroll-blockers"
    >
      <h2 id="payroll-blockers" className="font-bold text-lg text-text">
        {t('owner:payroll.run.blockersTitle', { count })}
      </h2>
      <ul className="grid gap-3">
        {view.blockers.map((b) => (
          <li key={b.kind} className="grid gap-0.5">
            <p className="font-semibold text-text">
              {t(`owner:payroll.run.blockerKind.${b.kind}`)}
              <span className="ml-2 text-sm text-text-muted tabular-nums">{b.count}</span>
            </p>
            <p className="text-sm text-text-muted">
              {t('owner:payroll.run.ifAnyway', { what: b.defaultAction })}
            </p>
          </li>
        ))}
      </ul>
      <div>
        <Button asChild size="sm" variant="secondary" iconEnd="arrow-right">
          <Link to="/o/actions">{t('owner:payroll.run.openActions')}</Link>
        </Button>
      </div>
    </section>
  );
}

/** The maroon band: the one deep element on the screen (PRD 12.2). */
function SummaryBand({ view, month }: { view: PayrollRunView; month: string }) {
  const { t } = useTranslation();
  const items: [string, string][] = [
    [t('owner:payroll.run.gross'), money(view.totals.grossPaise)],
    [t('owner:payroll.run.deductions'), money(view.totals.deductionsPaise)],
    [t('owner:payroll.run.net'), money(view.totals.netPaise)],
    [t('owner:payroll.run.people'), String(view.totals.people)],
  ];
  return (
    <section
      aria-label={t('owner:payroll.run.summaryLabel', { month })}
      className="rounded-md bg-maroon-800 px-5 py-4 text-text-on-deep"
      data-testid="payroll-summary"
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-sm opacity-90">{label}</dt>
            <dd className="font-extrabold text-xl tabular-nums tracking-display">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function paidCell(l: PayrollPersonLine, t: TFunction) {
  if (l.paid) return t('owner:payroll.run.paidOn', { date: shortDate(l.paid.on) });
  return l.payslipId ? t('owner:payroll.run.notPaid') : '–';
}

function PeopleTable({ view, month }: { view: PayrollRunView; month: string }) {
  const { t } = useTranslation();
  const cols = ['paidDays', 'lop', 'late', 'ot', 'gross', 'deductions', 'net'] as const;
  return (
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{t('owner:payroll.run.tableCaption', { month })}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-10 border-border border-b bg-bg px-3 py-2 text-left font-semibold text-text-muted text-xs"
            >
              {t('owner:payroll.run.col.person')}
            </th>
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                className="sticky top-0 border-border border-b bg-bg px-3 py-2 text-right font-semibold text-text-muted text-xs"
              >
                {t(`owner:payroll.run.col.${c}`)}
              </th>
            ))}
            <th
              scope="col"
              className="sticky top-0 border-border border-b bg-bg px-3 py-2 text-left font-semibold text-text-muted text-xs"
            >
              {t('owner:payroll.run.col.paid')}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.user.id}>
              <th
                scope="row"
                className="sticky left-0 border-border border-b bg-bg px-3 py-2 text-left font-bold text-text"
              >
                <Link
                  to={`/o/payroll/${view.run.id}/${l.user.id}`}
                  className="underline decoration-border-strong underline-offset-4 hover:decoration-text"
                >
                  {l.user.name}
                </Link>
                {l.warnings.length > 0 ? (
                  <Icon
                    name="warning-circle"
                    label={l.warnings.join(' ')}
                    className="ml-1.5 inline size-4 align-[-0.15em] text-accent"
                  />
                ) : null}
              </th>
              <Num>{days(l.paidDays)}</Num>
              <Num>{days(l.lopDays)}</Num>
              <Num>{l.lateMin}</Num>
              <Num>{(l.otApprovedMin / 60).toFixed(1)}</Num>
              <Num>{money(l.grossPaise)}</Num>
              <Num>{money(l.deductionsPaise)}</Num>
              <Num strong>{money(l.netPaise)}</Num>
              <td className="border-border border-b px-3 py-2 text-text-muted">{paidCell(l, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Num({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <td
      className={`whitespace-nowrap border-border border-b px-3 py-2 text-right tabular-nums ${strong ? 'font-bold text-text' : 'font-semibold text-text-body'}`}
    >
      {children}
    </td>
  );
}

function PeopleList({ view }: { view: PayrollRunView }) {
  const { t } = useTranslation();
  return (
    <List>
      {view.lines.map((l) => (
        <ListRow
          key={l.user.id}
          asChild
          title={l.user.name}
          subtitle={
            <span className="tabular-nums">
              {t('owner:payroll.run.lineDays', { paid: days(l.paidDays), lop: days(l.lopDays) })}
              {l.paid ? ` · ${paidCell(l, t)}` : ''}
            </span>
          }
          trailing={
            <span className="flex items-center gap-1.5">
              {l.warnings.length > 0 ? (
                <Icon
                  name="warning-circle"
                  label={l.warnings.join(' ')}
                  className="size-4 text-accent"
                />
              ) : null}
              <span className="font-bold text-text tabular-nums">{money(l.netPaise)}</span>
            </span>
          }
        >
          <Link to={`/o/payroll/${view.run.id}/${l.user.id}`} />
        </ListRow>
      ))}
    </List>
  );
}

function useFeedback() {
  const toast = useToast();
  const errorText = useErrorText();
  return {
    ok: (title: string) => toast({ title }),
    fail: (e: unknown) => {
      if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
    },
  };
}

function FinaliseButton({
  view,
  month,
  blockers,
}: {
  view: PayrollRunView;
  month: string;
  blockers: number;
}) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const finalise = useFinalise(view.run.id);
  const [open, setOpen] = useState(false);
  const go = (acceptDefaults: boolean) =>
    finalise.mutate(acceptDefaults, {
      onSuccess: () => {
        setOpen(false);
        fb.ok(t('owner:payroll.run.finalised', { month }));
      },
      onError: fb.fail,
    });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:payroll.run.finaliseTitle', { month })}
      description={t('owner:payroll.run.finaliseBody')}
      trigger={
        <Button variant="primary" icon="lock">
          {t('owner:payroll.run.finalise', { month })}
        </Button>
      }
      footer={
        <>
          <Button
            variant="primary"
            icon="lock"
            disabled={finalise.isPending}
            onClick={() => go(blockers > 0)}
          >
            {finalise.isPending
              ? t('owner:payroll.run.finalising')
              : blockers > 0
                ? t('owner:payroll.run.finaliseAnyway')
                : t('owner:payroll.run.finalise', { month })}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      {blockers > 0 ? (
        <div className="grid gap-2">
          <p className="font-semibold text-text">{t('owner:payroll.run.finaliseDefaults')}</p>
          <ul className="grid list-disc gap-1 pl-5 text-text-body">
            {view.blockers.map((b) => (
              <li key={b.kind}>
                {t(`owner:payroll.run.blockerKind.${b.kind}`)}: {b.defaultAction}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

function RecomputeButton({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const recompute = useRecompute(runId);
  return (
    <Button
      variant="secondary"
      icon="arrows-clockwise"
      disabled={recompute.isPending}
      onClick={() =>
        recompute.mutate(undefined, {
          onSuccess: () => fb.ok(t('owner:payroll.run.recomputed')),
          onError: fb.fail,
        })
      }
    >
      {recompute.isPending ? t('owner:payroll.run.recomputing') : t('owner:payroll.run.recompute')}
    </Button>
  );
}

function MarkAllPaid({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const mark = useMarkAllPaid(runId);
  return (
    <PaidSheet
      who={t('owner:payroll.run.everyone')}
      primary
      busy={mark.isPending}
      trigger={
        <Button variant="primary" icon="check-circle">
          {t('owner:payroll.run.markAllPaid')}
        </Button>
      }
      onSave={(v, done) =>
        mark.mutate(v, {
          onSuccess: () => {
            done();
            fb.ok(t('owner:payroll.run.saved'));
          },
          onError: fb.fail,
        })
      }
    />
  );
}

function ReopenButton({ runId, month, next }: { runId: string; month: string; next: number }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const reopen = useReopen(runId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [settle, setSettle] = useState<'next_month' | 'reissue'>('next_month');
  const ready = reason.trim().length >= 3;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:payroll.run.reopenTitle', { month })}
      description={t('owner:payroll.run.reopenBody', { n: next })}
      trigger={<Button variant="secondary">{t('owner:payroll.run.reopen')}</Button>}
      footer={
        <>
          <Button
            variant="danger-secondary"
            disabled={!ready || reopen.isPending}
            onClick={() =>
              reopen.mutate(
                { reason: reason.trim(), settleMode: settle },
                {
                  onSuccess: () => {
                    setOpen(false);
                    fb.ok(t('owner:payroll.run.reopened', { n: next }));
                  },
                  onError: fb.fail,
                },
              )
            }
          >
            {reopen.isPending ? t('owner:common.saving') : t('owner:payroll.run.reopen')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('owner:payroll.run.reopenReason')} hint={t('owner:common.reasonHint')}>
          <Textarea
            value={reason}
            rows={3}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ChipGroup
          type="radio"
          legend={t('owner:payroll.run.settle')}
          layout="grid"
          value={settle}
          onValueChange={(v) => setSettle(v as 'next_month' | 'reissue')}
          options={(['next_month', 'reissue'] as const).map((m) => ({
            value: m,
            label: t(`owner:payroll.run.settleModes.${m}`),
          }))}
        />
      </div>
    </Sheet>
  );
}

function RunSkeleton() {
  return (
    <SkeletonGroup className="grid gap-6">
      <Skeleton shape="pill" width="6rem" height="1.75rem" />
      <Skeleton shape="block" height="6rem" />
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <Skeleton key={i} width={`${70 - i * 5}%`} />
      ))}
    </SkeletonGroup>
  );
}
