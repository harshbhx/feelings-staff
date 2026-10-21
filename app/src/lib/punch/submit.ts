/**
 * The side effects of one submission (PRD 4.3.5, 4.3.6, 4.4.2), as a plain async function so the
 * whole path (nonce, signing, send, error handling, offline queue) is unit-tested without React.
 * `use-punch-flow.ts` calls `runSubmission` once per `signing` attempt and dispatches the event it
 * returns into the reducer.
 */
import type { ApiClient, PunchRequest } from '@fs/contracts';
import type { PunchQueue, PunchSigner, PunchStore } from './deps';
import { classifyPunchError } from './errors';
import { ensureOfflineReady } from './offline';
import {
  buildPunchRequest,
  cleanText,
  deviceTimeZone,
  offlineProof,
  PAGE_SESSION_ID,
  punchProofMessage,
  sealPin,
  signPunchRequest,
  timeAnchorFrom,
} from './payload';
import type { PunchEvent, PunchFlowResult, PunchFlowState } from './state';

export interface SubmitDeps {
  api: Pick<
    ApiClient,
    'punchNonce' | 'punchCreate' | 'punchProof' | 'punchRequestApproval' | 'config' | 'time'
  >;
  getSigner: () => Promise<PunchSigner>;
  queue: PunchQueue;
  store: PunchStore;
  appVersion: string;
  isOnline: () => boolean;
  now: () => number;
  perfNow: () => number;
}

export interface SubmitInput {
  state: PunchFlowState;
  /** The PIN the person typed; held in memory by the hook, never in the reducer state. */
  pin: string | null;
  offsiteDutyId: string | null;
}

const failed = (reason: Extract<PunchFlowResult, { kind: 'failed' }>['reason']): PunchEvent => ({
  type: 'SUBMIT_FAILED',
  result: { kind: 'failed', reason, code: null },
});

/** Run the submission the state machine is waiting on and say what happened. */
export async function runSubmission(deps: SubmitDeps, input: SubmitInput): Promise<PunchEvent> {
  const sub = input.state.submission;
  if (!sub) return failed('unexpected');
  let signer: PunchSigner;
  try {
    signer = await deps.getSigner();
  } catch {
    return failed('device_key');
  }
  try {
    if (sub.type === 'proof') {
      const signature = await signer.sign(punchProofMessage(sub.punchId, sub.qrToken));
      const punch = await deps.api.punchProof({
        params: { id: sub.punchId },
        body: { qrToken: sub.qrToken, signature },
      });
      return { type: 'SUBMIT_OK', punch };
    }
    if (sub.type === 'approval') {
      const punch = await deps.api.punchRequestApproval({
        params: { id: sub.punchId },
        body: { note: cleanText(sub.note, 300) ?? '', placeName: cleanText(sub.placeName, 120) },
      });
      return { type: 'SUBMIT_OK', punch };
    }
  } catch (e) {
    const action = classifyPunchError(e);
    if (action.type === 'result') return { type: 'SUBMIT_FAILED', result: action.result };
    return failed('network');
  }
  return submitPunch(deps, input, signer);
}

function fieldsFor(
  deps: SubmitDeps,
  input: SubmitInput,
  signer: PunchSigner,
  nonce: string,
  pin: string | null,
  offline: PunchRequest['offline'],
) {
  const s = input.state;
  return buildPunchRequest({
    kind: s.kind ?? 'in',
    nonce,
    deviceId: signer.deviceId,
    idempotencyKey: s.idempotencyKey ?? '',
    fix: s.needs.location ? s.location.fix : null,
    selfieSha256: s.selfie.photo?.sha256 ?? null,
    qrToken: s.intent.qrToken,
    offsiteDutyId: input.offsiteDutyId,
    placeName: s.intent.placeName,
    note: s.intent.note,
    requestApproval: s.intent.requestApproval,
    ack: s.intent.ack,
    pin,
    offline,
    clientTs: deps.now(),
    clientDurationMs: s.tapAt === null ? 0 : deps.now() - s.tapAt,
    deviceTz: deviceTimeZone(),
    appVersion: deps.appVersion,
  });
}

async function submitPunch(
  deps: SubmitDeps,
  input: SubmitInput,
  signer: PunchSigner,
): Promise<PunchEvent> {
  const s = input.state;
  // The PIN pad is shown for an approval request too ("This will go to Urmi"), and the server asks
  // for the PIN on every punch: send what was typed. Only a locked PIN skips it (needs.pin off).
  const pin = s.needs.pin ? input.pin : null;
  if (s.needs.pin && pin === null) return { type: 'PIN_NEEDED' };
  const selfie = s.selfie.photo?.blob ?? null;
  if (!deps.isOnline()) return queueOffline(deps, input, signer, pin, selfie);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const n = await deps.api.punchNonce({ body: { purpose: 'punch' } });
      if (!('nonce' in n)) return failed('unexpected');
      await deps.store.setTimeAnchor(
        timeAnchorFrom(n, { perfNow: deps.perfNow(), dateNow: deps.now() }),
      );
      const request = await signPunchRequest(
        fieldsFor(deps, input, signer, n.nonce, pin, null),
        signer,
      );
      const punch = await deps.api.punchCreate(
        { body: request, files: selfie ? { selfie } : {} },
        { idempotencyKey: request.idempotencyKey },
      );
      // Top up the offline nonces in the background after a good punch.
      void ensureOfflineReady(deps.api, deps.store, { now: deps.now, perfNow: deps.perfNow });
      return { type: 'SUBMIT_OK', punch };
    } catch (e) {
      const action = classifyPunchError(e);
      if (action.type === 'result') return { type: 'SUBMIT_FAILED', result: action.result };
      if (action.type === 'offline') return queueOffline(deps, input, signer, pin, selfie);
      // renonce: loop once more with a fresh nonce.
    }
  }
  return failed('nonce');
}

/** Seal, sign and hand the punch to the offline queue (PRD 4.3.6). */
async function queueOffline(
  deps: SubmitDeps,
  input: SubmitInput,
  signer: PunchSigner,
  pin: string | null,
  selfie: Blob | null,
): Promise<PunchEvent> {
  const now = deps.now();
  let anchor: Awaited<ReturnType<PunchStore['getTimeAnchor']>>;
  let key: JsonWebKey | null;
  let nonce: Awaited<ReturnType<PunchStore['takeOfflineNonce']>>;
  try {
    anchor = await deps.store.getTimeAnchor();
    key = await deps.store.getPunchKey();
    nonce = anchor && key ? await deps.store.takeOfflineNonce(now) : null;
  } catch {
    return failed('offline_unavailable');
  }
  if (!anchor || !key || !nonce) return failed('offline_unavailable');
  const key0 = input.state.idempotencyKey ?? '';
  try {
    const clocks = { perfNow: deps.perfNow(), dateNow: now, pageSessionId: PAGE_SESSION_ID };
    const envelope = await sealPin(key, pin, key0);
    const request = await signPunchRequest(
      fieldsFor(deps, input, signer, nonce.nonce, null, offlineProof(anchor, clocks, envelope)),
      signer,
    );
    await deps.queue.enqueue({ idempotencyKey: key0, request, selfie });
    return { type: 'QUEUED' };
  } catch {
    return failed('queue_unavailable');
  }
}
