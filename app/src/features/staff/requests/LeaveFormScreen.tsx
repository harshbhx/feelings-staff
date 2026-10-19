/**
 * Ask for leave (`/requests/leave`, PRD 4.9, 5.1; AC S-12): type chips with balances, dates, a
 * live preview from the server (counted days, paid/unpaid split, notice, balance, blackout and
 * overlap warnings) before Send, a reason (needed for unpaid leave) and the unpaid-split
 * confirmation. One idempotency key per opening: a second tap or a retry is the same request.
 */
import type { LeaveRequestCreate } from '@fs/contracts';
import {
  Button,
  Checkbox,
  ChipGroup,
  Field,
  Icon,
  Input,
  SkeletonList,
  Textarea,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useLeaveCreate, useLeavePreview, useMyLeave, useOwnerName } from '../api';
import { useFmt } from '../lib/format';
import { ActionBar } from '../shell/ActionBar';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import {
  type LeaveDraft,
  type LeaveIssue,
  leaveBody,
  leaveIssues,
  leaveRangeReady,
} from './form-models';
import { submitError } from './submit-error';

export function LeaveFormScreen() {
  const { t } = useTranslation();
  const leave = useMyLeave();
  return (
    <>
      <ScreenHeader title={t('staff:screens.leaveForm')} back="/requests" />
      <main id="main" className="staff-main flex flex-col gap-5">
        {leave.data ? (
          <LeaveForm balances={leave.data.balances} />
        ) : leave.isError ? (
          <QueryError
            error={leave.error}
            message={t('staff:requests.loadError')}
            onRetry={() => void leave.refetch()}
          />
        ) : (
          <SkeletonList rows={3} label={t('common:states.loading')} />
        )}
      </main>
    </>
  );
}

function LeaveForm({
  balances,
}: {
  balances: { code: LeaveRequestCreate['typeCode']; name: string; balance: number }[];
}) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useLeaveCreate();
  const [key] = useState(() => crypto.randomUUID());
  const paid = balances.filter((b) => b.code !== 'LOP');
  const [draft, setDraft] = useState<LeaveDraft>({
    typeCode: paid.find((b) => b.balance > 0)?.code ?? 'LOP',
    fromDate: params.get('from') ?? '',
    toDate: params.get('from') ?? '',
    reason: '',
    acceptSplit: false,
  });
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<LeaveDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailure(null);
  };

  const ready = leaveRangeReady(draft);
  const preview = useLeavePreview(ready ? leaveBody(draft) : null);
  const shown = ready ? preview.data : undefined;
  const issues = leaveIssues(draft, shown);
  const blocked = shown?.warnings.some((w) => w.blocking) ?? false;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const issueText: Record<LeaveIssue, string> = {
    pickDates: t('staff:leave.pickDates'),
    toBeforeFrom: t('staff:leave.toBeforeFrom'),
    reasonRequired: t('staff:leave.reasonRequired'),
    splitUnconfirmed: t('staff:leave.splitNeeded'),
  };
  const err = (i: LeaveIssue) => (tried && issues.includes(i) ? issueText[i] : undefined);

  const options = [
    ...paid.map((b) => ({
      value: b.code,
      label: t('staff:leave.typeBalance', { name: b.name, count: b.balance }),
    })),
    { value: 'LOP', label: t('staff:leave.unpaid') },
  ];

  const send = () => {
    setTried(true);
    if (issues.length || blocked || create.isPending) return;
    create.mutate(
      { body: leaveBody(draft, shown), idempotencyKey: key },
      {
        onSuccess: () => {
          toast({ title: t('staff:leave.sent', { owner }) });
          navigate('/requests', { replace: true });
        },
        onError: (e) => setFailure(submitError(t, e, owner)),
      },
    );
  };

  return (
    <>
      <form
        id="leave-form"
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <ChipGroup
          legend={t('staff:leave.type')}
          value={draft.typeCode}
          onValueChange={(v) => set({ typeCode: v as LeaveDraft['typeCode'], acceptSplit: false })}
          options={options}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('staff:leave.from')} error={err('pickDates')}>
            <Input
              type="date"
              value={draft.fromDate}
              onChange={(e) =>
                set({
                  fromDate: e.target.value,
                  toDate: draft.toDate < e.target.value ? e.target.value : draft.toDate,
                })
              }
            />
          </Field>
          <Field label={t('staff:leave.to')} error={err('toBeforeFrom')}>
            <Input
              type="date"
              value={draft.toDate}
              min={draft.fromDate || undefined}
              onChange={(e) => set({ toDate: e.target.value })}
            />
          </Field>
        </div>

        <div
          aria-live="polite"
          aria-busy={ready && preview.isFetching}
          className="flex flex-col gap-2"
        >
          {ready && preview.isFetching && !shown ? (
            <p className="text-sm text-text-muted">{t('staff:leave.checking')}</p>
          ) : null}
          {ready && preview.isError ? (
            <p className="text-sm text-text-muted">{t('staff:leave.previewFailed')}</p>
          ) : null}
          {shown ? (
            <>
              <p className="font-semibold text-text tabular" data-testid="leave-counted">
                {t('staff:leave.counted', { count: shown.countedDays })}
              </p>
              {shown.excluded.map((x) => (
                <p key={x.date} className="text-sm text-text-muted">
                  {t('staff:leave.excluded', {
                    date: fmt.date(x.date),
                    why: t(`staff:leave.excludedWhy.${x.reason}`),
                  })}
                </p>
              ))}
              {shown.daysUnpaid > 0 ? (
                <p className="text-sm tabular">
                  {t('staff:requests.paidSplit', {
                    paid: shown.daysPaid,
                    unpaid: shown.daysUnpaid,
                  })}
                </p>
              ) : null}
              {shown.warnings.map((w) => (
                <p
                  key={`${w.code}-${w.message}`}
                  className="staff-card staff-card--soft flex gap-2 text-sm"
                  data-blocking={w.blocking ? '' : undefined}
                >
                  <Icon name="warning-circle" className="mt-0.5 shrink-0" />
                  <span className={w.blocking ? 'font-semibold' : undefined}>{w.message}</span>
                </p>
              ))}
            </>
          ) : null}
        </div>

        {shown && shown.daysUnpaid > 0 && draft.typeCode !== 'LOP' ? (
          <Checkbox
            checked={draft.acceptSplit}
            onCheckedChange={(c) => set({ acceptSplit: c })}
            label={t('staff:leave.splitConfirm', { count: shown.daysUnpaid })}
            description={err('splitUnconfirmed')}
          />
        ) : null}

        <Field
          label={t('staff:leave.reason')}
          hint={t('staff:leave.reasonHint')}
          error={err('reasonRequired')}
          optional={draft.typeCode !== 'LOP'}
          required={draft.typeCode === 'LOP'}
        >
          <Textarea
            value={draft.reason}
            onChange={(e) => set({ reason: e.target.value })}
            maxLength={300}
            rows={3}
          />
        </Field>

        {offline ? (
          <p className="text-sm text-text-muted" role="status">
            {t('common:states.needsInternet')}
          </p>
        ) : null}
        {failure ? (
          <p className="staff-card text-sm" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
      <ActionBar>
        <Button
          type="submit"
          form="leave-form"
          variant="primary"
          block
          loading={create.isPending}
          loadingLabel={t('staff:leave.sending')}
          disabled={offline || blocked}
        >
          {t('staff:leave.send')}
        </Button>
      </ActionBar>
    </>
  );
}
