/**
 * The live punch flow for the check-in sheet: WP-4's `usePunchFlow` (`app/src/lib/punch/`) seen
 * through the sheet's view model (`flow-types.ts`). On top of WP-4's machine it adds what the sheet
 * owns:
 * - the pre-permission explainer before the first location request (PRD 4.3.3);
 * - confirmations the person already gave in the sheet (week off, holiday, leave day, before the
 *   earliest time) are sent when the server asks for them, so nobody confirms twice (PRD 4.3.2);
 * - the in-sheet door-code scanner (PRD 4.5).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DeniedReason,
  type PunchFlowState as LiveState,
  type PunchFlowResult,
  usePunchFlow,
} from '../../../lib/punch';
import { staffKeys, useStaffMe, useToday } from '../api';
import { QR_SCAN_ERROR } from '../scan/ScanPanel';
import type {
  PlaceFix,
  PunchAck,
  PunchAction,
  PunchFlow,
  PunchFlowActions,
  PunchFlowState,
  PunchProblem,
} from './flow-types';

const ASKED_KEY = 'fs.locationAsked';

function rememberAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // private mode: the explainer may show once more next time
  }
}

/** Explain first while the permission is still `prompt` (or unknown, older iOS) and we never asked. */
async function wantsExplainer(): Promise<boolean> {
  try {
    if (localStorage.getItem(ASKED_KEY) === '1') return false;
  } catch {
    // storage unavailable: ask the browser below
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state !== 'prompt') rememberAsked();
    return status.state === 'prompt';
  } catch {
    return true;
  }
}

function deniedProblem(reason: DeniedReason): PunchProblem {
  if (reason === 'pending') return { code: 'device_pending' };
  if (reason === 'inactive') return { code: 'account_inactive' };
  return { code: 'device_revoked' };
}

interface ViewContext {
  kind: PunchAction;
  place: PlaceFix;
  stream: MediaStream | null;
  preAck: readonly PunchAck[];
}

function resultView(live: LiveState, r: PunchFlowResult, c: ViewContext): PunchFlowState {
  const { kind, place } = c;
  const problem = (p: PunchProblem): PunchFlowState => ({ step: 'problem', kind, problem: p });
  switch (r.kind) {
    case 'success':
    case 'needs_proof':
      return { step: 'result', kind, result: r.punch, place };
    case 'pending':
      return { step: 'sent', kind, effectiveTs: r.punch.punch.effectiveTs };
    case 'outside':
      return problem({ code: 'outside', distanceM: r.distanceM, venueAllowed: true });
    case 'approximate':
      return problem({ code: 'location_approximate', accuracyM: r.accuracyM });
    case 'location_denied':
      return problem({ code: 'location_denied' });
    case 'location_timeout':
      return problem({ code: 'location_timeout' });
    case 'camera_denied':
      return problem({ code: 'camera_denied' });
    case 'camera_failed':
      return problem({ code: 'camera_failed' });
    case 'too_dark':
      return {
        step: 'camera',
        kind,
        place,
        stream: c.stream,
        photoUrl: null,
        tooDark: true,
        // The sheet offers "Send anyway" from 2 dark tries; WP-4 decides when that is allowed.
        darkTries: r.canSendAnyway ? Math.max(2, r.tries) : Math.min(1, r.tries),
      };
    case 'confirm':
      return c.preAck.includes(r.need)
        ? { step: 'submitting', kind }
        : { step: 'confirm', kind, reason: r.need };
    case 'too_early':
      return c.preAck.includes('too_early')
        ? { step: 'submitting', kind }
        : { step: 'confirm', kind, reason: 'too_early' };
    case 'pin_wrong':
      return {
        step: 'pin',
        kind,
        place,
        wrong: { triesLeft: r.triesLeft },
        forApproval: live.intent.requestApproval,
      };
    case 'pin_locked':
      return problem({ code: 'pin_locked', untilTs: r.until });
    case 'qr_rejected':
      return { step: 'scanning', kind, error: QR_SCAN_ERROR[r.reason] };
    case 'conflict':
      return problem({
        code: 'conflict',
        checkedIn: r.reason === 'already_in' || (r.reason === null && kind === 'in'),
      });
    case 'denied':
      return problem(deniedProblem(r.reason));
    case 'session_expired':
      return problem({ code: 'session_expired' });
    case 'upgrade':
      return problem({ code: 'upgrade_required' });
    case 'queued':
      return { step: 'queued', kind, clientTs: live.tapAt ?? Date.now() };
    case 'failed':
      if (r.reason === 'offline_unavailable') return problem({ code: 'offline_unavailable' });
      if (r.reason === 'device_key') return problem({ code: 'device_revoked' });
      return problem({ code: 'unknown', requestId: null });
  }
}

function toView(live: LiveState, c: ViewContext): PunchFlowState {
  const { kind, place } = c;
  switch (live.step) {
    case 'idle':
      return { step: 'idle' };
    case 'locating':
      return { step: 'locating', kind, accuracyM: live.location.bestAccuracyM };
    case 'camera':
      return {
        step: 'camera',
        kind,
        place,
        stream: c.stream,
        photoUrl: null,
        tooDark: false,
        darkTries: 0,
      };
    case 'pin':
      return { step: 'pin', kind, place, wrong: null, forApproval: live.intent.requestApproval };
    case 'signing':
    case 'submitting':
      return { step: 'submitting', kind };
    case 'result':
      return live.result ? resultView(live, live.result, c) : { step: 'idle' };
  }
}

export function usePunchFlowLive(): PunchFlow {
  const me = useStaffMe();
  const today = useToday();
  const qc = useQueryClient();
  const onChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: staffKeys.today });
  }, [qc]);
  const live = usePunchFlow({
    flags: me.flags,
    offsiteDutyId: today.data?.duty?.id ?? null,
    onChanged,
  });

  const [explain, setExplain] = useState<PunchAction | null>(null);
  const [scanning, setScanning] = useState(false);
  const preAck = useRef<readonly PunchAck[]>([]);
  const answered = useRef(new Set<string>());
  const lastKind = useRef<PunchAction>('in');
  const liveRef = useRef(live);
  liveRef.current = live;

  const s = live.state;
  const result = s.step === 'result' ? s.result : null;

  // Answer the server's confirm with what the person already said in the sheet (once per tap).
  useEffect(() => {
    if (!result) return;
    const need =
      result.kind === 'confirm' ? result.need : result.kind === 'too_early' ? 'too_early' : null;
    if (!need || !preAck.current.includes(need) || answered.current.has(need)) return;
    answered.current.add(need);
    if (result.kind === 'confirm') liveRef.current.confirm(true);
    else liveRef.current.checkInAnyway();
  }, [result]);

  if (s.kind === 'in' || s.kind === 'out') lastKind.current = s.kind;
  const kind = explain ?? lastKind.current;

  const actions = useMemo<PunchFlowActions>(() => {
    const current = () => {
      const st = liveRef.current.state;
      return st.step === 'result' ? st.result : null;
    };
    return {
      start(k, ack) {
        const r = current();
        // "Check in anyway" on a confirm the server asked for: answer it, keep the same tap.
        if (r?.kind === 'confirm' && ack.includes(r.need)) {
          preAck.current = [...preAck.current, ...ack];
          liveRef.current.confirm(true);
          return;
        }
        if (r?.kind === 'too_early' && ack.includes('too_early')) {
          preAck.current = [...preAck.current, ...ack];
          liveRef.current.checkInAnyway();
          return;
        }
        preAck.current = ack;
        answered.current = new Set();
        lastKind.current = k;
        setScanning(false);
        void wantsExplainer().then((yes) => {
          if (yes) setExplain(k);
          else liveRef.current.start(k);
        });
      },
      allowLocation() {
        setExplain((k) => {
          rememberAsked();
          if (k) liveRef.current.start(k);
          return null;
        });
      },
      retry() {
        const r = current();
        switch (r?.kind) {
          case 'location_denied':
          case 'location_timeout':
          case 'approximate':
            liveRef.current.retryLocation();
            break;
          case 'camera_denied':
          case 'camera_failed':
          case 'too_dark':
            liveRef.current.retake();
            break;
          default:
            liveRef.current.retry();
        }
      },
      capture(video) {
        if (video) void liveRef.current.capture(video);
      },
      retake() {
        liveRef.current.retake();
      },
      usePhoto() {
        const r = current();
        if (r?.kind === 'too_dark' && r.canSendAnyway) liveRef.current.checkInAnyway();
      },
      sendWithoutPhoto() {
        liveRef.current.sendToOwner('');
      },
      submitPin(pin) {
        liveRef.current.submitPin(pin);
      },
      scanDoorCode() {
        setScanning(true);
      },
      submitDoorCode(token) {
        setScanning(false);
        liveRef.current.scanDoorCode(token);
      },
      sendToOwner(note) {
        setScanning(false);
        liveRef.current.sendToOwner(note);
      },
      atVenue(placeName, note) {
        setScanning(false);
        liveRef.current.imAtVenue(placeName, note);
      },
      close() {
        setExplain(null);
        setScanning(false);
        liveRef.current.cancel();
      },
    };
  }, []);

  const loc = s.location;
  const place: PlaceFix = {
    type: s.intent.placeName ? 'venue' : 'none',
    name: s.intent.placeName,
    distanceM: null,
    accuracyM: loc.fix?.accuracy ?? loc.bestAccuracyM,
  };
  const ctx: ViewContext = { kind, place, stream: live.stream, preAck: preAck.current };
  const state: PunchFlowState =
    explain !== null
      ? { step: 'permission', kind: explain }
      : scanning
        ? { step: 'scanning', kind, error: null }
        : toView(s, ctx);

  return { state, actions, busy: s.step === 'signing' || s.step === 'submitting' };
}
