/**
 * The punch flow as a pure state machine (PRD 4.3.1-4.3.6, 4.4, 4.5, 4.6 B). Owner: WP-4.
 * `use-punch-flow.ts` runs the side effects; WP-7 renders the check-in sheet from `state`.
 *
 * STEPS (`state.step`)
 *   idle        Nothing running. `start(kind)` begins a tap.
 *   locating    Waiting for the location fix. `state.location` has `bestAccuracyM` and `samples`
 *               for "Finding you… 42 m accuracy". (Location keeps running in the background while
 *               the camera step shows.)
 *   camera      Selfie needed (check-in with `selfieRequired`, check-out with `selfieOnCheckOut`):
 *               live front camera in the sheet; `capture()` takes the still, `retake()` drops it.
 *   pin         "Enter your PIN" (when `pinEveryPunch`). `submitPin(pin)`.
 *   signing     Building and signing the payload (the hook submits automatically).
 *   submitting  The request is in flight ("Checking in…").
 *   result      `state.result.kind` says what happened; see RESULTS.
 *
 * ORDER after a tap: the nonce request, the location sampler and (if needed) the camera start
 * together. The visible step is the first unmet need: camera, then locating, then pin, then
 * signing. Break punches need no location, selfie or PIN. A fix older than 2 minutes is taken
 * again before any submit (so a PIN retry within 2 minutes keeps it).
 *
 * RESULTS (`state.result.kind`) and the actions each offers
 *   success          Accepted (flagged punches look the same: staff never see a flag). Show
 *                    `punch.effectiveTs` (server time, never the device clock: S-04.2).
 *   needs_proof      Stored as pending with the first submission time. scanDoorCode(token) attaches
 *                    the door code (keeps the original time, S-06.4); sendToOwner(note);
 *                    imAtVenue(placeName, note).
 *   pending          Stored, waiting for Urmi. scanDoorCode(token) while `proofUntil` is open.
 *   outside          `distanceM` (null without a fix), `siteName`. scanDoorCode, imAtVenue,
 *                    sendToOwner.
 *   approximate      Accuracy >= 1000 m (seen locally or from the server). retryLocation,
 *                    scanDoorCode, sendToOwner.
 *   location_denied  retryLocation (after the fix-it guide), scanDoorCode, sendToOwner.
 *   location_timeout `reason` timeout / unavailable / unsupported. retryLocation, scanDoorCode,
 *                    sendToOwner.
 *   camera_denied    retake() (try again after the fix-it guide), sendToOwner (no photo: pending
 *   camera_failed    with reason selfie_missing).
 *   too_dark         Mean luminance < 40. retake(); after 2 tries `canSendAnyway` and
 *                    checkInAnyway() sends the dark photo (the server may flag it).
 *   confirm          `need` week_off / holiday / on_leave. confirm(true) resends with that ack;
 *                    confirm(false) closes.
 *   too_early        `earliestTs`, `shiftStartTs`. checkInAnyway() resends with ack too_early.
 *   pin_wrong        `triesLeft`. submitPin(pin) again (a fresh nonce is used).
 *   pin_locked       `until`. sendToOwner(note) sends it without a PIN, as a request to Urmi.
 *   qr_rejected      `reason` qr_expired / qr_other_site / qr_reused / qr_invalid.
 *                    scanDoorCode again, sendToOwner.
 *   conflict         `reason` already_in / not_checked_in: refresh Today (onChanged is called).
 *   denied           `reason` from DEVICE_NOT_APPROVED (pending, revoked, rejected, unknown,
 *                    other_user, signature) or inactive.
 *   session_expired  Sign in again, then retry() resends the same punch.
 *   upgrade          Update the app, then retry().
 *   queued           Saved offline; the queue sends it by itself.
 *   failed           `reason` (see FailedReason). retry() where it makes sense.
 *
 * cancel() returns to idle from anywhere. Events that do not apply to the current state are
 * ignored (the reducer returns the same object).
 */
import type { Fix, PunchKind, PunchResult } from '@fs/contracts';
import type { LocateError } from '../geolocation';
import type { CapturedSelfie } from './camera';
import { DARK_LUMINANCE } from './camera';
import type { PunchAck } from './payload';

/** A fix older than this is taken again before submitting (PRD 4.3.5). */
export const FIX_TTL_MS = 120_000;
/** Best accuracy at or above this is "approximate" (PRD 4.3.3, 4.4.1). */
export const APPROXIMATE_ACCURACY_M = 1000;
/** Dark photos allowed before "send anyway" is offered (PRD 4.3.4). */
export const DARK_TRIES_BEFORE_SEND_ANYWAY = 2;

export type PunchStep =
  | 'idle'
  | 'locating'
  | 'camera'
  | 'pin'
  | 'signing'
  | 'submitting'
  | 'result';

export type DeniedReason =
  | 'pending'
  | 'revoked'
  | 'rejected'
  | 'unknown'
  | 'other_user'
  | 'signature'
  | 'inactive';

export type QrRejectReason = 'qr_expired' | 'qr_other_site' | 'qr_reused' | 'qr_invalid';

export type FailedReason =
  /** The device key is missing or not wired (WP-3). */
  | 'device_key'
  /** Offline, and this phone has no offline nonce, signed time or sealing key yet. */
  | 'offline_unavailable'
  /** The offline queue refused the punch (or is not wired yet: WP-7). */
  | 'queue_unavailable'
  /** A door-code or approval request could not reach the server. */
  | 'network'
  /** The nonce was rejected twice in a row. */
  | 'nonce'
  | 'rate_limited'
  /** 4xx that should not happen (selfie hash, payload too large, validation). */
  | 'server'
  | 'unexpected';

export type PunchFlowResult =
  | { kind: 'success'; punch: PunchResult }
  | { kind: 'needs_proof'; punch: PunchResult; punchId: string; proofUntil: number | null }
  | { kind: 'pending'; punch: PunchResult; punchId: string; proofUntil: number | null }
  | { kind: 'outside'; distanceM: number | null; siteName: string | null; dutyId: string | null }
  | { kind: 'approximate'; accuracyM: number | null }
  | { kind: 'location_denied' }
  | { kind: 'location_timeout'; reason: 'timeout' | 'unavailable' | 'unsupported' }
  | { kind: 'camera_denied' }
  | { kind: 'camera_failed' }
  | { kind: 'too_dark'; tries: number; canSendAnyway: boolean }
  | { kind: 'confirm'; need: 'week_off' | 'holiday' | 'on_leave' }
  | { kind: 'too_early'; earliestTs: number | null; shiftStartTs: number | null }
  | { kind: 'pin_wrong'; triesLeft: number | null }
  | { kind: 'pin_locked'; until: number | null }
  | { kind: 'qr_rejected'; reason: QrRejectReason }
  | { kind: 'conflict'; reason: 'already_in' | 'not_checked_in' | null }
  | { kind: 'denied'; reason: DeniedReason }
  | { kind: 'session_expired' }
  | { kind: 'upgrade' }
  | { kind: 'queued'; idempotencyKey: string }
  | { kind: 'failed'; reason: FailedReason; code: string | null };

export type PunchFlowResultKind = PunchFlowResult['kind'];

export interface FlowNeeds {
  location: boolean;
  selfie: boolean;
  pin: boolean;
}

export interface LocationState {
  status: 'idle' | 'running' | 'done' | 'failed' | 'skipped';
  /** Bumped each time a new sampling run is wanted (the hook starts one per attempt). */
  attempt: number;
  bestAccuracyM: number | null;
  samples: number;
  fix: Fix | null;
  fixAt: number | null;
  error: LocateError | null;
}

export interface SelfieState {
  status: 'idle' | 'opening' | 'live' | 'taken' | 'skipped';
  /** Bumped each time the camera should (re)open. */
  attempt: number;
  /** Dark captures so far. */
  tries: number;
  photo: CapturedSelfie | null;
  error: 'denied' | 'failed' | null;
}

export interface PunchIntent {
  qrToken: string | null;
  requestApproval: boolean;
  note: string | null;
  placeName: string | null;
  ack: PunchAck[];
}

export type Submission =
  | { type: 'punch' }
  | { type: 'proof'; punchId: string; qrToken: string }
  | { type: 'approval'; punchId: string; note: string; placeName: string | null };

export interface PunchFlowState {
  step: PunchStep;
  kind: PunchKind | null;
  needs: FlowNeeds;
  /** Date.now() of the tap (clientDurationMs). */
  tapAt: number | null;
  /** One per tap; every retry of the tap reuses it. */
  idempotencyKey: string | null;
  location: LocationState;
  selfie: SelfieState;
  /** A valid PIN is held in memory by the hook (never in this state). */
  pinReady: boolean;
  intent: PunchIntent;
  /** The stored pending punch a door code or a note can still be attached to. */
  pendingPunch: { id: string; proofUntil: number | null } | null;
  /** What `signing` sends. */
  submission: Submission | null;
  /** Bumped on every entry into `signing`; the hook submits once per value. */
  attempt: number;
  result: PunchFlowResult | null;
}

export type PunchEvent =
  | {
      type: 'START';
      kind: PunchKind;
      needs: FlowNeeds;
      idempotencyKey: string;
      at: number;
      qrToken?: string | null;
    }
  | { type: 'LOCATION_PROGRESS'; bestAccuracyM: number | null; samples: number }
  | { type: 'LOCATED'; fix: Fix; at: number }
  | { type: 'LOCATION_FAILED'; error: LocateError; at: number }
  | { type: 'RETRY_LOCATION'; at: number }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; error: 'denied' | 'failed'; at: number }
  | { type: 'CAPTURED'; photo: CapturedSelfie; at: number }
  | { type: 'RETAKE'; at: number }
  | { type: 'PIN_ENTERED'; at: number }
  | { type: 'PIN_NEEDED' }
  | { type: 'CONFIRM'; ack: boolean; at: number }
  | { type: 'CHECK_IN_ANYWAY'; at: number }
  | { type: 'SEND_TO_OWNER'; note: string; at: number }
  | { type: 'IM_AT_VENUE'; placeName: string; note: string; at: number }
  | { type: 'SCAN'; token: string | null; at: number }
  | { type: 'SUBMITTING' }
  | { type: 'SUBMIT_OK'; punch: PunchResult }
  | { type: 'SUBMIT_FAILED'; result: PunchFlowResult }
  | { type: 'QUEUED' }
  | { type: 'RETRY'; at: number }
  | { type: 'CANCEL' };

const NO_INTENT: PunchIntent = {
  qrToken: null,
  requestApproval: false,
  note: null,
  placeName: null,
  ack: [],
};

export const initialPunchState: PunchFlowState = {
  step: 'idle',
  kind: null,
  needs: { location: false, selfie: false, pin: false },
  tapAt: null,
  idempotencyKey: null,
  location: {
    status: 'idle',
    attempt: 0,
    bestAccuracyM: null,
    samples: 0,
    fix: null,
    fixAt: null,
    error: null,
  },
  selfie: { status: 'idle', attempt: 0, tries: 0, photo: null, error: null },
  pinReady: false,
  intent: NO_INTENT,
  pendingPunch: null,
  submission: null,
  attempt: 0,
  result: null,
};

/** Results after which the tap is over (the hook forgets the PIN). */
export const FINAL_RESULTS: ReadonlySet<PunchFlowResultKind> = new Set([
  'success',
  'needs_proof',
  'pending',
  'queued',
  'denied',
  'conflict',
]);

function resultOf(s: PunchFlowState): PunchFlowResultKind | null {
  return s.step === 'result' && s.result ? s.result.kind : null;
}

function inResult(s: PunchFlowState, ...kinds: PunchFlowResultKind[]): boolean {
  const k = resultOf(s);
  return k !== null && kinds.includes(k);
}

function relocate(s: PunchFlowState): PunchFlowState {
  return {
    ...s,
    location: {
      ...s.location,
      status: 'running',
      attempt: s.location.attempt + 1,
      bestAccuracyM: null,
      samples: 0,
      fix: null,
      fixAt: null,
      error: null,
    },
  };
}

function showResult(s: PunchFlowState, result: PunchFlowResult): PunchFlowState {
  return { ...s, step: 'result', result };
}

function locationFailure(error: LocateError | null): PunchFlowResult {
  if (error === 'denied') return { kind: 'location_denied' };
  if (error === 'unavailable' || error === 'unsupported') {
    return { kind: 'location_timeout', reason: error };
  }
  return { kind: 'location_timeout', reason: 'timeout' };
}

/** A door code or "Send to Urmi" stands in for a missing or weak location. */
function locationCovered(s: PunchFlowState): boolean {
  return s.intent.qrToken !== null || s.intent.requestApproval;
}

/**
 * Move to the first unmet need (see ORDER in the header), or to `signing` when nothing is missing.
 * Also re-takes a stale fix and turns location or camera failures into results.
 */
export function advance(state: PunchFlowState, at: number): PunchFlowState {
  let s = state;
  const loc = s.location;
  if (
    s.needs.location &&
    loc.status === 'done' &&
    loc.fixAt !== null &&
    at - loc.fixAt > FIX_TTL_MS
  ) {
    s = relocate(s);
  }
  if (s.needs.location && s.location.status === 'failed') {
    if (!locationCovered(s)) return showResult(s, locationFailure(s.location.error));
    s = { ...s, location: { ...s.location, status: 'skipped' } };
  }
  const fix = s.location.fix;
  if (
    s.needs.location &&
    s.location.status === 'done' &&
    fix &&
    fix.accuracy >= APPROXIMATE_ACCURACY_M &&
    !locationCovered(s)
  ) {
    return showResult(s, { kind: 'approximate', accuracyM: fix.accuracy });
  }
  if (s.needs.selfie && s.selfie.error && s.selfie.status !== 'skipped') {
    return showResult(s, { kind: s.selfie.error === 'denied' ? 'camera_denied' : 'camera_failed' });
  }
  if (s.needs.selfie && s.selfie.status !== 'taken' && s.selfie.status !== 'skipped') {
    return { ...s, step: 'camera', result: null };
  }
  if (s.needs.location && s.location.status === 'running') {
    return { ...s, step: 'locating', result: null };
  }
  if (s.needs.pin && !s.pinReady) return { ...s, step: 'pin', result: null };
  return {
    ...s,
    step: 'signing',
    result: null,
    submission: { type: 'punch' },
    attempt: s.attempt + 1,
  };
}

function toSigning(s: PunchFlowState, submission: Submission): PunchFlowState {
  return { ...s, step: 'signing', result: null, submission, attempt: s.attempt + 1 };
}

function withAck(s: PunchFlowState, ack: PunchAck): PunchFlowState {
  if (s.intent.ack.includes(ack)) return s;
  return { ...s, intent: { ...s.intent, ack: [...s.intent.ack, ack] } };
}

/** Outcome of a 2xx answer from punchCreate, punchProof or punchRequestApproval. */
export function resultForPunch(punch: PunchResult): PunchFlowResult {
  switch (punch.outcome) {
    case 'accepted':
    case 'flagged':
      return { kind: 'success', punch };
    case 'needs_proof':
      return { kind: 'needs_proof', punch, punchId: punch.punch.id, proofUntil: punch.proofUntil };
    default:
      return { kind: 'pending', punch, punchId: punch.punch.id, proofUntil: punch.proofUntil };
  }
}

const ATTACHABLE: PunchFlowResultKind[] = ['needs_proof', 'pending', 'qr_rejected'];

export function punchReducer(state: PunchFlowState, event: PunchEvent): PunchFlowState {
  const s = state;
  switch (event.type) {
    case 'START': {
      if (s.step !== 'idle' && s.step !== 'result') return s;
      const fresh: PunchFlowState = {
        ...initialPunchState,
        kind: event.kind,
        needs: event.needs,
        tapAt: event.at,
        idempotencyKey: event.idempotencyKey,
        location: {
          ...initialPunchState.location,
          status: event.needs.location ? 'running' : 'idle',
          attempt: s.location.attempt + 1,
        },
        selfie: {
          ...initialPunchState.selfie,
          status: event.needs.selfie ? 'opening' : 'idle',
          attempt: s.selfie.attempt + 1,
        },
        intent: { ...NO_INTENT, qrToken: event.qrToken ?? null },
        attempt: s.attempt,
      };
      return advance(fresh, event.at);
    }

    case 'LOCATION_PROGRESS':
      if (s.location.status !== 'running') return s;
      return {
        ...s,
        location: { ...s.location, bestAccuracyM: event.bestAccuracyM, samples: event.samples },
      };

    case 'LOCATED': {
      if (s.location.status !== 'running') return s;
      const next: PunchFlowState = {
        ...s,
        location: {
          ...s.location,
          status: 'done',
          fix: event.fix,
          fixAt: event.at,
          bestAccuracyM: event.fix.accuracy,
          samples: event.fix.samples,
          error: null,
        },
      };
      // A result already on screen (e.g. the camera failed) stays until the person acts on it.
      return next.step === 'result' ? next : advance(next, event.at);
    }

    case 'LOCATION_FAILED': {
      if (s.location.status !== 'running') return s;
      const next: PunchFlowState = {
        ...s,
        location: { ...s.location, status: 'failed', error: event.error },
      };
      return next.step === 'result' ? next : advance(next, event.at);
    }

    case 'RETRY_LOCATION':
      if (!inResult(s, 'location_denied', 'location_timeout', 'approximate')) return s;
      return advance({ ...relocate(s), result: null }, event.at);

    case 'CAMERA_READY':
      if (s.selfie.status !== 'opening') return s;
      return { ...s, selfie: { ...s.selfie, status: 'live' } };

    case 'CAMERA_FAILED': {
      if (s.selfie.status !== 'opening' && s.selfie.status !== 'live') return s;
      const next: PunchFlowState = {
        ...s,
        selfie: { ...s.selfie, status: 'idle', error: event.error, photo: null },
      };
      return next.step === 'result' ? next : advance(next, event.at);
    }

    case 'CAPTURED': {
      if (s.step !== 'camera' || s.selfie.status !== 'live') return s;
      if (event.photo.luminance < DARK_LUMINANCE) {
        const tries = s.selfie.tries + 1;
        return showResult(
          { ...s, selfie: { ...s.selfie, tries, photo: event.photo } },
          { kind: 'too_dark', tries, canSendAnyway: tries >= DARK_TRIES_BEFORE_SEND_ANYWAY },
        );
      }
      return advance(
        { ...s, selfie: { ...s.selfie, status: 'taken', photo: event.photo } },
        event.at,
      );
    }

    case 'RETAKE': {
      const fromResult = inResult(s, 'too_dark', 'camera_denied', 'camera_failed');
      const fromPin = s.step === 'pin' && s.selfie.status === 'taken';
      if (!s.needs.selfie || (!fromResult && !fromPin)) return s;
      // A stream that is still live is reused; otherwise the hook opens the camera again.
      const status = s.selfie.status === 'live' ? 'live' : 'opening';
      return advance(
        {
          ...s,
          result: null,
          selfie: {
            ...s.selfie,
            status,
            attempt: status === 'opening' ? s.selfie.attempt + 1 : s.selfie.attempt,
            photo: null,
            error: null,
          },
        },
        event.at,
      );
    }

    case 'PIN_ENTERED':
      if (s.step !== 'pin' && !inResult(s, 'pin_wrong')) return s;
      return advance({ ...s, pinReady: true, result: null }, event.at);

    case 'PIN_NEEDED':
      if (s.step !== 'signing' && s.step !== 'submitting') return s;
      return { ...s, pinReady: false, step: 'pin', result: null };

    case 'CONFIRM': {
      if (!inResult(s, 'confirm') || s.result?.kind !== 'confirm') return s;
      if (!event.ack) return initialWithCounters(s);
      return advance({ ...withAck(s, s.result.need), result: null }, event.at);
    }

    case 'CHECK_IN_ANYWAY': {
      if (inResult(s, 'too_early')) {
        return advance({ ...withAck(s, 'too_early'), result: null }, event.at);
      }
      if (s.result?.kind === 'too_dark' && s.step === 'result' && s.result.canSendAnyway) {
        if (!s.selfie.photo) return s;
        return advance({ ...s, result: null, selfie: { ...s.selfie, status: 'taken' } }, event.at);
      }
      return s;
    }

    case 'SEND_TO_OWNER': {
      if (s.pendingPunch && inResult(s, 'needs_proof', 'qr_rejected')) {
        return toSigning(s, {
          type: 'approval',
          punchId: s.pendingPunch.id,
          note: event.note,
          placeName: null,
        });
      }
      if (
        !inResult(
          s,
          'outside',
          'approximate',
          'location_denied',
          'location_timeout',
          'camera_denied',
          'camera_failed',
          'pin_locked',
          'qr_rejected',
        )
      ) {
        return s;
      }
      let next: PunchFlowState = {
        ...s,
        result: null,
        intent: { ...s.intent, requestApproval: true, note: event.note },
      };
      if (s.selfie.error) next = { ...next, selfie: { ...next.selfie, status: 'skipped' } };
      if (s.result?.kind === 'pin_locked') {
        // The PIN is locked: send the request to Urmi without one.
        next = { ...next, needs: { ...next.needs, pin: false } };
      }
      return advance(next, event.at);
    }

    case 'IM_AT_VENUE': {
      if (s.pendingPunch && inResult(s, 'needs_proof', 'qr_rejected')) {
        return toSigning(s, {
          type: 'approval',
          punchId: s.pendingPunch.id,
          note: event.note,
          placeName: event.placeName,
        });
      }
      if (!inResult(s, 'outside')) return s;
      return advance(
        {
          ...s,
          result: null,
          intent: { ...s.intent, placeName: event.placeName, note: event.note },
        },
        event.at,
      );
    }

    case 'SCAN': {
      if (s.step === 'result' && s.pendingPunch && inResult(s, ...ATTACHABLE)) {
        if (event.token === null)
          return showResult(s, { kind: 'qr_rejected', reason: 'qr_invalid' });
        return toSigning(s, { type: 'proof', punchId: s.pendingPunch.id, qrToken: event.token });
      }
      if (
        !inResult(s, 'outside', 'approximate', 'location_denied', 'location_timeout', 'qr_rejected')
      ) {
        return s;
      }
      if (event.token === null) return showResult(s, { kind: 'qr_rejected', reason: 'qr_invalid' });
      return advance(
        { ...s, result: null, intent: { ...s.intent, qrToken: event.token } },
        event.at,
      );
    }

    case 'SUBMITTING':
      if (s.step !== 'signing') return s;
      return { ...s, step: 'submitting' };

    case 'SUBMIT_OK': {
      if (s.step !== 'submitting') return s;
      const result = resultForPunch(event.punch);
      const pendingPunch =
        result.kind === 'needs_proof' || result.kind === 'pending'
          ? { id: result.punchId, proofUntil: result.proofUntil }
          : null;
      return { ...s, step: 'result', result, pendingPunch };
    }

    case 'SUBMIT_FAILED': {
      if (s.step !== 'submitting' && s.step !== 'signing') return s;
      const kind = event.result.kind;
      let next: PunchFlowState = { ...s, step: 'result', result: event.result };
      if (kind === 'pin_wrong' || kind === 'pin_locked') next = { ...next, pinReady: false };
      if (kind === 'qr_rejected' && s.submission?.type === 'punch') {
        next = { ...next, intent: { ...next.intent, qrToken: null } };
      }
      return next;
    }

    case 'QUEUED':
      if (s.step !== 'submitting' && s.step !== 'signing') return s;
      return showResult(s, { kind: 'queued', idempotencyKey: s.idempotencyKey ?? '' });

    case 'RETRY': {
      if (!inResult(s, 'session_expired', 'upgrade', 'failed')) return s;
      if (!s.submission || s.submission.type === 'punch')
        return advance({ ...s, result: null }, event.at);
      return toSigning(s, s.submission);
    }

    case 'CANCEL':
      return initialWithCounters(s);

    default:
      return s;
  }
}

/** Back to idle, keeping the attempt counters monotonic so the hook never re-runs an old attempt. */
function initialWithCounters(s: PunchFlowState): PunchFlowState {
  return {
    ...initialPunchState,
    location: { ...initialPunchState.location, attempt: s.location.attempt },
    selfie: { ...initialPunchState.selfie, attempt: s.selfie.attempt },
    attempt: s.attempt,
  };
}
