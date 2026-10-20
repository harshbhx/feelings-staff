/**
 * Today (PRD 5.1, 4.3; AC S-10): greeting with the bindi full stop, shift, status chip, live hours
 * in tabular numerals (each minute), last punch, off-site duty, waiting punches, and the one red
 * Check in / Check out button in the bottom action bar.
 */
import type { PunchView, TodayView } from '@fs/contracts';
import {
  Banner,
  Bindi,
  Button,
  type DayStatus,
  hapticTick,
  Icon,
  type IconName,
  List,
  ListRow,
  ShiftTimeline,
  Skeleton,
  SkeletonGroup,
  StatusChip,
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
import { presenceKey, usePresence } from '../presence/api';
import { presenceUi } from '../presence/presence-model';
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
const SendNoteSheet = lazy(() =>
  import('./SendNoteSheet').then((m) => ({ default: m.SendNoteSheet })),
);
// Presence (PRD 4.18): the Step out sheet and the one-time notice load only when they open.
const AwayCard = lazy(() =>
  import('../presence/AwayCardView').then((m) => ({ default: m.AwayCard })),
);
const PresenceSheets = lazy(() =>
  import('../presence/PresenceSheets').then((m) => ({ default: m.PresenceSheets })),
);

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
  const { t, i18n } = useTranslation();
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
  // Presence: Step out next to Check out, the away card with I'm back, the notice once.
  const presence = usePresence();
  const pres = presenceUi(model, presence.data, { duty: view.duty, now, ownerName: owner });
  const toast = useToast();
  const api = useApi();
  const [backBusy, setBackBusy] = useState(false);
  // I'm back: the work is in `im-back.ts`, loaded on the first tap.
  const onBack = () => {
    hapticTick();
    setBackBusy(true);
    void import('../presence/im-back')
      .then((m) => m.imBack({ api, qc, toast, i18n, owner }))
      .finally(() => setBackBusy(false));
  };
  const [stepOutOpen, setStepOutOpen] = useState(false);
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
    // A check-out closes any open away interval on the server (PRD 7.18).
    void qc.invalidateQueries({ queryKey: presenceKey });
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

      {pres.card ? (
        <Suspense fallback={null}>
          <AwayCard card={pres.card} />
        </Suspense>
      ) : null}

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

      {model.dayKind === 'work' && model.status !== 'waiting_proof' ? (
        <ShiftCard model={model} fmt={fmt} />
      ) : null}

      {model.recentPunches.length > 0 ? <RecentPunches punches={model.recentPunches} /> : null}

      {model.status === 'not_in' && model.dayKind === 'work' ? (
        // Before the first tap: what checking in does with location (PRD 4.3.3), in plain words.
        <p className="staff-card flex gap-3 text-sm text-text-muted">
          <Icon name="map-pin" className="mt-0.5 size-5 shrink-0 text-text-muted" />
          <span>{t('staff:punch.permission.body')}</span>
        </p>
      ) : null}

      {me.flags.storageTip ? (
        <Banner icon="lock" tone="plain">
          {t('staff:shell.storageTip', { owner })}
        </Banner>
      ) : null}

      <ActionBar>
        {model.primary === 'scan' ? (
          <Button
            variant="primary"
            size="lg"
            block
            icon="qr-code"
            onClick={() => {
              hapticTick();
              navigate('/scan');
            }}
          >
            {t('staff:today.scanDoor')}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              block={!pres.card}
              icon={pres.card || model.primary !== 'check_out' ? 'sign-in' : 'sign-out'}
              loading={backBusy}
              onClick={() => {
                // One 8 ms tick under the thumb (Android; never with reduced motion), PRD 12.8.
                if (pres.card) return onBack();
                hapticTick();
                setSheetOpen(true);
              }}
            >
              {pres.card
                ? t('staff:presence.back.button')
                : model.primary === 'check_out'
                  ? t('staff:today.checkOut')
                  : t('staff:today.checkIn')}
            </Button>
            {pres.card || pres.stepOut ? (
              <Button
                variant="secondary"
                size="lg"
                {...(pres.card ? { icon: 'sign-out' as const } : {})}
                onClick={() => {
                  if (pres.card) {
                    hapticTick();
                    setSheetOpen(true);
                  } else setStepOutOpen(true);
                }}
              >
                {pres.card ? t('staff:today.checkOut') : t('staff:presence.stepOut')}
              </Button>
            ) : null}
          </>
        )}
      </ActionBar>

      {pres.stepOut || pres.askConsent ? (
        <Suspense fallback={null}>
          <PresenceSheets
            stepOutOpen={stepOutOpen}
            onStepOutOpenChange={setStepOutOpen}
            notice={pres.askConsent}
            blocked={sheetOpen}
          />
        </Suspense>
      ) : null}

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
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  return (
    <div className="staff-card staff-card--soft flex flex-col gap-3">
      <p>{t('staff:today.waitingProof', { time: fmt.clock(punch.effectiveTs), owner })}</p>
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t('staff:today.sendToOwner', { owner })}
        </Button>
      </div>
      {mounted ? (
        <Suspense fallback={null}>
          <SendNoteSheet punch={punch} open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}

const KIND_ICON: Record<PunchView['kind'], IconName> = {
  in: 'sign-in',
  out: 'sign-out',
  break_start: 'coffee',
  break_end: 'coffee',
};

/** The last three punches, newest first, as hairline rows (WP-10). */
function RecentPunches({ punches }: { punches: readonly PunchView[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="today-last" className="flex flex-col gap-2">
      <h2 id="today-last" className="text-sm font-semibold text-text-muted">
        {t('staff:today.recent')}
      </h2>
      <List framed>
        {punches.map((p) => (
          <PunchRow key={p.id} punch={p} />
        ))}
      </List>
    </section>
  );
}

function PunchRow({ punch }: { punch: PunchView }) {
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
  );
}

/** The shift as one line with the worked part and a now marker (WP-10). */
function ShiftCard({ model, fmt }: { model: TodayModel; fmt: Fmt }) {
  const { t } = useTranslation();
  const now = useNow();
  const start = model.shiftStartTs;
  const end = model.shiftEndTs;
  if (start === null || end === null || end <= start) return null;
  const workedTo = model.outTs ?? now;
  const worked =
    model.inSinceTs !== null && workedTo > model.inSinceTs
      ? [{ from: model.inSinceTs, to: workedTo }]
      : [];
  const description = [
    t('staff:today.shiftDesc', {
      from: fmt.clock(start),
      to: fmt.clock(end),
      now: fmt.clock(now),
    }),
    model.inSinceTs !== null
      ? t('staff:today.shiftWorked', { from: fmt.clock(model.inSinceTs) })
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <section aria-labelledby="today-shift" className="staff-card flex flex-col gap-3">
      <h2 id="today-shift" className="text-sm font-semibold text-text-muted">
        {t('staff:today.shiftTitle')}
      </h2>
      <ShiftTimeline
        start={start}
        end={end}
        startLabel={fmt.clock(start)}
        endLabel={fmt.clock(end)}
        now={now}
        worked={worked}
        description={description}
      />
    </section>
  );
}
