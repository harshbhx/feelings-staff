/**
 * Today (PRD 5.1, 4.3; AC S-10): greeting with the bindi full stop, shift, status chip, live hours
 * in tabular numerals (each minute), last punch, off-site duty, waiting punches, and the one red
 * Check in / Check out button in the bottom action bar.
 */
import type { PunchView, TodayView } from '@fs/contracts';
import { isApiError } from '@fs/contracts';
import {
  Banner,
  Bindi,
  Button,
  type DayStatus,
  Field,
  Icon,
  type IconName,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  Textarea,
  useToast,
} from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { mockChoice, useApi } from '../../../api/provider';
import { useQueue } from '../../../pwa/queue';
import { staffKeys, useOwnerName, useStaffMe, useToday } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { useNow } from '../lib/use-now';
import type { FrozenSheet } from '../punch/frozen';
import { ActionBar } from '../shell/ActionBar';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import {
  buildTodayModel,
  firstName,
  greetingPart,
  type QueuedPunchBrief,
  type TodayModel,
} from './today-model';

/** Today's first paint never waits for the sheet; its chunk is fetched shortly after. */
const PRELOAD_SHEET_MS = 1500;
const loadPunchSheet = () => import('../punch/PunchSheet');
const PunchSheetHost = lazy(() => loadPunchSheet().then((m) => ({ default: m.PunchSheetHost })));

export function TodayScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const today = useToday();
  const now = useNow();
  const queue = useQueue();

  const queued = useMemo<QueuedPunchBrief[]>(
    () =>
      queue.items.map((i) => ({
        kind: i.request.kind,
        clientTs: i.request.clientTs,
        failed: i.status === 'failed',
      })),
    [queue.items],
  );

  return (
    <>
      <ScreenHeader as="quiet" title={fmt.weekday(now)} dataAt={today.dataUpdatedAt || undefined} />
      <main id="main" className="staff-main">
        {today.data ? (
          <TodayBody view={today.data} model={buildTodayModel(today.data, queued, now)} now={now} />
        ) : today.isError ? (
          <QueryError
            error={today.error}
            message={t('staff:today.loadError')}
            onRetry={() => void today.refetch()}
          />
        ) : (
          <TodaySkeleton />
        )}
      </main>
    </>
  );
}

function TodaySkeleton() {
  const { t } = useTranslation();
  return (
    <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-5">
      <Skeleton width="75%" height="2rem" />
      <Skeleton width="55%" />
      <Skeleton shape="block" height="9rem" />
      <Skeleton shape="block" height="4rem" />
    </SkeletonGroup>
  );
}

function TodayBody({ view, model, now }: { view: TodayView; model: TodayModel; now: number }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const me = useStaffMe();
  const owner = useOwnerName();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [frozen, setFrozen] = useState<FrozenSheet | null>(null);
  // The sheet (and the punch flow inside it) is its own chunk: mount it on the first open only.
  const [sheetMounted, setSheetMounted] = useState(false);
  if (sheetOpen && !sheetMounted) setSheetMounted(true);
  useEffect(() => {
    const id = setTimeout(() => void loadPunchSheet(), PRELOAD_SHEET_MS);
    return () => clearTimeout(id);
  }, []);

  // Manifest shortcut "Check in" (`/?action=punch`) opens the sheet once (PRD 11.1).
  useEffect(() => {
    if (params.get('action') === 'punch') {
      params.delete('action');
      setParams(params, { replace: true });
      if (model.primary !== 'scan') setSheetOpen(true);
    }
  }, [params, setParams, model.primary]);

  // Visual review: `?sheet=<state>` on localhost mock mode opens the sheet frozen in that state.
  useEffect(() => {
    const name = params.get('sheet');
    if (!name || !mockChoice()) return;
    let alive = true;
    void import('../punch/frozen').then((m) => {
      const f = m.frozenSheet(name);
      if (alive && f) {
        setFrozen(f);
        setSheetOpen(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [params]);

  const onSettled = useCallback(() => {
    void qc.invalidateQueries({ queryKey: staffKeys.today });
  }, [qc]);

  const kind = frozen?.kind ?? (model.primary === 'check_out' ? 'out' : 'in');
  const chip = statusChip(model, t);
  const name = firstName(me.user.name);
  const part = greetingPart(now);
  const greeting =
    part === 'morning'
      ? t('staff:today.greeting.morning', { name })
      : part === 'afternoon'
        ? t('staff:today.greeting.afternoon', { name })
        : t('staff:today.greeting.evening', { name });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl">
          {greeting}
          <Bindi />
        </h1>
        <ShiftLine view={view} />
      </div>

      <section aria-labelledby="today-status" className="flex flex-col gap-3">
        <h2 id="today-status" className="sr-only">
          {t('staff:today.hoursLabel')}
        </h2>
        <div>
          <StatusChip status={chip.status} label={chip.label} />
        </div>
        <StatusBlock view={view} model={model} fmt={fmt} />
      </section>

      {model.pendingPunch && model.status === 'waiting_proof' ? (
        <WaitingProof punch={model.pendingPunch} />
      ) : null}

      {view.duty ? (
        <div className="staff-card flex gap-3">
          <Icon name="map-pin" className="mt-1 size-5 shrink-0 text-leave" />
          <div className="flex flex-col gap-1">
            <p className="font-bold text-text">{t('staff:today.dutyTitle')}</p>
            <p className="tabular">
              {t('staff:today.dutyLine', {
                times: t('common:time.range', {
                  from: fmt.clock(view.duty.startTs),
                  to: fmt.clock(view.duty.endTs),
                }),
                place: view.duty.placeName,
              })}
            </p>
            {view.duty.otPreapproved ? (
              <p className="text-sm text-text-muted">{t('staff:today.dutyOvertime')}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {model.lastPunch ? <LastPunch punch={model.lastPunch} /> : null}

      {me.flags.storageTip ? (
        <Banner icon="lock" tone="plain">
          {t('staff:shell.storageTip', { owner })}
        </Banner>
      ) : null}

      <ActionBar>
        {model.primary === 'scan' ? (
          <Button block icon="qr-code" onClick={() => navigate('/scan')}>
            {t('staff:today.scanDoor')}
          </Button>
        ) : (
          <Button
            block
            icon={model.primary === 'check_out' ? 'sign-out' : 'sign-in'}
            onClick={() => setSheetOpen(true)}
          >
            {model.primary === 'check_out' ? t('staff:today.checkOut') : t('staff:today.checkIn')}
          </Button>
        )}
      </ActionBar>

      {sheetMounted ? (
        <Suspense fallback={null}>
          <PunchSheetHost
            key={frozen ? `frozen-${params.get('sheet')}` : 'live'}
            open={sheetOpen}
            onOpenChange={(open) => {
              setSheetOpen(open);
              if (!open && frozen) setFrozen(null);
            }}
            kind={kind}
            confirm={kind === 'in' ? model.confirm : null}
            shiftStartTs={model.shiftStartTs}
            earliestTs={model.earliestCheckInTs}
            frozenSheet={frozen}
            onSettled={onSettled}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function ShiftLine({ view }: { view: TodayView }) {
  const { t } = useTranslation();
  const segs = view.schedule.segments;
  if (!segs.length) return null;
  const times = segs.map((s) => t('common:time.range', { from: s.start, to: s.end })).join(', ');
  const text = view.schedule.templateName
    ? t('staff:today.shift', { name: view.schedule.templateName, times })
    : t('staff:today.shiftNoName', { times });
  return <p className="tabular text-text-muted">{text}</p>;
}

type TFn = ReturnType<typeof useTranslation>['t'];

function statusChip(model: TodayModel, t: TFn): { status: DayStatus; label: string } {
  if (model.status === 'not_in' || model.status === 'done') {
    if (model.dayKind === 'week_off')
      return { status: 'off', label: t('staff:today.status.week_off') };
    if (model.dayKind === 'holiday')
      return { status: 'holiday', label: t('staff:today.status.holiday') };
    if (model.dayKind === 'on_leave')
      return { status: 'leave', label: t('staff:today.status.on_leave') };
  }
  switch (model.status) {
    case 'in':
      return { status: 'present', label: t('staff:today.status.in') };
    case 'on_break':
      return { status: 'off', label: t('staff:today.status.on_break') };
    case 'done':
      return { status: 'off', label: t('staff:today.status.done') };
    case 'waiting_proof':
    case 'waiting_owner':
      return { status: 'waiting', label: t('staff:today.status.waiting_proof') };
    case 'queued_in':
      return { status: 'waiting', label: t('staff:today.status.queued_in') };
    case 'queued_out':
      return { status: 'waiting', label: t('staff:today.status.queued_out') };
    default:
      return { status: 'off', label: t('staff:today.status.not_in') };
  }
}

function StatusBlock({ view, model, fmt }: { view: TodayView; model: TodayModel; fmt: Fmt }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const now = useNow();
  const showHours =
    model.workedMin !== null &&
    (model.status === 'in' ||
      model.status === 'on_break' ||
      model.status === 'done' ||
      model.status === 'queued_in' ||
      model.status === 'queued_out');

  let line: string | null = null;
  switch (model.status) {
    case 'in':
      line = model.inSinceTs
        ? t('staff:today.inSince', {
            time: fmt.clock(model.inSinceTs),
            duration: fmt.duration(model.workedMin ?? 0),
          })
        : null;
      break;
    case 'queued_in':
      line = model.inSinceTs
        ? t('staff:today.inSinceQueued', { time: fmt.clock(model.inSinceTs) })
        : null;
      break;
    case 'queued_out':
      line = model.outTs ? t('staff:today.outQueued', { time: fmt.clock(model.outTs) }) : null;
      break;
    case 'on_break': {
      const start = [...view.punches].reverse().find((p) => p.kind === 'break_start');
      line = start ? t('staff:today.onBreak', { time: fmt.clock(start.effectiveTs) }) : null;
      break;
    }
    case 'done':
      line = model.outTs
        ? t('staff:today.done', {
            time: fmt.clock(model.outTs),
            duration: fmt.duration(model.workedMin ?? 0),
          })
        : null;
      break;
    case 'waiting_owner':
      line = model.inSinceTs
        ? t('staff:today.waitingOwner', { time: fmt.clock(model.inSinceTs), owner })
        : null;
      break;
    default:
      line = null;
  }

  if (model.status === 'not_in' || model.status === 'done' || model.status === 'waiting_proof') {
    const dayLine =
      model.dayKind === 'week_off'
        ? t('staff:today.weekOff')
        : model.dayKind === 'holiday'
          ? view.schedule.holidayName
            ? t('staff:today.holiday', { name: view.schedule.holidayName })
            : t('staff:today.holidayNoName')
          : model.dayKind === 'on_leave'
            ? t('staff:today.onLeave')
            : model.dayKind === 'not_scheduled'
              ? t('staff:today.notScheduled')
              : null;
    if (dayLine && model.status === 'not_in') {
      return (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold text-text">{dayLine}</p>
          {model.dayKind === 'on_leave' && view.schedule.leave ? (
            <p className="text-text-muted">
              {t('staff:today.onLeaveType', { type: view.schedule.leave.name })}
            </p>
          ) : null}
        </div>
      );
    }
  }

  if (model.status === 'not_in') {
    const started = model.shiftStartTs !== null && now >= model.shiftStartTs;
    return (
      <div className="flex flex-col gap-1">
        <p className="staff-bignum">
          <time dateTime={new Date(now).toISOString()}>{fmt.clock(now)}</time>
        </p>
        {model.shiftStartTs !== null ? (
          <p>
            {started
              ? t('staff:today.startedAt', { time: fmt.clock(model.shiftStartTs) })
              : t('staff:today.startsAt', { time: fmt.clock(model.shiftStartTs) })}
            {!started && model.earliestCheckInTs !== null && now < model.earliestCheckInTs
              ? ` ${t('staff:today.canCheckInFrom', { time: fmt.clock(model.earliestCheckInTs) })}`
              : ''}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {showHours ? (
        <>
          <p className="text-sm font-semibold text-text-muted">{t('staff:today.hoursLabel')}</p>
          <p className="staff-bignum">{fmt.duration(model.workedMin ?? 0)}</p>
        </>
      ) : null}
      {line ? <p>{line}</p> : null}
      {model.status === 'in' && model.shiftEndTs !== null ? (
        <p className="text-sm text-text-muted">
          {t('staff:today.endsAt', { time: fmt.clock(model.shiftEndTs) })}
        </p>
      ) : null}
    </div>
  );
}

function WaitingProof({ punch }: { punch: PunchView }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="staff-card staff-card--soft flex flex-col gap-3">
      <p>{t('staff:today.waitingProof', { time: fmt.clock(punch.effectiveTs), owner })}</p>
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('staff:today.sendToOwner', { owner })}
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title={t('staff:punch.note.title', { owner })}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.punchRequestApproval({
                params: { id: punch.id },
                body: { note: note.trim(), placeName: null },
              });
              setOpen(false);
              toast({
                title: t('staff:punch.sent.body', { owner, time: fmt.clock(punch.effectiveTs) }),
              });
              void qc.invalidateQueries({ queryKey: staffKeys.today });
            } catch (err) {
              toast({
                tone: 'error',
                title: isApiError(err, 'UNAVAILABLE') ? t('errors:network') : t('errors:generic'),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label={t('staff:punch.note.label', { owner })}
            hint={t('staff:punch.note.hint')}
            optional
          >
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </Field>
          <Button type="submit" block loading={busy}>
            {t('staff:punch.note.send', { owner })}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

const KIND_ICON: Record<PunchView['kind'], IconName> = {
  in: 'sign-in',
  out: 'sign-out',
  break_start: 'coffee',
  break_end: 'coffee',
};

function LastPunch({ punch }: { punch: PunchView }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  const time = fmt.clock(punch.effectiveTs);
  const title =
    punch.kind === 'in'
      ? t('staff:today.punchIn', { time })
      : punch.kind === 'out'
        ? t('staff:today.punchOut', { time })
        : punch.kind === 'break_start'
          ? t('staff:today.punchBreakStart', { time })
          : t('staff:today.punchBreakEnd', { time });
  const place = punch.placeName ?? (punch.offsiteDutyId ? punch.siteName : null);
  const where = place ? t('staff:today.atPlace', { place }) : t('staff:today.atSalon');
  const tag =
    punch.status === 'pending'
      ? t('staff:tags.pending')
      : punch.source === 'offline'
        ? t('staff:tags.offline')
        : punch.edited
          ? t('staff:tags.edited', { owner })
          : null;
  return (
    <section aria-labelledby="today-last" className="flex flex-col gap-2">
      <h2 id="today-last" className="text-sm font-semibold text-text-muted">
        {t('staff:today.lastPunch')}
      </h2>
      <List framed>
        <ListRow
          leading={<Icon name={KIND_ICON[punch.kind]} />}
          title={<span className="tabular">{title}</span>}
          subtitle={where}
          trailing={
            tag ? (
              <StatusChip status={punch.status === 'pending' ? 'waiting' : 'off'} label={tag} />
            ) : undefined
          }
        />
      </List>
    </section>
  );
}
