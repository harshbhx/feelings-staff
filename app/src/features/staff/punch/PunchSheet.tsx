/**
 * The check-in sheet (PRD 4.3, 4.4.4, 4.5, 4.6 B, 5.1): one bottom sheet that walks through
 * confirm -> location -> (selfie) -> PIN -> result, with progress in words, every error state in
 * plain language with its options, and the bindi landing once on success.
 *
 * It renders `PunchFlow` (flow-types.ts). Local views (confirm, venue form, note form, fix-it
 * guide) are this component's own; everything else comes from the flow.
 */
import { formatDuration } from '@fs/contracts';
import {
  Bindi,
  Button,
  Field,
  hapticTick,
  Icon,
  type IconName,
  Input,
  PinPad,
  Sheet,
  StatusChip,
  Textarea,
} from '@fs/ui';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { applyUpdate, setUpdateBlocker } from '../../../pwa/register';
import { useOwnerName, useStaffMe } from '../api';
import { FixItGuide, type FixItTopic } from '../fixit/FixItGuide';
import { useFmt } from '../lib/format';
import { telLink } from '../lib/links';
import { ScanPanel } from '../scan/ScanPanel';
import type { PunchConfirm } from '../today/today-model';
import { usePunchSheetFlow } from './flow';
import type {
  PlaceFix,
  PunchAction,
  PunchFlow,
  PunchFlowActions,
  PunchFlowState,
  PunchProblem,
} from './flow-types';
import type { FrozenSheet } from './frozen';

/** Views the sheet shows on its own, on top of the flow state. */
export type LocalView =
  | { view: 'flow' }
  | { view: 'confirm'; reason: PunchConfirm }
  | { view: 'venue' }
  | { view: 'note' }
  | { view: 'fixit'; topic: FixItTopic };

export interface PunchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PunchAction;
  confirm: PunchConfirm | null;
  shiftStartTs: number | null;
  earliestTs: number | null;
  flow: PunchFlow;
  /** Visual tests: start on this local view (and never touch the camera). */
  initialView?: LocalView | undefined;
  frozen?: boolean | undefined;
  /** A punch reached the server (or the queue): refresh Today. */
  onSettled: () => void;
}

export interface PunchSheetHostProps
  extends Omit<PunchSheetProps, 'flow' | 'initialView' | 'frozen'> {
  /** Visual review (`?sheet=<state>`, localhost mock mode): show this state, run nothing. */
  frozenSheet: FrozenSheet | null;
}

/**
 * What Today lazy-loads: the sheet plus the punch flow it drives, so neither is in the staff
 * initial chunk (PRD 11.10). Stays mounted after the first open, so a running punch survives a
 * close and reopen.
 */
export function PunchSheetHost({ frozenSheet, ...props }: PunchSheetHostProps) {
  const live = usePunchSheetFlow();
  const flow = useMemo(() => (frozenSheet ? frozenFlow(frozenSheet) : live), [frozenSheet, live]);
  return (
    <PunchSheet
      {...props}
      flow={flow}
      initialView={frozenSheet?.view}
      frozen={frozenSheet !== null}
    />
  );
}

/** A flow that only shows a frozen state (visual review); every action is a no-op. */
function frozenFlow(f: FrozenSheet): PunchFlow {
  const noop = () => {};
  const actions: PunchFlowActions = {
    start: noop,
    allowLocation: noop,
    retry: noop,
    capture: noop,
    retake: noop,
    usePhoto: noop,
    sendWithoutPhoto: noop,
    submitPin: noop,
    scanDoorCode: noop,
    submitDoorCode: noop,
    sendToOwner: noop,
    atVenue: noop,
    close: noop,
  };
  return { state: f.state, actions, busy: false };
}

export function PunchSheet({
  open,
  onOpenChange,
  kind,
  confirm,
  shiftStartTs,
  earliestTs,
  flow,
  initialView,
  frozen = false,
  onSettled,
}: PunchSheetProps) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const [local, setLocal] = useState<LocalView>(initialView ?? { view: 'flow' });
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const { state, actions, busy } = flow;

  // Opening the sheet starts the punch, or asks to confirm first (PRD 4.3.2).
  const started = useRef(false);
  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (started.current || frozen) return;
    started.current = true;
    if (confirm) setLocal({ view: 'confirm', reason: confirm });
    else {
      setLocal({ view: 'flow' });
      actions.start(kind, []);
    }
  }, [open, frozen, confirm, kind, actions]);

  // Never prompt or reload for an update while the sheet is open (PRD 11.7).
  useEffect(() => {
    setUpdateBlocker('punch-sheet', open);
    return () => setUpdateBlocker('punch-sheet', false);
  }, [open]);

  const settled = state.step === 'result' || state.step === 'queued' || state.step === 'sent';
  useEffect(() => {
    if (settled && !frozen) onSettled();
  }, [settled, frozen, onSettled]);

  const close = () => {
    actions.close();
    setLocal({ view: 'flow' });
    onOpenChange(false);
  };

  const title =
    local.view === 'venue'
      ? t('staff:punch.venue.title')
      : local.view === 'note'
        ? t('staff:punch.note.title', { owner })
        : kind === 'out'
          ? t('staff:punch.titleOut')
          : t('staff:punch.titleIn');

  const args: StepArgs = { setLocal, state, flow, kind, shiftStartTs, earliestTs, frozen, close };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={title}
      dismissible={!busy}
      footer={<div ref={setFooterEl} className="w-full" />}
    >
      <FooterSlot.Provider value={footerEl}>
        <div
          className="flex flex-col gap-4"
          data-punch-step={local.view === 'flow' ? state.step : local.view}
        >
          {local.view === 'confirm' ? (
            <ConfirmView a={args} reason={local.reason} />
          ) : local.view === 'venue' ? (
            <VenueForm
              onSend={(place, note) => {
                actions.atVenue(place, note);
                setLocal({ view: 'flow' });
              }}
            />
          ) : local.view === 'note' ? (
            <NoteForm
              onSend={(note) => {
                actions.sendToOwner(note);
                setLocal({ view: 'flow' });
              }}
            />
          ) : local.view === 'fixit' ? (
            <FixItView a={args} topic={local.topic} />
          ) : (
            <FlowView a={args} />
          )}
        </div>
      </FooterSlot.Provider>
    </Sheet>
  );
}

/** The sheet's pinned footer: steps portal their buttons into it. */
const FooterSlot = createContext<HTMLElement | null>(null);

function Footer({ children }: { children: ReactNode }) {
  const el = useContext(FooterSlot);
  return el ? createPortal(<div className="flex w-full flex-col gap-2">{children}</div>, el) : null;
}

interface StepArgs {
  setLocal: (v: LocalView) => void;
  state: PunchFlowState;
  flow: PunchFlow;
  kind: PunchAction;
  shiftStartTs: number | null;
  earliestTs: number | null;
  frozen: boolean;
  close: () => void;
}

// ---- Views ------------------------------------------------------------------------------------

function ConfirmView({ a, reason }: { a: StepArgs; reason: PunchConfirm }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  const text =
    reason === 'too_early'
      ? t('staff:punch.confirm.too_early', {
          start: a.shiftStartTs ? fmt.clock(a.shiftStartTs) : '',
          from: a.earliestTs ? fmt.clock(a.earliestTs) : '',
        })
      : reason === 'week_off'
        ? t('staff:punch.confirm.week_off', { owner })
        : reason === 'holiday'
          ? t('staff:punch.confirm.holiday', { owner })
          : t('staff:punch.confirm.on_leave');
  return (
    <>
      <Lead icon={reason === 'too_early' ? 'clock' : 'calendar-blank'}>{text}</Lead>
      {reason === 'too_early' ? (
        <p className="text-sm text-text-muted">
          {t('staff:punch.confirm.too_earlyNote', { owner })}
        </p>
      ) : null}
      <Footer>
        <Button
          variant="primary"
          block
          icon="sign-in"
          onClick={() => {
            a.setLocal({ view: 'flow' });
            a.flow.actions.start(a.kind, [reason]);
          }}
        >
          {t('staff:punch.confirm.yes')}
        </Button>
        <Button block variant="ghost" onClick={a.close}>
          {t('staff:punch.confirm.no')}
        </Button>
      </Footer>
    </>
  );
}

function FlowView({ a }: { a: StepArgs }) {
  const { t } = useTranslation();
  const s = a.state;
  switch (s.step) {
    case 'idle':
      return <Words>{t('staff:punch.locating')}</Words>;
    case 'permission':
      return (
        <>
          <p className="text-lg font-bold text-text">{t('staff:punch.permission.title')}</p>
          <Lead icon="map-pin">{t('staff:punch.permission.body')}</Lead>
          <Footer>
            <Button
              variant="primary"
              block
              icon="navigation"
              onClick={a.flow.actions.allowLocation}
            >
              {t('staff:punch.permission.allow')}
            </Button>
          </Footer>
        </>
      );
    case 'locating':
      return (
        <>
          <Words icon="navigation">
            {s.accuracyM === null
              ? t('staff:punch.locating')
              : t('staff:punch.locatingAccuracy', { accuracy: Math.round(s.accuracyM) })}
          </Words>
          <p className="text-sm text-text-muted">{t('staff:punch.locatingHint')}</p>
          <Footer>
            <Button block variant="ghost" onClick={a.close}>
              {t('common:actions.cancel')}
            </Button>
          </Footer>
        </>
      );
    case 'camera':
      return <CameraStep a={a} s={s} />;
    case 'confirm':
      return <ConfirmView a={a} reason={s.reason} />;
    case 'pin':
    case 'submitting':
      return <PinStep a={a} s={s} />;
    case 'result':
      return <ResultStep a={a} s={s} />;
    case 'queued':
      return <QueuedStep a={a} kind={s.kind} />;
    case 'scanning':
      return (
        <>
          <ScanPanel
            error={s.error}
            camera={!a.frozen}
            onToken={(token) => a.flow.actions.submitDoorCode(token)}
          />
          <Footer>
            <Button block variant="ghost" onClick={a.close}>
              {t('common:actions.cancel')}
            </Button>
          </Footer>
        </>
      );
    case 'sent':
      return <SentStep a={a} effectiveTs={s.effectiveTs} />;
    case 'problem':
      return <ProblemStep a={a} p={s.problem} />;
  }
}

function PlaceLine({ place }: { place: PlaceFix }) {
  const { t } = useTranslation();
  const text =
    place.type === 'venue' && place.name
      ? t('staff:punch.gotVenue', { place: place.name })
      : place.type === 'salon'
        ? t('staff:punch.gotSalon')
        : t('staff:punch.gotLocation');
  return (
    <p className="flex items-start gap-2 font-semibold text-text">
      <Icon name="check-circle" className="mt-1 size-5 shrink-0 text-present" />
      <span>
        {text}
        {place.distanceM !== null ? (
          <span className="block text-sm font-normal text-text-muted">
            {t('staff:punch.distance', { distance: Math.round(place.distanceM) })}
          </span>
        ) : null}
      </span>
    </p>
  );
}

function CameraStep({ a, s }: { a: StepArgs; s: Extract<PunchFlowState, { step: 'camera' }> }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && s.stream && video.current.srcObject !== s.stream) {
      video.current.srcObject = s.stream;
      void video.current.play().catch(() => undefined);
    }
  }, [s.stream]);
  const reviewing = s.photoUrl !== null;
  return (
    <>
      <PlaceLine place={s.place} />
      <p className="text-lg font-bold text-text">{t('staff:punch.camera.title')}</p>
      <p className="text-sm text-text-muted">{t('staff:punch.camera.hint')}</p>
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[18rem] overflow-hidden rounded-lg bg-bg-deepest">
        {reviewing && s.photoUrl ? (
          <img src={s.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <video
            ref={video}
            className="size-full -scale-x-100 object-cover"
            playsInline
            muted
            autoPlay
            aria-label={t('staff:punch.camera.videoLabel')}
          />
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[18%] top-[16%] bottom-[24%] rounded-md border-2 border-white/80"
        />
      </div>
      {s.tooDark ? (
        <p className="font-semibold text-absent" role="alert">
          {t('staff:punch.camera.tooDark')}
        </p>
      ) : null}
      <Footer>
        {reviewing ? (
          <>
            <Button variant="primary" block icon="check-circle" onClick={a.flow.actions.usePhoto}>
              {t('staff:punch.camera.use')}
            </Button>
            <Button
              block
              variant="secondary"
              icon="arrows-clockwise"
              onClick={a.flow.actions.retake}
            >
              {t('staff:punch.camera.retake')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              block
              icon="camera"
              onClick={() => a.flow.actions.capture(video.current)}
            >
              {t('staff:punch.camera.shutter')}
            </Button>
            {s.tooDark && s.darkTries >= 2 ? (
              <Button block variant="secondary" onClick={a.flow.actions.usePhoto}>
                {t('staff:punch.camera.sendAnyway')}
              </Button>
            ) : null}
          </>
        )}
      </Footer>
    </>
  );
}

function PinStep({
  a,
  s,
}: {
  a: StepArgs;
  s: Extract<PunchFlowState, { step: 'pin' } | { step: 'submitting' }>;
}) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const [pin, setPin] = useState('');
  const submitting = s.step === 'submitting';
  const wrong = s.step === 'pin' ? s.wrong : null;
  // A new wrong-PIN answer clears the dots so the next try starts fresh.
  const wrongKey = wrong ? `w${wrong.triesLeft ?? 'x'}` : '';
  const [seenWrong, setSeenWrong] = useState('');
  if (wrongKey !== seenWrong) {
    setSeenWrong(wrongKey);
    if (wrongKey) setPin('');
  }
  const send = (value: string) => {
    if (value.length >= 4 && !submitting) a.flow.actions.submitPin(value);
  };
  const error = wrong
    ? wrong.triesLeft === null
      ? t('staff:punch.pin.wrongNoCount')
      : t('staff:punch.pin.wrong', { count: wrong.triesLeft })
    : undefined;
  const busyLabel =
    a.kind === 'out' ? t('staff:punch.submittingOut') : t('staff:punch.submittingIn');
  return (
    <>
      {s.step === 'pin' ? <PlaceLine place={s.place} /> : null}
      {s.step === 'pin' && s.forApproval ? (
        <p className="text-sm text-text-muted">{t('staff:punch.pin.forApproval', { owner })}</p>
      ) : null}
      <PinPad
        label={t('staff:punch.pin.title')}
        value={pin}
        onValueChange={setPin}
        onComplete={send}
        error={error}
        disabled={submitting}
      />
      <p className="staff-live" role="status">
        {submitting ? busyLabel : ''}
      </p>
      <Footer>
        <Button
          variant="primary"
          block
          icon={a.kind === 'out' ? 'sign-out' : 'sign-in'}
          disabled={pin.length < 4 && !submitting}
          loading={submitting}
          loadingLabel={busyLabel}
          onClick={() => send(pin)}
        >
          {a.kind === 'out' ? t('staff:punch.titleOut') : t('staff:punch.titleIn')}
        </Button>
      </Footer>
    </>
  );
}

function ResultStep({ a, s }: { a: StepArgs; s: Extract<PunchFlowState, { step: 'result' }> }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  const r = s.result;
  if (r.outcome === 'needs_proof' || r.outcome === 'pending') {
    return (
      <>
        <p className="text-lg font-bold text-text">{t('staff:punch.needsProof.title')}</p>
        <Lead icon="warning-circle">{t('staff:punch.needsProof.body', { owner })}</Lead>
        <p className="text-sm text-text-muted">
          {t('staff:punch.needsProof.time', { time: fmt.clock(r.punch.effectiveTs) })}
        </p>
        <Footer>
          <Button variant="primary" block icon="qr-code" onClick={a.flow.actions.scanDoorCode}>
            {t('staff:punch.options.scanDoor')}
          </Button>
          <Button
            block
            variant="secondary"
            icon="map-pin"
            onClick={() => a.setLocal({ view: 'venue' })}
          >
            {t('staff:punch.options.atVenue')}
          </Button>
          <Button block variant="secondary" onClick={() => a.setLocal({ view: 'note' })}>
            {t('staff:punch.options.sendToOwner', { owner })}
          </Button>
        </Footer>
      </>
    );
  }
  return (
    <>
      <Success kind={s.kind} result={r} place={s.place} frozen={a.frozen} />
      <Footer>
        <Button block variant="secondary" onClick={a.close}>
          {t('staff:punch.done')}
        </Button>
      </Footer>
    </>
  );
}

function Success({
  kind,
  result,
  place,
  frozen,
}: {
  kind: PunchAction;
  result: Extract<PunchFlowState, { step: 'result' }>['result'];
  place: PlaceFix;
  frozen: boolean;
}) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  useEffect(() => {
    if (!frozen) hapticTick();
  }, [frozen]);
  const time = fmt.clock(result.punch.effectiveTs);
  const headline =
    kind === 'out'
      ? t('staff:punch.successOut', { time, duration: formatDuration(result.day.workedMin) })
      : t('staff:punch.successIn', { time });
  const distance = result.fence.distanceM ?? place.distanceM;
  const venue = result.punch.placeName ?? (place.type === 'venue' ? place.name : null);
  const where = venue
    ? t('staff:punch.successVenue', { place: venue })
    : distance !== null
      ? t('staff:punch.successSalon', { distance: Math.round(distance) })
      : t('staff:punch.successSalonNoDistance');
  return (
    <div className="flex flex-col items-start gap-3 py-2" data-success="">
      {/* Status is colour + icon + word (PRD 12.11); the bindi lands once as the time's full stop (12.9). */}
      <StatusChip
        status="present"
        label={kind === 'out' ? t('staff:today.status.done') : t('staff:today.status.in')}
      />
      <p className="staff-bignum flex items-end gap-1.5" aria-hidden="true">
        {time}
        <Bindi size="success" land={!frozen} className="mb-[0.22em]" />
      </p>
      <p className="text-lg font-bold text-text" role="status">
        {headline}
      </p>
      <p className="text-text-muted">{where}</p>
      {kind === 'out' && result.stayedAfterMin !== null && result.stayedAfterMin >= 30 ? (
        <p className="staff-card staff-card--soft text-sm">
          {t('staff:punch.stayedAfter', { minutes: result.stayedAfterMin, owner })}
        </p>
      ) : null}
    </div>
  );
}

function QueuedStep({ a, kind }: { a: StepArgs; kind: PunchAction }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-lg font-bold text-text">{t('staff:punch.queued.title')}</p>
      <Lead icon="hourglass">
        {kind === 'out' ? t('staff:punch.queued.bodyOut') : t('staff:punch.queued.body')}
      </Lead>
      <Footer>
        <Button block variant="secondary" onClick={a.close}>
          {t('staff:punch.done')}
        </Button>
      </Footer>
    </>
  );
}

function SentStep({ a, effectiveTs }: { a: StepArgs; effectiveTs: number }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  return (
    <>
      <p className="text-lg font-bold text-text">{t('staff:punch.sent.title', { owner })}</p>
      <Lead icon="hourglass">
        {t('staff:punch.sent.body', { owner, time: fmt.clock(effectiveTs) })}
      </Lead>
      <Footer>
        <Button block variant="secondary" onClick={a.close}>
          {t('staff:punch.done')}
        </Button>
      </Footer>
    </>
  );
}

function ProblemStep({ a, p }: { a: StepArgs; p: PunchProblem }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const me = useStaffMe();
  const fmt = useFmt();
  const navigate = useNavigate();
  const act = a.flow.actions;

  const scan = (primary: boolean) => (
    <Button
      key="scan"
      block
      variant={primary ? 'primary' : 'secondary'}
      icon="qr-code"
      onClick={act.scanDoorCode}
    >
      {t('staff:punch.options.scanDoor')}
    </Button>
  );
  const send = (primary: boolean) => (
    <Button
      key="send"
      block
      variant={primary ? 'primary' : 'secondary'}
      onClick={() => a.setLocal({ view: 'note' })}
    >
      {t('staff:punch.options.sendToOwner', { owner })}
    </Button>
  );
  const fix = (topic: FixItTopic) => (
    <Button
      key="fix"
      block
      variant="secondary"
      icon="gear"
      onClick={() => a.setLocal({ view: 'fixit', topic })}
    >
      {t('staff:punch.options.howToFix')}
    </Button>
  );
  const retry = (primary: boolean) => (
    <Button
      key="retry"
      block
      variant={primary ? 'primary' : 'secondary'}
      icon="arrows-clockwise"
      onClick={act.retry}
    >
      {t('staff:punch.options.tryAgain')}
    </Button>
  );
  const call = me.org.contactPhone ? (
    <Button key="call" block variant="secondary" icon="phone" asChild>
      <a href={telLink(me.org.contactPhone)}>{t('staff:punch.options.callOwner', { owner })}</a>
    </Button>
  ) : null;
  const closeBtn = (
    <Button key="close" block variant="ghost" onClick={a.close}>
      {t('staff:punch.close')}
    </Button>
  );
  const noPhoto = (
    <Button variant="primary" key="nophoto" block onClick={act.sendWithoutPhoto}>
      {t('staff:punch.options.sendWithoutPhoto', { owner })}
    </Button>
  );

  let message: string;
  let options: ReactNode[];
  switch (p.code) {
    case 'location_denied':
      message = t('staff:punch.problem.location_denied');
      options = [scan(true), fix('location'), send(false)];
      break;
    case 'location_timeout':
      message = t('staff:punch.problem.location_timeout');
      options = [retry(true), scan(false), send(false)];
      break;
    case 'location_approximate':
      message = t('staff:punch.problem.location_approximate');
      options = [scan(true), fix('precise'), send(false)];
      break;
    case 'outside':
      message =
        p.distanceM !== null
          ? t('staff:punch.problem.outside', { distance: Math.round(p.distanceM) })
          : t('staff:punch.problem.outsideNoDistance');
      options = [
        scan(true),
        p.venueAllowed ? (
          <Button
            key="venue"
            block
            variant="secondary"
            icon="map-pin"
            onClick={() => a.setLocal({ view: 'venue' })}
          >
            {t('staff:punch.options.atVenue')}
          </Button>
        ) : null,
        send(false),
      ];
      break;
    case 'camera_denied':
      message = t('staff:punch.problem.camera_denied');
      options = [noPhoto, fix('camera')];
      break;
    case 'camera_failed':
      message = t('staff:punch.problem.camera_failed');
      options = [noPhoto];
      break;
    case 'pin_locked':
      message =
        p.untilTs !== null
          ? t('staff:punch.problem.pin_locked', { time: fmt.clock(p.untilTs) })
          : t('staff:punch.problem.pin_lockedNoTime');
      options = [send(true)];
      break;
    case 'device_pending':
      message = t('staff:punch.problem.device_pending', { owner });
      options = [call, closeBtn];
      break;
    case 'device_revoked':
      message = t('staff:punch.problem.device_revoked', { owner });
      options = [call, closeBtn];
      break;
    case 'account_inactive':
      message = t('staff:punch.problem.account_inactive', { owner });
      options = [call, closeBtn];
      break;
    case 'upgrade_required':
      message = t('staff:punch.problem.upgrade_required');
      options = [
        <Button
          variant="primary"
          key="update"
          block
          icon="arrows-clockwise"
          onClick={() => void applyUpdate()}
        >
          {t('staff:punch.options.updateNow')}
        </Button>,
      ];
      break;
    case 'session_expired':
      message = t('staff:punch.problem.session_expired');
      options = [
        <Button variant="primary" key="signin" block onClick={() => navigate('/signin?next=%2F')}>
          {t('staff:punch.options.signIn')}
        </Button>,
      ];
      break;
    case 'conflict':
      message = p.checkedIn
        ? t('staff:punch.problem.conflictIn')
        : t('staff:punch.problem.conflictOut');
      options = [closeBtn];
      break;
    case 'offline_unavailable':
      message = t('staff:punch.problem.offline_unavailable');
      options = [retry(true), closeBtn];
      break;
    default:
      message = t('staff:punch.problem.unknown');
      options = [retry(true), send(false)];
  }
  return (
    <>
      <Lead icon="warning-circle" alert>
        {message}
      </Lead>
      <Footer>{options}</Footer>
    </>
  );
}

function FixItView({ a, topic }: { a: StepArgs; topic: FixItTopic }) {
  const { t } = useTranslation();
  return (
    <>
      <FixItGuide topic={topic} />
      <Footer>
        <Button
          variant="primary"
          block
          icon="arrows-clockwise"
          onClick={() => {
            a.setLocal({ view: 'flow' });
            a.flow.actions.retry();
          }}
        >
          {t('staff:fixit.tryAgain')}
        </Button>
        <Button block variant="ghost" onClick={() => a.setLocal({ view: 'flow' })}>
          {t('common:actions.back')}
        </Button>
      </Footer>
    </>
  );
}

// ---- Forms ------------------------------------------------------------------------------------

function VenueForm({ onSend }: { onSend: (place: string, note: string) => void }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (place.trim()) onSend(place.trim(), note.trim());
      }}
    >
      <Field label={t('staff:punch.venue.place')} hint={t('staff:punch.venue.placeHint')} required>
        <Input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          maxLength={120}
          autoComplete="off"
        />
      </Field>
      <Field label={t('staff:punch.venue.note', { owner })} optional>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} />
      </Field>
      <Button variant="primary" type="submit" block icon="map-pin" disabled={!place.trim()}>
        {t('staff:punch.venue.send', { owner })}
      </Button>
    </form>
  );
}

function NoteForm({ onSend }: { onSend: (note: string) => void }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const [note, setNote] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(note.trim());
      }}
    >
      <Field
        label={t('staff:punch.note.label', { owner })}
        hint={t('staff:punch.note.hint')}
        optional
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} />
      </Field>
      <Button variant="primary" type="submit" block>
        {t('staff:punch.note.send', { owner })}
      </Button>
    </form>
  );
}

// ---- Small pieces -----------------------------------------------------------------------------

function Lead({ icon, alert, children }: { icon: IconName; alert?: boolean; children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 text-text" role={alert ? 'alert' : undefined}>
      <Icon name={icon} className="mt-1 size-5 shrink-0 text-text-muted" />
      <span>{children}</span>
    </p>
  );
}

/** Progress in words, announced politely (PRD 4.3.1 step 3, 11.11). */
function Words({ icon = 'navigation', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <p
      className="flex items-center gap-3 text-lg font-bold text-text"
      role="status"
      aria-live="polite"
    >
      <Icon name={icon} className="size-6 shrink-0 text-accent" />
      <span className="tabular">{children}</span>
    </p>
  );
}
