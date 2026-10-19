/**
 * `usePunchFlow`: the React side of the punch flow (PRD 4.3-4.6). UI-free; WP-7's check-in sheet
 * renders `state` (see `state.ts` for every step and result) and calls the actions below.
 *
 * Side effects it runs for the reducer:
 * - on `start`: location sampling (`geolocation.sampleLocation`) runs in parallel with the camera
 *   (when a selfie is needed); the nonce is requested at submit time, right before signing.
 * - `camera`: the live front camera stream is exposed as `stream`; the sheet attaches it to a
 *   `<video>` and calls `capture(video)`. The stream is stopped as soon as the photo is taken or
 *   the flow ends.
 * - `pin`: `submitPin(pin)` keeps the PIN in a ref (never in state, never stored) until the tap is
 *   over; a wrong PIN clears it.
 * - `signing`: `runSubmission` (submit.ts) builds, signs and sends, or queues offline.
 */
import type { Me, PunchKind } from '@fs/contracts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { APP_VERSION, useApi } from '../../api/provider';
import { type LocateResult, sampleLocation } from '../geolocation';
import { appPunchQueue, deviceSigner, idbPunchStore } from './adapters';
import { browserSelfieCamera, cameraErrorKind, type SelfieCamera } from './camera';
import type { PunchQueue, PunchSigner, PunchStore } from './deps';
import {
  FINAL_RESULTS,
  type FlowNeeds,
  initialPunchState,
  type PunchFlowState,
  punchReducer,
} from './state';
import { runSubmission } from './submit';

/** What the flow needs to know about this person, from `Me.flags`. */
export type PunchFlags = Pick<
  Me['flags'],
  'selfieRequired' | 'selfieOnCheckOut' | 'pinEveryPunch' | 'breakPunches'
>;

/** Break punches need no location, selfie or PIN; check-in/out follow the person's flags. */
export function flowNeeds(kind: PunchKind, flags: PunchFlags): FlowNeeds {
  if (kind === 'break_start' || kind === 'break_end') {
    return { location: false, selfie: false, pin: false };
  }
  const selfie = kind === 'in' ? flags.selfieRequired : flags.selfieOnCheckOut;
  return { location: true, selfie, pin: flags.pinEveryPunch };
}

export interface PunchFlowOptions {
  flags: PunchFlags;
  /** Today's off-site duty id from `meToday`, if any (the server re-checks it). */
  offsiteDutyId?: string | null;
  /** Called after a result that changes Today (success, conflict, queued, pending ...). */
  onChanged?: () => void;
  /** Test seams. */
  getSigner?: () => Promise<PunchSigner>;
  queue?: PunchQueue;
  store?: PunchStore;
  camera?: SelfieCamera;
  locate?: typeof sampleLocation;
  now?: () => number;
  randomId?: () => string;
  isOnline?: () => boolean;
}

export interface PunchFlow {
  state: PunchFlowState;
  /** Live front-camera stream while the camera step shows, else null. */
  stream: MediaStream | null;
  start: (kind: PunchKind, opts?: { qrToken?: string }) => void;
  retryLocation: () => void;
  capture: (video: HTMLVideoElement) => Promise<void>;
  retake: () => void;
  submitPin: (pin: string) => void;
  confirm: (ack: boolean) => void;
  checkInAnyway: () => void;
  sendToOwner: (note: string) => void;
  imAtVenue: (placeName: string, note: string) => void;
  /** `token` is the decoded door code, or null when the scanned QR was not one of ours. */
  scanDoorCode: (token: string | null) => void;
  /** Resend after `session_expired` or `upgrade`, or after a `failed` result. */
  retry: () => void;
  cancel: () => void;
}

export function usePunchFlow(options: PunchFlowOptions): PunchFlow {
  const api = useApi();
  const [state, dispatch] = useReducer(punchReducer, initialPunchState);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const pinRef = useRef<string | null>(null);
  const handled = useRef({ location: 0, camera: 0, attempt: 0 });
  const abort = useRef<AbortController | null>(null);

  const now = useCallback(() => (opts.current.now ?? Date.now)(), []);
  const camera = options.camera ?? browserSelfieCamera;

  // Location: one run per `location.attempt` while the reducer says `running`.
  const locAttempt = state.location.attempt;
  const locRunning = state.location.status === 'running';
  useEffect(() => {
    if (!locRunning || handled.current.location === locAttempt) return;
    handled.current.location = locAttempt;
    const ctl = new AbortController();
    abort.current?.abort();
    abort.current = ctl;
    const locate = opts.current.locate ?? sampleLocation;
    void locate({
      signal: ctl.signal,
      onProgress: (p) =>
        dispatch({ type: 'LOCATION_PROGRESS', bestAccuracyM: p.bestAccuracyM, samples: p.samples }),
    }).then((r: LocateResult) => {
      if (ctl.signal.aborted && !r.ok && r.error === 'aborted') return;
      if (r.ok) dispatch({ type: 'LOCATED', fix: r.fix, at: now() });
      else dispatch({ type: 'LOCATION_FAILED', error: r.error, at: now() });
    });
  }, [locRunning, locAttempt, now]);

  // Camera: open once per `selfie.attempt` while `opening`.
  const camAttempt = state.selfie.attempt;
  const camOpening = state.selfie.status === 'opening';
  useEffect(() => {
    if (!camOpening || handled.current.camera === camAttempt) return;
    handled.current.camera = camAttempt;
    let cancelled = false;
    camera
      .open()
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        setStream(s);
        dispatch({ type: 'CAMERA_READY' });
      })
      .catch((e: unknown) => {
        if (!cancelled) dispatch({ type: 'CAMERA_FAILED', error: cameraErrorKind(e), at: now() });
      });
    return () => {
      cancelled = true;
    };
  }, [camOpening, camAttempt, camera, now]);

  // Stop the camera as soon as it is not needed.
  const needCamera = state.step === 'camera' || state.selfie.status === 'live';
  useEffect(() => {
    if (needCamera) return;
    setStream((s) => {
      for (const t of s?.getTracks() ?? []) t.stop();
      return null;
    });
  }, [needCamera]);

  // Submit once per `signing` attempt.
  useEffect(() => {
    const s = state;
    if (s.step !== 'signing' || handled.current.attempt === s.attempt) return;
    handled.current.attempt = s.attempt;
    dispatch({ type: 'SUBMITTING' });
    const o = opts.current;
    void runSubmission(
      {
        api,
        getSigner: o.getSigner ?? deviceSigner,
        queue: o.queue ?? appPunchQueue,
        store: o.store ?? idbPunchStore,
        appVersion: APP_VERSION,
        isOnline:
          o.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine)),
        now: o.now ?? Date.now,
        perfNow: () => performance.now(),
      },
      { state: s, pin: pinRef.current, offsiteDutyId: o.offsiteDutyId ?? null },
    ).then((event) => dispatch(event));
  }, [state, api]);

  // Forget the PIN when the tap is over; tell the screen to refresh.
  const resultKind = state.step === 'result' ? (state.result?.kind ?? null) : null;
  useEffect(() => {
    if (resultKind === null) return;
    if (
      FINAL_RESULTS.has(resultKind) ||
      resultKind === 'pin_wrong' ||
      resultKind === 'pin_locked'
    ) {
      pinRef.current = null;
    }
    if (FINAL_RESULTS.has(resultKind)) opts.current.onChanged?.();
  }, [resultKind]);
  useEffect(() => {
    if (state.step === 'idle') pinRef.current = null;
  }, [state.step]);

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const start = useCallback((kind: PunchKind, startOpts?: { qrToken?: string }) => {
    const o = opts.current;
    pinRef.current = null;
    dispatch({
      type: 'START',
      kind,
      needs: flowNeeds(kind, o.flags),
      idempotencyKey: (o.randomId ?? (() => crypto.randomUUID()))(),
      at: (o.now ?? Date.now)(),
      qrToken: startOpts?.qrToken ?? null,
    });
  }, []);

  return useMemo<PunchFlow>(
    () => ({
      state,
      stream,
      start,
      retryLocation: () => dispatch({ type: 'RETRY_LOCATION', at: now() }),
      capture: async (video) => {
        try {
          const photo = await camera.capture(video);
          dispatch({ type: 'CAPTURED', photo, at: now() });
        } catch (e) {
          dispatch({ type: 'CAMERA_FAILED', error: cameraErrorKind(e), at: now() });
        }
      },
      retake: () => dispatch({ type: 'RETAKE', at: now() }),
      submitPin: (pin) => {
        pinRef.current = pin;
        dispatch({ type: 'PIN_ENTERED', at: now() });
      },
      confirm: (ack) => dispatch({ type: 'CONFIRM', ack, at: now() }),
      checkInAnyway: () => dispatch({ type: 'CHECK_IN_ANYWAY', at: now() }),
      sendToOwner: (note) => dispatch({ type: 'SEND_TO_OWNER', note, at: now() }),
      imAtVenue: (placeName, note) => dispatch({ type: 'IM_AT_VENUE', placeName, note, at: now() }),
      scanDoorCode: (token) => dispatch({ type: 'SCAN', token, at: now() }),
      retry: () => dispatch({ type: 'RETRY', at: now() }),
      cancel: () => dispatch({ type: 'CANCEL' }),
    }),
    [state, stream, start, camera, now],
  );
}
