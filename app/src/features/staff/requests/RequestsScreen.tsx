/**
 * Requests (`/requests?tab=leave|fixes`, PRD 5.1, 4.9, 4.11; AC S-12, S-13): leave balances and
 * requests, fix requests, each with a status chip in words; tap a row for details and Cancel.
 */
import type { LeaveRequestView, RegularisationView, RequestStatus } from '@fs/contracts';
import {
  Button,
  ChipGroup,
  type DayStatus,
  EmptyState,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  useLeaveCancel,
  useMyLeave,
  useMyRegularisations,
  useOwnerName,
  useRegularisationCancel,
} from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { ActionBar } from '../shell/ActionBar';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';

const STATUS_CHIP: Record<RequestStatus, DayStatus> = {
  pending: 'waiting',
  approved: 'present',
  rejected: 'absent',
  cancelled: 'off',
};

export function RequestsScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'fixes' ? 'fixes' : 'leave';
  return (
    <>
      <ScreenHeader title={t('staff:screens.requests')} />
      <main id="main" className="staff-main flex flex-col gap-5">
        <ChipGroup
          legend={t('staff:requests.segments')}
          legendHidden
          value={tab}
          onValueChange={(v) => setParams(v === 'fixes' ? { tab: 'fixes' } : {}, { replace: true })}
          options={[
            { value: 'leave', label: t('staff:requests.leave'), icon: 'airplane-tilt' },
            { value: 'fixes', label: t('staff:requests.fixes'), icon: 'clock' },
          ]}
        />
        {tab === 'leave' ? <LeaveTab /> : <FixesTab />}
      </main>
      <ActionBar>
        <Button block icon="plus" asChild>
          <Link to={tab === 'leave' ? '/requests/leave' : '/requests/fix'}>
            {tab === 'leave' ? t('staff:requests.askLeave') : t('staff:requests.fixDay')}
          </Link>
        </Button>
      </ActionBar>
    </>
  );
}

function statusWord(t: ReturnType<typeof useTranslation>['t'], s: RequestStatus) {
  return s === 'pending'
    ? t('staff:requests.status.pending')
    : s === 'approved'
      ? t('staff:requests.status.approved')
      : s === 'rejected'
        ? t('staff:requests.status.rejected')
        : t('staff:requests.status.cancelled');
}

function dateRange(fmt: Fmt, t: ReturnType<typeof useTranslation>['t'], from: string, to: string) {
  return from === to
    ? fmt.date(from)
    : t('common:time.range', { from: fmt.date(from), to: fmt.date(to) });
}

function LeaveTab() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const leave = useMyLeave();
  const [open, setOpen] = useState<LeaveRequestView | null>(null);
  if (leave.isError)
    return (
      <QueryError
        error={leave.error}
        message={t('staff:requests.loadError')}
        onRetry={() => void leave.refetch()}
      />
    );
  if (!leave.data) return <ListSkeleton />;
  const { balances, requests } = leave.data;
  return (
    <>
      <section aria-labelledby="req-balances" className="flex flex-col gap-2">
        <h2 id="req-balances" className="text-base">
          {t('staff:requests.balances')}
        </h2>
        <List framed>
          {balances.map((b) => (
            <ListRow
              key={b.code}
              title={b.name}
              subtitle={
                b.nextExpiry
                  ? t('staff:requests.expires', {
                      count: b.nextExpiry.days,
                      date: fmt.date(b.nextExpiry.on),
                    })
                  : undefined
              }
              trailing={
                <span className="font-bold text-text tabular">
                  {t('staff:requests.left', { count: b.balance })}
                </span>
              }
            />
          ))}
        </List>
      </section>
      <section aria-labelledby="req-leave" className="flex flex-col gap-2">
        <h2 id="req-leave" className="text-base">
          {t('staff:requests.leave')}
        </h2>
        {requests.length ? (
          <List framed>
            {requests.map((r) => (
              <ListRow
                key={r.id}
                onClick={() => setOpen(r)}
                title={`${r.typeName} · ${dateRange(fmt, t, r.fromDate, r.toDate)}`}
                subtitle={r.reason ?? undefined}
                trailing={
                  <StatusChip status={STATUS_CHIP[r.status]} label={statusWord(t, r.status)} />
                }
              />
            ))}
          </List>
        ) : (
          <EmptyState>{t('staff:requests.empty')}</EmptyState>
        )}
      </section>
      <LeaveSheet request={open} onClose={() => setOpen(null)} />
    </>
  );
}

function LeaveSheet({
  request,
  onClose,
}: {
  request: LeaveRequestView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const cancel = useLeaveCancel();
  const toast = useToast();
  if (!request) return null;
  const today = new Date().toISOString().slice(0, 10);
  const canCancel =
    request.status === 'pending' || (request.status === 'approved' && request.fromDate > today);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${request.typeName} · ${dateRange(fmt, t, request.fromDate, request.toDate)}`}
      footer={
        canCancel ? (
          <Button
            block
            variant="danger-secondary"
            loading={cancel.isPending}
            onClick={() => {
              if (!window.confirm(t('staff:requests.cancelConfirm'))) return;
              cancel.mutate(request.id, {
                onSuccess: () => {
                  toast({ title: t('staff:requests.cancelled') });
                  onClose();
                },
                onError: () => toast({ tone: 'error', title: t('errors:generic') }),
              });
            }}
          >
            {t('staff:requests.cancel')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <StatusChip status={STATUS_CHIP[request.status]} label={statusWord(t, request.status)} />
        </div>
        {request.daysUnpaid > 0 ? (
          <p className="tabular">
            {t('staff:requests.paidSplit', { paid: request.daysPaid, unpaid: request.daysUnpaid })}
          </p>
        ) : null}
        {request.reason ? <p>{request.reason}</p> : null}
        <p className="text-sm text-text-muted">
          {t('staff:requests.asked', { date: fmt.date(request.createdAt) })}
        </p>
        {request.decidedAt ? (
          <p className="text-sm">
            {t('staff:requests.decided', {
              status: statusWord(t, request.status),
              name: request.decidedByName ?? owner,
              date: fmt.date(request.decidedAt),
            })}
          </p>
        ) : null}
        {request.decisionNote ? (
          <p className="staff-card staff-card--soft text-sm">
            {t('staff:requests.decisionNote', {
              name: request.decidedByName ?? owner,
              note: request.decisionNote,
            })}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function fixKindLabel(t: ReturnType<typeof useTranslation>['t'], k: RegularisationView['kind']) {
  return k === 'missed_in'
    ? t('staff:requests.fixKind.missed_in')
    : k === 'missed_out'
      ? t('staff:requests.fixKind.missed_out')
      : k === 'wrong_time'
        ? t('staff:requests.fixKind.wrong_time')
        : t('staff:requests.fixKind.offsite_unplanned');
}

function FixesTab() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const regs = useMyRegularisations();
  const cancel = useRegularisationCancel();
  const toast = useToast();
  const [open, setOpen] = useState<RegularisationView | null>(null);
  if (regs.isError)
    return (
      <QueryError
        error={regs.error}
        message={t('staff:requests.loadError')}
        onRetry={() => void regs.refetch()}
      />
    );
  if (!regs.data) return <ListSkeleton />;
  const proposed = (r: RegularisationView) =>
    [
      r.proposedInTs ? t('staff:requests.proposedIn', { time: fmt.clock(r.proposedInTs) }) : null,
      r.proposedOutTs
        ? t('staff:requests.proposedOut', { time: fmt.clock(r.proposedOutTs) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      {regs.data.length ? (
        <List framed>
          {regs.data.map((r) => (
            <ListRow
              key={r.id}
              onClick={() => setOpen(r)}
              title={t('staff:requests.fixLine', {
                kind: fixKindLabel(t, r.kind),
                date: fmt.date(r.workDate),
              })}
              subtitle={<span className="tabular">{proposed(r)}</span>}
              trailing={
                <StatusChip status={STATUS_CHIP[r.status]} label={statusWord(t, r.status)} />
              }
            />
          ))}
        </List>
      ) : (
        <EmptyState>{t('staff:requests.emptyFixes')}</EmptyState>
      )}
      {open ? (
        <Sheet
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={t('staff:requests.fixLine', {
            kind: fixKindLabel(t, open.kind),
            date: fmt.date(open.workDate),
          })}
          footer={
            open.status === 'pending' ? (
              <Button
                block
                variant="danger-secondary"
                loading={cancel.isPending}
                onClick={() => {
                  if (!window.confirm(t('staff:requests.cancelConfirm'))) return;
                  cancel.mutate(open.id, {
                    onSuccess: () => {
                      toast({ title: t('staff:requests.cancelled') });
                      setOpen(null);
                    },
                    onError: () => toast({ tone: 'error', title: t('errors:generic') }),
                  });
                }}
              >
                {t('staff:requests.cancel')}
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <StatusChip status={STATUS_CHIP[open.status]} label={statusWord(t, open.status)} />
            </div>
            <p className="tabular">{proposed(open)}</p>
            <p>{open.reason}</p>
            {open.decidedAt ? (
              <p className="text-sm">
                {t('staff:requests.decided', {
                  status: statusWord(t, open.status),
                  name: open.decidedByName ?? owner,
                  date: fmt.date(open.decidedAt),
                })}
              </p>
            ) : null}
            {open.decisionNote ? (
              <p className="staff-card staff-card--soft text-sm">
                {t('staff:requests.decisionNote', {
                  name: open.decidedByName ?? owner,
                  note: open.decisionNote,
                })}
              </p>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

function ListSkeleton() {
  const { t } = useTranslation();
  return (
    <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-3">
      <Skeleton shape="block" height="3.5rem" />
      <Skeleton shape="block" height="3.5rem" />
      <Skeleton shape="block" height="3.5rem" />
    </SkeletonGroup>
  );
}
