/**
 * A stand-in punch flow for mock mode (localhost `?mock=1`, the kit and visual tests): it walks the
 * same states as WP-4's real flow with believable timing and answers from the fixtures through the
 * mock API client, so the sheet can be built and reviewed before the punch API lands. Never used
 * against the real API.
 */
import { ApiError, isApiError, type PunchRequest, type PunchResult } from '@fs/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../../api/provider';
import type {
  PlaceFix,
  PunchAck,
  PunchAction,
  PunchFlow,
  PunchFlowActions,
  PunchFlowState,
  PunchProblem,
} from './flow-types';

const SALON: PlaceFix = { type: 'salon', name: null, distanceM: 12, accuracyM: 18 };

function stubRequest(kind: PunchAction, ack: PunchAck[], pin: string): PunchRequest {
  const now = Date.now();
  return {
    v: 1,
    kind,
    nonce: 'mock-nonce',
    deviceId: '01K8D7M7J8T2CCGWBT278DBM02',
    clientTs: now,
    idempotencyKey: `mock-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    fix: {
      lat: 22.4606479,
      lng: 70.0565093,
      accuracy: 18,
      samples: 4,
      spreadM: 6,
      accuracySpreadM: 40,
      altitudeNullAll: false,
      speedNullAll: false,
    },
    selfieSha256: null,
    qrToken: null,
    offsiteDutyId: null,
    placeName: null,
    deviceTz: 'Asia/Kolkata',
    offline: null,
    pin,
    clientDurationMs: 4200,
    requestApproval: false,
    note: null,
    ack,
    appVersion: 'mock',
    signature: 'mock',
  };
}

/** Map an API error to the problem the sheet explains (PRD 4.3.5, 4.3.2). */
export function problemFromError(e: unknown): PunchProblem | { wrongPin: number | null } {
  if (!isApiError(e)) return { code: 'unknown', requestId: null };
  const triesLeft = typeof e.details?.triesLeft === 'number' ? e.details.triesLeft : null;
  switch (e.code) {
    case 'PIN_WRONG':
      return { wrongPin: triesLeft };
    case 'PIN_LOCKED':
      return {
        code: 'pin_locked',
        untilTs: typeof e.details?.until === 'number' ? e.details.until : null,
      };
    case 'DEVICE_NOT_APPROVED':
      return e.details?.status === 'revoked'
        ? { code: 'device_revoked' }
        : { code: 'device_pending' };
    case 'ACCOUNT_INACTIVE':
      return { code: 'account_inactive' };
    case 'UPGRADE_REQUIRED':
      return { code: 'upgrade_required' };
    case 'UNAUTHENTICATED':
      return { code: 'session_expired' };
    case 'LOCATION_APPROXIMATE':
      return { code: 'location_approximate', accuracyM: null };
    case 'OUTSIDE_FENCE':
      return {
        code: 'outside',
        distanceM: typeof e.details?.distanceM === 'number' ? e.details.distanceM : null,
        venueAllowed: true,
      };
    default:
      return { code: 'unknown', requestId: e.requestId ?? null };
  }
}

export function usePunchFlowStub(): PunchFlow {
  const api = useApi();
  const [state, setState] = useState<PunchFlowState>({ step: 'idle' });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const job = useRef<{ kind: PunchAction; ack: PunchAck[] }>({ kind: 'in', ack: [] });

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clear, [clear]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const locate = useCallback(
    (kind: PunchAction) => {
      clear();
      setState({ step: 'locating', kind, accuracyM: null });
      later(500, () => setState({ step: 'locating', kind, accuracyM: 64 }));
      later(1100, () => setState({ step: 'locating', kind, accuracyM: 42 }));
      later(1700, () =>
        setState({ step: 'pin', kind, place: SALON, wrong: null, forApproval: false }),
      );
    },
    [clear, later],
  );

  const finish = useCallback((kind: PunchAction, result: PunchResult) => {
    if (result.outcome === 'pending') {
      setState({ step: 'sent', kind, effectiveTs: result.punch.effectiveTs });
      return;
    }
    const punch = kind === 'out' ? { ...result.punch, kind: 'out' as const } : result.punch;
    setState({ step: 'result', kind, result: { ...result, punch }, place: SALON });
  }, []);

  const actions = useMemo<PunchFlowActions>(
    () => ({
      start(kind, ack) {
        job.current = { kind, ack };
        locate(kind);
      },
      allowLocation() {
        locate(job.current.kind);
      },
      retry() {
        locate(job.current.kind);
      },
      capture() {},
      retake() {},
      usePhoto() {},
      sendWithoutPhoto() {
        const { kind } = job.current;
        setState({ step: 'pin', kind, place: SALON, wrong: null, forApproval: true });
      },
      submitPin(pin) {
        const { kind, ack } = job.current;
        setState({ step: 'submitting', kind });
        const req = stubRequest(kind, ack, pin);
        api
          .punchCreate({ body: req }, { idempotencyKey: req.idempotencyKey })
          .then((result) => finish(kind, result))
          .catch((e: unknown) => {
            if (isApiError(e, 'UNAVAILABLE') || (e instanceof ApiError && e.status === 0)) {
              setState({ step: 'queued', kind, clientTs: req.clientTs });
              return;
            }
            const p = problemFromError(e);
            if ('wrongPin' in p)
              setState({
                step: 'pin',
                kind,
                place: SALON,
                wrong: { triesLeft: p.wrongPin },
                forApproval: false,
              });
            else setState({ step: 'problem', kind, problem: p });
          });
      },
      scanDoorCode() {
        setState({ step: 'scanning', kind: job.current.kind, error: null });
      },
      submitDoorCode(token) {
        const { kind } = job.current;
        if (!/^[0-9A-Z]{10}$/.test(token)) {
          setState({ step: 'scanning', kind, error: 'not_ours' });
          return;
        }
        setState({ step: 'submitting', kind });
        api
          .punchProof({
            params: { id: '01K8K3XRWA6AA6YE5AQE7XZKJ7' },
            body: { qrToken: token, signature: 'mock' },
          })
          .then((result) => finish(kind, result))
          .catch(() => setState({ step: 'scanning', kind, error: 'expired' }));
      },
      sendToOwner() {
        setState({ step: 'sent', kind: job.current.kind, effectiveTs: Date.now() });
      },
      atVenue() {
        setState({ step: 'sent', kind: job.current.kind, effectiveTs: Date.now() });
      },
      close() {
        clear();
        setState({ step: 'idle' });
      },
    }),
    [api, clear, finish, locate],
  );

  const busy = state.step === 'submitting';
  return { state, actions, busy };
}

/** Outside mock mode, until WP-4's `usePunchFlow` is wired: say so instead of faking a punch. */
export function usePunchFlowNotReady(): PunchFlow {
  const [state, setState] = useState<PunchFlowState>({ step: 'idle' });
  const actions = useMemo<PunchFlowActions>(() => {
    const noop = () => {};
    return {
      start(kind) {
        setState({ step: 'problem', kind, problem: { code: 'not_ready' } });
      },
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
      close() {
        setState({ step: 'idle' });
      },
    };
  }, []);
  return { state, actions, busy: false };
}
