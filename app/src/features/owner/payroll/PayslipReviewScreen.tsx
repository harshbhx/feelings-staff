/**
 * Payslip review (PRD 4.13.3, 4.14, 5.2, O-13, O-14): one person's month with every line and its
 * formula, the counts and the rate, gross, deductions and net. On a draft Urmi adds an incentive,
 * bonus, other earning or a deduction (damage needs the show-cause number), removes what she added,
 * and lowers this month's advance recovery (the rest carries forward). Once final: **Share** (the
 * Web Share sheet with the PDF when the phone can, else WhatsApp with the verify link), mark paid,
 * and the PDF status.
 */
import type { AdjustmentKind, OwnerPayslipView, PayslipLine } from '@fs/contracts';
import {
  Banner,
  Button,
  ChipGroup,
  Field,
  Icon,
  Input,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  Textarea,
  useToast,
} from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import {
  useAddAdjustment,
  useChangeRecovery,
  useDeleteAdjustment,
  useMarkPaid,
  usePayslipReview,
} from '../api/payroll';
import { ConfirmButton } from '../components/ConfirmButton';
import { Meta, Section } from '../components/layout';
import { QueryView, useErrorText } from '../components/states';
import { SlipCreditsNote } from '../credits/SettleCreditsCard';
import { days, longDate, money, monthLabel, shortDate } from '../lib/format';
import { canShare, shareNative } from '../lib/share';
import { useOwnerTitle } from '../shell/chrome';
import { rupeesToPaise } from '../staff/staff-form';
import { PaidSheet } from './PaidSheet';

export function PayslipReviewScreen() {
  const { runId = '', userId = '' } = useParams();
  const query = usePayslipReview(runId, userId);
  return (
    <QueryView query={query} skeleton={<SlipSkeleton />}>
      {(slip) => <Review slip={slip} runId={runId} />}
    </QueryView>
  );
}

const firstName = (name: string) => name.split(' ')[0] ?? name;

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

function Review({ slip, runId }: { slip: OwnerPayslipView; runId: string }) {
  const { t } = useTranslation();
  const month = monthLabel(slip.month);
  useOwnerTitle(
    t('owner:payroll.slip.title', { name: slip.person.name, month }),
    `/o/payroll/${runId}`,
  );
  const draft = slip.status === 'draft';
  const statusChip =
    slip.status === 'draft' ? 'waiting' : slip.status === 'final' ? 'present' : 'off';
  const creditsLine = slip.result.lines.find((l) => l.code === 'time_credits');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start xl:gap-12">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={statusChip} label={t(`owner:payroll.slip.status.${slip.status}`)} />
          {slip.revision > 1 ? (
            <Meta>{t('owner:payroll.status.revision', { n: slip.revision })}</Meta>
          ) : null}
          {slip.paid ? (
            <Meta>
              {t('owner:payroll.slip.paid', {
                date: shortDate(slip.paid.on),
                mode: t(`owner:payroll.run.modes.${slip.paid.mode}`),
              })}
            </Meta>
          ) : null}
        </div>
        <Slip slip={slip} month={month} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
        {draft ? <Adjustments slip={slip} runId={runId} /> : null}
        {draft && creditsLine ? <SlipCreditsNote runId={runId} line={creditsLine} /> : null}
        {draft && slip.advances.length > 0 ? <Recovery slip={slip} runId={runId} /> : null}
        {!draft ? <Final slip={slip} runId={runId} /> : null}
      </div>
    </div>
  );
}

function Slip({ slip, month }: { slip: OwnerPayslipView; month: string }) {
  const { t } = useTranslation();
  const r = slip.result;
  const c = r.counts;
  const earnings = r.lines.filter((l) => l.kind === 'earning');
  const deductions = r.lines.filter((l) => l.kind === 'deduction');
  const salary = r.lines.find((l) => l.code === 'salary');
  return (
    <article
      className="grid gap-5 rounded-md border border-border p-5"
      aria-label={t('owner:payroll.slip.title', { name: slip.person.name, month })}
      data-testid="payslip"
    >
      <header className="grid gap-1">
        <p className="font-bold text-text">{slip.org.name}</p>
        {slip.org.address ? <Meta>{slip.org.address}</Meta> : null}
        <p className="mt-2 font-extrabold text-text text-xl tracking-display">{slip.person.name}</p>
        <Meta>
          {[
            slip.person.designation,
            slip.person.employeeCode,
            t('owner:staff.profile.joined', { date: longDate(slip.person.joinDate) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Meta>
      </header>

      <Section title={t('owner:payroll.slip.days')}>
        <p className="text-text-body tabular-nums">
          {t('owner:payroll.slip.counts', {
            P: c.P,
            H: c.H,
            A: c.A,
            L: days(c.L),
            WO: c.WO,
            HO: c.HO,
          })}
        </p>
        <Meta>
          {t('owner:payroll.run.lineDays', { paid: days(c.paidDays), lop: days(c.lopDays) })}
          {salary
            ? ` · ${t('owner:payroll.slip.rate', {
                salary: money(salary.amountPaise),
                divisor: r.divisorDays,
                rate: money(r.dailyRatePaise),
              })}`
            : ''}
        </Meta>
      </Section>

      <Section title={t('owner:payroll.slip.earnings')}>
        <Lines lines={earnings} />
      </Section>
      <Section title={t('owner:payroll.slip.deductions')}>
        <Lines lines={deductions} />
      </Section>

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-border border-t pt-4 tabular-nums">
        <dt className="text-text-muted">{t('owner:payroll.slip.gross')}</dt>
        <dd className="text-right font-semibold text-text">{money(r.grossPaise)}</dd>
        <dt className="text-text-muted">{t('owner:payroll.slip.totalDeductions')}</dt>
        <dd className="text-right font-semibold text-text">
          {money(-Math.abs(r.deductionsPaise))}
        </dd>
        {r.roundingPaise !== 0 ? (
          <>
            <dt className="text-text-muted">{t('owner:payroll.slip.rounding')}</dt>
            <dd className="text-right font-semibold text-text">{money(r.roundingPaise)}</dd>
          </>
        ) : null}
        <dt className="mt-2 font-bold text-lg text-text">{t('owner:payroll.slip.net')}</dt>
        <dd className="mt-2 text-right font-extrabold text-text text-xl" data-testid="payslip-net">
          {money(r.netPaise)}
        </dd>
      </dl>

      {r.warnings.length > 0 ? (
        <Section title={t('owner:payroll.slip.warnings')}>
          <ul className="grid gap-2">
            {r.warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2 text-text-body">
                <Icon name="warning-circle" className="mt-1 size-5 shrink-0 text-accent" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}

/** Label, formula in muted text, amount right-aligned (PRD 12.6 MoneyLine). */
function Lines({ lines }: { lines: PayslipLine[] }) {
  return (
    <ul className="grid">
      {lines.map((l) => (
        <li
          key={`${l.code}-${l.refId ?? ''}-${l.label}`}
          className="flex items-start justify-between gap-4 border-border border-t py-2 first:border-t-0"
        >
          <span className="grid min-w-0">
            <span className="text-text">{l.label}</span>
            <span className="text-sm text-text-muted">{l.formula}</span>
          </span>
          <span className="whitespace-nowrap font-semibold text-text tabular-nums">
            {money(l.amountPaise)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const KINDS: AdjustmentKind[] = [
  'incentive',
  'bonus',
  'other_earning',
  'other_deduction',
  'damage',
];

function Adjustments({ slip, runId }: { slip: OwnerPayslipView; runId: string }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const remove = useDeleteAdjustment(runId);
  return (
    <Section title={t('owner:payroll.slip.adjustments')}>
      {slip.adjustments.length > 0 ? (
        <ul className="grid">
          {slip.adjustments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 border-border border-t py-2 first:border-t-0"
            >
              <span className="grid min-w-0">
                <span className="font-semibold text-text">
                  {t(`owner:payroll.slip.kinds.${a.kind}`)} · {money(a.amountPaise)}
                </span>
                <span className="text-sm text-text-muted">{a.note}</span>
              </span>
              <ConfirmButton
                size="sm"
                label={t('owner:payroll.slip.remove')}
                title={t('owner:payroll.slip.removeTitle', {
                  what: t(`owner:payroll.slip.kinds.${a.kind}`),
                  amount: money(a.amountPaise),
                })}
                busy={remove.isPending}
                onConfirm={(done) => remove.mutate(a.id, { onSuccess: done, onError: fb.fail })}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <AddSheet slip={slip} runId={runId} />
      </div>
    </Section>
  );
}

function AddSheet({ slip, runId }: { slip: OwnerPayslipView; runId: string }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const add = useAddAdjustment(runId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AdjustmentKind>('incentive');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showCause, setShowCause] = useState('');
  const paise = rupeesToPaise(amount);
  const first = firstName(slip.person.name);
  const ready =
    paise !== null &&
    paise > 0 &&
    note.trim().length >= 3 &&
    (kind !== 'damage' || showCause.trim());
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:payroll.slip.addTitle', { name: first })}
      trigger={
        <Button variant="secondary" icon="plus">
          {t('owner:payroll.slip.add')}
        </Button>
      }
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready || add.isPending}
            onClick={() => {
              if (paise === null) return;
              add.mutate(
                {
                  userId: slip.person.id,
                  kind,
                  amountPaise: paise,
                  note: note.trim(),
                  ...(kind === 'damage' ? { showCauseRef: showCause.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setAmount('');
                    setNote('');
                    fb.ok(t('owner:payroll.run.saved'));
                  },
                  onError: fb.fail,
                },
              );
            }}
          >
            {add.isPending ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <ChipGroup
          type="radio"
          legend={t('owner:payroll.slip.kind')}
          value={kind}
          onValueChange={(k) => setKind(k as AdjustmentKind)}
          options={KINDS.map((k) => ({ value: k, label: t(`owner:payroll.slip.kinds.${k}`) }))}
        />
        <Field label={t('owner:payroll.slip.amount')}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field
          label={t('owner:payroll.slip.note')}
          hint={t('owner:payroll.slip.noteHint', { name: first })}
        >
          <Textarea
            value={note}
            rows={2}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {kind === 'damage' ? (
          <Field
            label={t('owner:payroll.slip.showCause')}
            hint={t('owner:payroll.slip.showCauseHint')}
          >
            <Input
              value={showCause}
              maxLength={80}
              onChange={(e) => setShowCause(e.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}

function Recovery({ slip, runId }: { slip: OwnerPayslipView; runId: string }) {
  const { t } = useTranslation();
  return (
    <Section title={t('owner:payroll.slip.advance')}>
      <ul className="grid gap-5">
        {slip.advances.map((a) => (
          <RecoveryRow key={a.advanceId} slip={slip} runId={runId} advance={a} />
        ))}
      </ul>
    </Section>
  );
}

function RecoveryRow({
  slip,
  runId,
  advance,
}: {
  slip: OwnerPayslipView;
  runId: string;
  advance: OwnerPayslipView['advances'][number];
}) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const change = useChangeRecovery(runId);
  const [value, setValue] = useState(String(advance.recoverPaise / 100));
  const paise = rupeesToPaise(value);
  const valid = paise !== null && paise <= advance.duePaise;
  return (
    <li className="grid gap-2">
      <Meta>
        {t('owner:payroll.slip.advanceLine', {
          due: money(advance.duePaise),
          balance: money(advance.balancePaise),
        })}
      </Meta>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={t('owner:payroll.slip.recover')}
          hint={t('owner:payroll.slip.recoverHint')}
          className="min-w-0 flex-1 basis-40"
        >
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          disabled={!valid || change.isPending || paise === advance.recoverPaise}
          onClick={() =>
            paise !== null &&
            change.mutate(
              { userId: slip.person.id, advanceId: advance.advanceId, recoverPaise: paise },
              { onSuccess: () => fb.ok(t('owner:payroll.run.saved')), onError: fb.fail },
            )
          }
        >
          {change.isPending ? t('owner:common.saving') : t('owner:common.save')}
        </Button>
      </div>
    </li>
  );
}

function Final({ slip, runId }: { slip: OwnerPayslipView; runId: string }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const mark = useMarkPaid(runId);
  const first = firstName(slip.person.name);
  const share = async () => {
    const text = slip.verifyUrl ? `${slip.shareText} ${slip.verifyUrl}` : slip.shareText;
    if (canShare({ text })) {
      const outcome = await shareNative({ text });
      if (outcome !== 'unsupported') return;
    }
    if (slip.waLink) window.open(slip.waLink, '_blank', 'noopener');
  };
  let pdf: ReactNode = null;
  if (slip.pdfStatus === 'ready' && slip.pdfUrl)
    pdf = (
      <Button asChild size="sm" variant="ghost" icon="file-pdf">
        <a href={slip.pdfUrl} target="_blank" rel="noreferrer">
          {t('owner:payroll.slip.openPdf')}
        </a>
      </Button>
    );
  else pdf = <Meta>{t(`owner:payroll.slip.pdf.${slip.pdfStatus}`)}</Meta>;
  return (
    <Section title={t('owner:payroll.slip.share')}>
      <div className="grid gap-4">
        <Meta>{t('owner:payroll.slip.shareHint', { name: first })}</Meta>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="share-network" onClick={() => void share()}>
            {t('owner:payroll.slip.share')}
          </Button>
          {slip.paid === null && slip.id ? (
            <PaidSheet
              who={first}
              primary={false}
              busy={mark.isPending}
              trigger={
                <Button variant="secondary" icon="check-circle">
                  {t('owner:payroll.run.markPaid')}
                </Button>
              }
              onSave={(v, done) =>
                slip.id &&
                mark.mutate(
                  { ...v, payslipId: slip.id },
                  {
                    onSuccess: () => {
                      done();
                      fb.ok(t('owner:payroll.run.saved'));
                    },
                    onError: fb.fail,
                  },
                )
              }
            />
          ) : null}
        </div>
        {slip.pdfStatus === 'failed' ? (
          <Banner icon="file-pdf">{t('owner:payroll.slip.pdf.failed')}</Banner>
        ) : (
          pdf
        )}
      </div>
    </Section>
  );
}

function SlipSkeleton() {
  return (
    <SkeletonGroup className="grid max-w-(--container-narrow) gap-4">
      <Skeleton shape="pill" width="5rem" height="1.75rem" />
      <Skeleton width="40%" />
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <Skeleton key={i} width={`${85 - i * 4}%`} />
      ))}
    </SkeletonGroup>
  );
}
