import { ApiError, type Fix, type PunchResult } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import type { CapturedSelfie } from './camera';
import { classifyPunchError } from './errors';
import {
  FIX_TTL_MS,
  type FlowNeeds,
  initialPunchState,
  type PunchEvent,
  type PunchFlowState,
  punchReducer,
} from './state';

const T0 = 1792386720000;
const ALL: FlowNeeds = { location: true, selfie: true, pin: true };
const NO_SELFIE: FlowNeeds = { location: true, selfie: false, pin: true };
const FIX: Fix = {
  lat: 22.4606479,
  lng: 70.0565093,
  accuracy: 18,
  samples: 3,
  spreadM: 2,
  accuracySpreadM: 4,
  altitudeNullAll: false,
  speedNullAll: false,
};
const PHOTO: CapturedSelfie = {
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  sha256: 'a'.repeat(64),
  luminance: 120,
  width: 480,
  height: 360,
};
const DARK: CapturedSelfie = { ...PHOTO, luminance: 22 };
const ACCEPTED = fixtures.punchCreate as PunchResult;
const NEEDS_PROOF = variants.punchCreate?.['needs-proof'] as PunchResult;

function run(events: PunchEvent[], from: PunchFlowState = initialPunchState): PunchFlowState {
  return events.reduce(punchReducer, from);
}

const start = (needs: FlowNeeds = NO_SELFIE): PunchEvent => ({
  type: 'START',
  kind: needs.location ? 'in' : 'break_start',
  needs,
  idempotencyKey: 'key-1',
  at: T0,
});

/** Tap, fix, PIN: the state just before the request goes out. */
function ready(needs: FlowNeeds = NO_SELFIE): PunchFlowState {
  return run([
    start(needs),
    { type: 'LOCATED', fix: FIX, at: T0 + 3000 },
    { type: 'PIN_ENTERED', at: T0 + 6000 },
  ]);
}

function failWith(e: ApiError, from: PunchFlowState = ready()): PunchFlowState {
  const action = classifyPunchError(e);
  if (action.type !== 'result') throw new Error(`expected a result, got ${action.type}`);
  return run([{ type: 'SUBMITTING' }, { type: 'SUBMIT_FAILED', result: action.result }], from);
}

const apiError = (
  code: ConstructorParameters<typeof ApiError>[0]['code'],
  status: number,
  details?: Record<string, unknown>,
) => new ApiError({ code, status, details });

describe('punch flow: happy path (PRD 4.3.1)', () => {
  it('tap -> locating -> pin -> signing -> submitting -> success', () => {
    let s = run([start()]);
    expect(s.step).toBe('locating');
    expect(s.location.status).toBe('running');
    s = punchReducer(s, { type: 'LOCATION_PROGRESS', bestAccuracyM: 42, samples: 1 });
    expect(s.location.bestAccuracyM).toBe(42);
    s = punchReducer(s, { type: 'LOCATED', fix: FIX, at: T0 + 3000 });
    expect(s.step).toBe('pin');
    s = punchReducer(s, { type: 'PIN_ENTERED', at: T0 + 5000 });
    expect(s.step).toBe('signing');
    expect(s.submission).toEqual({ type: 'punch' });
    s = punchReducer(s, { type: 'SUBMITTING' });
    expect(s.step).toBe('submitting');
    s = punchReducer(s, { type: 'SUBMIT_OK', punch: ACCEPTED });
    expect(s.result?.kind).toBe('success');
  });

  it('with a selfie the camera shows first, then the PIN', () => {
    let s = run([start(ALL)]);
    expect(s.step).toBe('camera');
    expect(s.selfie.status).toBe('opening');
    s = run([{ type: 'CAMERA_READY' }, { type: 'LOCATED', fix: FIX, at: T0 + 2000 }], s);
    expect(s.step).toBe('camera');
    s = punchReducer(s, { type: 'CAPTURED', photo: PHOTO, at: T0 + 4000 });
    expect(s.selfie.status).toBe('taken');
    expect(s.step).toBe('pin');
  });

  it('a photo taken before the fix waits on locating', () => {
    const s = run([
      start(ALL),
      { type: 'CAMERA_READY' },
      { type: 'CAPTURED', photo: PHOTO, at: T0 + 1000 },
    ]);
    expect(s.step).toBe('locating');
  });

  it('break punches need no location, selfie or PIN', () => {
    const s = run([start({ location: false, selfie: false, pin: false })]);
    expect(s.step).toBe('signing');
  });

  it('a flagged punch looks like any success to staff', () => {
    const flagged = variants.punchCreate?.flagged as PunchResult;
    const s = run([{ type: 'SUBMITTING' }, { type: 'SUBMIT_OK', punch: flagged }], ready());
    expect(s.result?.kind).toBe('success');
  });
});

describe('punch flow: location (PRD 4.3.3)', () => {
  it('denied -> location_denied; retryLocation runs it again', () => {
    let s = run([start(), { type: 'LOCATION_FAILED', error: 'denied', at: T0 + 100 }]);
    expect(s.result).toEqual({ kind: 'location_denied' });
    const attempt = s.location.attempt;
    s = punchReducer(s, { type: 'RETRY_LOCATION', at: T0 + 9000 });
    expect(s.step).toBe('locating');
    expect(s.location.attempt).toBe(attempt + 1);
  });

  it('timeout and unavailable -> location_timeout', () => {
    expect(run([start(), { type: 'LOCATION_FAILED', error: 'timeout', at: T0 }]).result).toEqual({
      kind: 'location_timeout',
      reason: 'timeout',
    });
    expect(
      run([start(), { type: 'LOCATION_FAILED', error: 'unavailable', at: T0 }]).result,
    ).toEqual({
      kind: 'location_timeout',
      reason: 'unavailable',
    });
  });

  it('accuracy >= 1000 m -> approximate before the PIN is asked', () => {
    const s = run([start(), { type: 'LOCATED', fix: { ...FIX, accuracy: 1500 }, at: T0 }]);
    expect(s.result).toEqual({ kind: 'approximate', accuracyM: 1500 });
  });

  it('send to Urmi from denied goes on without a fix, with requestApproval', () => {
    const s = run([
      start(),
      { type: 'LOCATION_FAILED', error: 'denied', at: T0 },
      { type: 'SEND_TO_OWNER', note: 'GPS is off', at: T0 + 1000 },
    ]);
    expect(s.step).toBe('pin');
    expect(s.location.status).toBe('skipped');
    expect(s.intent).toMatchObject({ requestApproval: true, note: 'GPS is off' });
  });

  it('a door code from approximate goes on with the token', () => {
    const s = run([
      start(),
      { type: 'LOCATED', fix: { ...FIX, accuracy: 1500 }, at: T0 },
      { type: 'SCAN', token: 'ABCDEFGHJK', at: T0 + 1000 },
    ]);
    expect(s.step).toBe('pin');
    expect(s.intent.qrToken).toBe('ABCDEFGHJK');
  });

  it('the fix is kept 2 minutes for a PIN retry, then taken again', () => {
    const wrong = failWith(apiError('PIN_WRONG', 401, { triesLeft: 3 }));
    expect(wrong.result).toEqual({ kind: 'pin_wrong', triesLeft: 3 });
    expect(wrong.pinReady).toBe(false);
    const soon = punchReducer(wrong, { type: 'PIN_ENTERED', at: T0 + 3000 + FIX_TTL_MS - 1 });
    expect(soon.step).toBe('signing');
    const late = punchReducer(wrong, { type: 'PIN_ENTERED', at: T0 + 3000 + FIX_TTL_MS + 1 });
    expect(late.step).toBe('locating');
    expect(late.location.attempt).toBe(wrong.location.attempt + 1);
  });
});

describe('punch flow: camera (PRD 4.3.4)', () => {
  const live = () =>
    run([start(ALL), { type: 'CAMERA_READY' }, { type: 'LOCATED', fix: FIX, at: T0 }]);

  it('too dark twice offers sending anyway', () => {
    let s = punchReducer(live(), { type: 'CAPTURED', photo: DARK, at: T0 + 1000 });
    expect(s.result).toEqual({ kind: 'too_dark', tries: 1, canSendAnyway: false });
    expect(punchReducer(s, { type: 'CHECK_IN_ANYWAY', at: T0 + 1500 })).toBe(s);
    s = run(
      [
        { type: 'RETAKE', at: T0 + 2000 },
        { type: 'CAPTURED', photo: DARK, at: T0 + 3000 },
      ],
      s,
    );
    expect(s.result).toEqual({ kind: 'too_dark', tries: 2, canSendAnyway: true });
    s = punchReducer(s, { type: 'CHECK_IN_ANYWAY', at: T0 + 4000 });
    expect(s.selfie.status).toBe('taken');
    expect(s.step).toBe('pin');
  });

  it('camera denied -> send to Urmi without a photo', () => {
    let s = run([start(ALL), { type: 'CAMERA_FAILED', error: 'denied', at: T0 }]);
    expect(s.result).toEqual({ kind: 'camera_denied' });
    s = run(
      [
        { type: 'LOCATED', fix: FIX, at: T0 + 100 },
        { type: 'SEND_TO_OWNER', note: '', at: T0 + 200 },
      ],
      s,
    );
    expect(s.selfie.status).toBe('skipped');
    expect(s.intent.requestApproval).toBe(true);
    expect(s.step).toBe('pin');
  });

  it('retake from the PIN step reopens the camera', () => {
    const s = run(
      [
        { type: 'CAPTURED', photo: PHOTO, at: T0 + 1000 },
        { type: 'RETAKE', at: T0 + 2000 },
      ],
      live(),
    );
    expect(s.step).toBe('camera');
    expect(s.selfie.status).toBe('opening');
    expect(s.selfie.photo).toBeNull();
  });

  it('S-07.1 without a selfie the camera is never opened', () => {
    const s = ready(NO_SELFIE);
    expect(s.selfie.status).toBe('idle');
    expect(s.step).toBe('signing');
  });
});

describe('punch flow: server answers (PRD 4.3.2, 4.3.5, 4.4)', () => {
  it('outside -> scan door code resends with the token (PIN kept)', () => {
    const out = failWith(
      apiError('OUTSIDE_FENCE', 422, {
        distanceM: 340,
        siteName: 'Feelings Beauty Care',
        dutyId: null,
      }),
    );
    expect(out.result).toEqual({
      kind: 'outside',
      distanceM: 340,
      siteName: 'Feelings Beauty Care',
      dutyId: null,
    });
    const s = punchReducer(out, { type: 'SCAN', token: 'ABCDEFGHJK', at: T0 + 10_000 });
    expect(s.step).toBe('signing');
    expect(s.intent.qrToken).toBe('ABCDEFGHJK');
  });

  it("outside -> I'm at a venue resends with the place name", () => {
    const out = failWith(apiError('OUTSIDE_FENCE', 422, { distanceM: null }));
    const s = punchReducer(out, {
      type: 'IM_AT_VENUE',
      placeName: 'Patel wedding',
      note: 'Bridal',
      at: T0 + 10_000,
    });
    expect(s.step).toBe('signing');
    expect(s.intent).toMatchObject({
      placeName: 'Patel wedding',
      note: 'Bridal',
      requestApproval: false,
    });
  });

  it('confirm (week off) resends with that ack; no closes the sheet', () => {
    const c = failWith(apiError('RULE_VIOLATION', 422, { need: 'week_off' }));
    expect(c.result).toEqual({ kind: 'confirm', need: 'week_off' });
    expect(punchReducer(c, { type: 'CONFIRM', ack: true, at: T0 + 9000 }).intent.ack).toEqual([
      'week_off',
    ]);
    expect(punchReducer(c, { type: 'CONFIRM', ack: false, at: T0 + 9000 }).step).toBe('idle');
  });

  it('too early -> check in anyway adds the too_early ack', () => {
    const e = failWith(apiError('TOO_EARLY', 422, { earliestTs: T0 + 1, shiftStartTs: T0 + 2 }));
    expect(e.result).toEqual({ kind: 'too_early', earliestTs: T0 + 1, shiftStartTs: T0 + 2 });
    const s = punchReducer(e, { type: 'CHECK_IN_ANYWAY', at: T0 + 9000 });
    expect(s.intent.ack).toEqual(['too_early']);
    expect(s.step).toBe('signing');
  });

  it('PIN locked -> send to Urmi without a PIN', () => {
    const l = failWith(apiError('PIN_LOCKED', 423, { until: T0 + 900_000 }));
    expect(l.result).toEqual({ kind: 'pin_locked', until: T0 + 900_000 });
    const s = punchReducer(l, { type: 'SEND_TO_OWNER', note: 'Locked out', at: T0 + 9000 });
    expect(s.needs.pin).toBe(false);
    expect(s.step).toBe('signing');
  });

  it('needs proof -> scan attaches the code to the pending punch (S-06.4)', () => {
    const p = run([{ type: 'SUBMITTING' }, { type: 'SUBMIT_OK', punch: NEEDS_PROOF }], ready());
    expect(p.result?.kind).toBe('needs_proof');
    expect(p.pendingPunch?.id).toBe(NEEDS_PROOF.punch.id);
    const s = punchReducer(p, { type: 'SCAN', token: 'ABCDEFGHJK', at: T0 + 20_000 });
    expect(s.submission).toEqual({
      type: 'proof',
      punchId: NEEDS_PROOF.punch.id,
      qrToken: 'ABCDEFGHJK',
    });
    const sent = punchReducer(p, { type: 'SEND_TO_OWNER', note: 'At the door', at: T0 + 20_000 });
    expect(sent.submission).toEqual({
      type: 'approval',
      punchId: NEEDS_PROOF.punch.id,
      note: 'At the door',
      placeName: null,
    });
  });

  it('a rejected door code is dropped so the next scan replaces it', () => {
    const withCode = run([{ type: 'SUBMITTING' }], {
      ...ready(),
      intent: { ...ready().intent, qrToken: 'ABCDEFGHJK' },
    });
    const action = classifyPunchError(apiError('RULE_VIOLATION', 422, { reason: 'qr_expired' }));
    if (action.type !== 'result') throw new Error('expected a result');
    const s = punchReducer(withCode, { type: 'SUBMIT_FAILED', result: action.result });
    expect(s.result).toEqual({ kind: 'qr_rejected', reason: 'qr_expired' });
    expect(s.intent.qrToken).toBeNull();
  });

  it('session expired -> retry resends after sign-in', () => {
    const e = failWith(apiError('UNAUTHENTICATED', 401));
    expect(e.result).toEqual({ kind: 'session_expired' });
    expect(punchReducer(e, { type: 'RETRY', at: T0 + 30_000 }).step).toBe('signing');
  });

  it('queued after a network failure', () => {
    const s = run([{ type: 'SUBMITTING' }, { type: 'QUEUED' }], ready());
    expect(s.result).toEqual({ kind: 'queued', idempotencyKey: 'key-1' });
  });

  it('cancel returns to idle from anywhere, keeping attempt counters', () => {
    const s = punchReducer(ready(), { type: 'CANCEL' });
    expect(s.step).toBe('idle');
    expect(s.attempt).toBe(ready().attempt);
  });

  it('events that do not apply are ignored', () => {
    const idle = initialPunchState;
    for (const e of [
      { type: 'PIN_ENTERED', at: T0 },
      { type: 'SUBMITTING' },
      { type: 'CAPTURED', photo: PHOTO, at: T0 },
      { type: 'SCAN', token: 'ABCDEFGHJK', at: T0 },
      { type: 'RETRY', at: T0 },
    ] as PunchEvent[]) {
      expect(punchReducer(idle, e)).toBe(idle);
    }
  });
});

describe('classifyPunchError', () => {
  it('network failures and 5xx go to the offline queue; NONCE_INVALID renonces', () => {
    expect(classifyPunchError(apiError('UNAVAILABLE', 0)).type).toBe('offline');
    expect(classifyPunchError(apiError('INTERNAL', 500)).type).toBe('offline');
    expect(classifyPunchError(apiError('NONCE_INVALID', 409)).type).toBe('renonce');
  });

  it('maps device, upgrade and unexpected errors', () => {
    expect(classifyPunchError(apiError('DEVICE_NOT_APPROVED', 403, { reason: 'revoked' }))).toEqual(
      {
        type: 'result',
        result: { kind: 'denied', reason: 'revoked' },
      },
    );
    expect(classifyPunchError(apiError('UPGRADE_REQUIRED', 426))).toEqual({
      type: 'result',
      result: { kind: 'upgrade' },
    });
    expect(classifyPunchError(apiError('CONFLICT', 409, { reason: 'already_in' }))).toEqual({
      type: 'result',
      result: { kind: 'conflict', reason: 'already_in' },
    });
    expect(classifyPunchError(new TypeError('boom'))).toEqual({
      type: 'result',
      result: { kind: 'failed', reason: 'unexpected', code: null },
    });
  });
});
