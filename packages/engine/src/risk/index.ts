/**
 * Risk score (PRD 4.4.3-4.4.4). Owner: WP-4. Pure: the API gathers the inputs, this adds the points.
 *
 * Outcome:
 * - `block`: the location does not place the person at a site and nothing overrides it (fence
 *   OUTSIDE, APPROXIMATE or no fix, without a valid door QR or an off-site duty pass). The API turns
 *   this into 422 OUTSIDE_FENCE / LOCATION_APPROXIMATE, or a pending punch when the staff member
 *   chose "Send to Urmi".
 * - otherwise by score: below `flagAt` accepted, `flagAt`..`proofAt` accepted and flagged,
 *   above `proofAt` needs proof (stored as pending). With the defaults: 29 accept, 30 and 60 flag,
 *   61 proof.
 */
import type { RiskInput, RiskReason, RiskResult } from '@fs/contracts';
import { haversineM } from '../fence';
import { isSuspectAsn } from './asn';

export { HOSTING_VPN_ASNS, isSuspectAsn } from './asn';
export {
  DOOR_STEP_MS,
  DOOR_TOKEN_LENGTH,
  doorStep,
  doorToken,
  isDoorTokenShape,
  matchDoorToken,
} from './door-token';

/** Points per signal (PRD 4.4.3). Negative points lower the risk. */
export const RISK_POINTS: Readonly<Record<RiskReason, number>> = {
  fence_uncertain: 35,
  zero_jitter: 30,
  replayed_point: 25,
  impossible_jump: 60,
  network_suspect: 25,
  device_tz: 15,
  clock_skew: 15,
  new_device: 10,
  offline: 10,
  salon_network: -30,
  door_qr: -100,
  offsite_duty: 0,
};

/** Time zones that count as IST (`Asia/Calcutta` is the legacy alias some browsers report). */
export const IST_ZONES: readonly string[] = ['Asia/Kolkata', 'Asia/Calcutta'];
export const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;
export const NEW_DEVICE_WINDOW_MS = 24 * 3_600_000;
export const JUMP_WINDOW_MS = 12 * 3_600_000;
export const JUMP_LIMIT_KMH = 120;
/** Two fixes closer in time than this are compared as if a minute apart (GPS noise guard). */
export const JUMP_MIN_INTERVAL_MS = 60_000;
export const ZERO_JITTER_MIN_SAMPLES = 3;

const same6 = (a: number, b: number) => Math.round(a * 1e6) === Math.round(b * 1e6);

/** Every signal that fires for this input, in the PRD's table order. */
export function riskSignals(input: RiskInput): RiskReason[] {
  const out: RiskReason[] = [];
  const fix = input.fix;
  if (input.fence === 'uncertain') out.push('fence_uncertain');
  if (
    fix &&
    fix.samples >= ZERO_JITTER_MIN_SAMPLES &&
    fix.spreadM === 0 &&
    fix.accuracySpreadM === 0 &&
    fix.altitudeNullAll &&
    fix.speedNullAll
  ) {
    out.push('zero_jitter');
  }
  if (fix && input.recentFixes.some((p) => same6(p.lat, fix.lat) && same6(p.lng, fix.lng))) {
    out.push('replayed_point');
  }
  const prev = input.previousFix;
  if (fix && prev) {
    const dt = Math.abs(input.nowTs - prev.ts);
    if (dt <= JUMP_WINDOW_MS) {
      const hours = Math.max(dt, JUMP_MIN_INTERVAL_MS) / 3_600_000;
      if (haversineM(fix, prev) / 1000 / hours > JUMP_LIMIT_KMH) out.push('impossible_jump');
    }
  }
  if ((input.ipCountry !== null && input.ipCountry !== 'IN') || isSuspectAsn(input.ipAsn)) {
    out.push('network_suspect');
  }
  if (input.deviceTz !== null && !IST_ZONES.includes(input.deviceTz)) out.push('device_tz');
  if (input.clockSkewMs !== null && Math.abs(input.clockSkewMs) > CLOCK_SKEW_LIMIT_MS) {
    out.push('clock_skew');
  }
  if (
    input.deviceApprovedAt !== null &&
    input.nowTs - input.deviceApprovedAt < NEW_DEVICE_WINDOW_MS
  ) {
    out.push('new_device');
  }
  if (input.offline) out.push('offline');
  if (input.salonNetworkMatch) out.push('salon_network');
  if (input.doorQrValid) out.push('door_qr');
  if (input.offsitePass) out.push('offsite_duty');
  return out;
}

/** Outcome of a score when the location is acceptable (PRD 4.4.4). */
export function outcomeForScore(
  score: number,
  thresholds: { flagAt: number; proofAt: number },
): 'accept' | 'flag' | 'proof' {
  if (score < thresholds.flagAt) return 'accept';
  if (score <= thresholds.proofAt) return 'flag';
  return 'proof';
}

/** Score, reasons and outcome for one punch (PRD 7.16 `riskScore`). */
export function riskScore(input: RiskInput): RiskResult {
  const reasons = riskSignals(input);
  const score = reasons.reduce((sum, r) => sum + RISK_POINTS[r], 0);
  const locationOk =
    input.doorQrValid || input.offsitePass || input.fence === 'pass' || input.fence === 'uncertain';
  return { score, reasons, outcome: locationOk ? outcomeForScore(score, input) : 'block' };
}
