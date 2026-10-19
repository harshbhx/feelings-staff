/**
 * What the punch flow does with an API error (PRD 4.3.5, 4.4.2; server behaviour in the WP-4 punch
 * notes). Pure, so every branch is unit-tested.
 */
import { ApiError } from '@fs/contracts';
import type { DeniedReason, PunchFlowResult, QrRejectReason } from './state';

export type PunchErrorAction =
  /** Show this result. */
  | { type: 'result'; result: PunchFlowResult }
  /** NONCE_INVALID: fetch a new nonce, sign again and resend once, silently. */
  | { type: 'renonce' }
  /** No answer or a 5xx: the punch goes to the offline queue. */
  | { type: 'offline' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const DENIED: readonly DeniedReason[] = [
  'pending',
  'revoked',
  'rejected',
  'unknown',
  'other_user',
  'signature',
];
const QR_REASONS: readonly QrRejectReason[] = [
  'qr_expired',
  'qr_other_site',
  'qr_reused',
  'qr_invalid',
];
const NEEDS = ['week_off', 'holiday', 'on_leave'] as const;

function result(r: PunchFlowResult): PunchErrorAction {
  return { type: 'result', result: r };
}

export function classifyPunchError(e: unknown): PunchErrorAction {
  if (!(e instanceof ApiError)) {
    return result({ kind: 'failed', reason: 'unexpected', code: null });
  }
  const d = e.details ?? {};
  if (e.status === 0 || e.status >= 500 || e.code === 'UNAVAILABLE' || e.code === 'INTERNAL') {
    return { type: 'offline' };
  }
  switch (e.code) {
    case 'NONCE_INVALID':
      return { type: 'renonce' };
    case 'PIN_WRONG':
      return result({ kind: 'pin_wrong', triesLeft: num(d.triesLeft) });
    case 'PIN_LOCKED':
      return result({ kind: 'pin_locked', until: num(d.until) });
    case 'UNAUTHENTICATED':
      return result({ kind: 'session_expired' });
    case 'SIGNATURE_INVALID':
      return result({ kind: 'denied', reason: 'signature' });
    case 'ACCOUNT_INACTIVE':
      return result({ kind: 'denied', reason: 'inactive' });
    case 'DEVICE_NOT_APPROVED': {
      const reason = str(d.reason);
      const known = DENIED.find((r) => r === reason);
      return result({ kind: 'denied', reason: known ?? 'unknown' });
    }
    case 'TOO_EARLY':
      return result({
        kind: 'too_early',
        earliestTs: num(d.earliestTs),
        shiftStartTs: num(d.shiftStartTs),
      });
    case 'RULE_VIOLATION': {
      const need = NEEDS.find((n) => n === d.need);
      if (need) return result({ kind: 'confirm', need });
      const qr = QR_REASONS.find((r) => r === d.reason);
      if (qr) return result({ kind: 'qr_rejected', reason: qr });
      return result({ kind: 'failed', reason: 'server', code: e.code });
    }
    case 'OUTSIDE_FENCE':
      return result({
        kind: 'outside',
        distanceM: num(d.distanceM),
        siteName: str(d.siteName),
        dutyId: str(d.dutyId),
      });
    case 'LOCATION_APPROXIMATE':
      return result({ kind: 'approximate', accuracyM: num(d.accuracyM) });
    case 'CONFLICT': {
      const reason = d.reason === 'already_in' || d.reason === 'not_checked_in' ? d.reason : null;
      return result({ kind: 'conflict', reason });
    }
    case 'UPGRADE_REQUIRED':
      return result({ kind: 'upgrade' });
    case 'RATE_LIMITED':
      return result({ kind: 'failed', reason: 'rate_limited', code: e.code });
    default:
      return result({ kind: 'failed', reason: 'server', code: e.code });
  }
}
