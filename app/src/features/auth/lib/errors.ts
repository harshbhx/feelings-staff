/**
 * API errors to plain copy (PRD 4.1, 5 "Error" pattern): what happened in words, never a raw code;
 * the request id goes in a "Details" disclosure for support. Pure, so every mapping is unit-tested.
 * Keys are literal strings so CI's i18n check sees them.
 */
import { type ApiError, isApiError, istTime } from '@fs/contracts';
import { DeviceKeyError } from '../../../lib/device-key';

export type AuthFlow =
  | 'lookup'
  | 'join'
  | 'staffLogin'
  | 'newDevice'
  | 'ownerMagic'
  | 'ownerVerify'
  | 'ownerPassword'
  | 'stepUp';

/** What the screen does besides showing the message. */
export type ErrorAction =
  /** Join: back to phone and code. */
  | 'toDetails'
  /** Join: back to choosing a PIN. */
  | 'toPin'
  /** Join: back to the privacy notice. */
  | 'toNotice'
  /** Sign-in: this phone is waiting for approval. */
  | 'waiting'
  /** Sign-in: the owner rejected or removed this phone; forget its key. */
  | 'rejected'
  /** Sign-in: the server doesn't know this phone's key; forget it. */
  | 'unknownDevice'
  /** The browser can't keep a device key. */
  | 'unsupported'
  /** Offer the join flow (PIN not set yet). */
  | 'linkJoin'
  /** Step-up: no owner PIN exists yet. */
  | 'noOwnerPin';

export interface ErrorCopy {
  key: string;
  values?: Record<string, string | number>;
  action?: ErrorAction;
  /** Shown in "Details" for support, only for unexpected failures. */
  requestId?: string;
}

function num(e: ApiError, field: string): number | null {
  const v = e.details?.[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(e: ApiError, field: string): string | null {
  const v = e.details?.[field];
  return typeof v === 'string' ? v : null;
}

function withRequestId(copy: ErrorCopy, e: ApiError): ErrorCopy {
  return e.requestId ? { ...copy, requestId: e.requestId } : copy;
}

function tried(key: string, triesKey: string, tries: number | null): ErrorCopy {
  return tries === null ? { key } : { key: triesKey, values: { count: tries } };
}

export function describeAuthError(e: unknown, flow: AuthFlow): ErrorCopy {
  if (e instanceof DeviceKeyError) {
    return e.problem === 'missing'
      ? { key: 'auth:errors.deviceUnknown', action: 'unknownDevice' }
      : { key: 'auth:errors.unsupported', action: 'unsupported' };
  }
  if (!isApiError(e)) return { key: 'auth:errors.generic' };

  switch (e.code) {
    case 'UNAVAILABLE':
      return withRequestId({ key: 'auth:errors.network' }, e);

    case 'RATE_LIMITED':
      if (flow === 'join') return { key: 'auth:errors.joinRateLimited', action: 'toDetails' };
      if (flow === 'ownerMagic') return { key: 'auth:errors.emailRateLimited' };
      return { key: 'auth:errors.rateLimited' };

    case 'CODE_WRONG':
      if (flow === 'join')
        return {
          ...tried('auth:errors.codeWrong', 'auth:errors.codeWrongTries', num(e, 'triesLeft')),
          action: 'toDetails',
        };
      return tried(
        'auth:errors.ownerCodeWrong',
        'auth:errors.ownerCodeWrongTries',
        num(e, 'triesLeft'),
      );

    case 'INVITE_EXPIRED':
      return {
        key: str(e, 'state') === 'used' ? 'auth:errors.inviteUsed' : 'auth:errors.inviteExpired',
        action: 'toDetails',
      };

    case 'LINK_EXPIRED':
      return { key: 'auth:errors.linkExpired' };

    case 'PIN_WRONG': {
      const tries = num(e, 'triesLeft');
      if (tries !== null) return { key: 'auth:errors.pinWrongTries', values: { count: tries } };
      // Without triesLeft the server hides which part was wrong (unknown phone, wrong password).
      return {
        key: flow === 'ownerPassword' ? 'auth:errors.ownerPasswordWrong' : 'auth:errors.pinWrong',
      };
    }

    case 'PIN_LOCKED': {
      const until = num(e, 'until');
      return until === null
        ? { key: 'auth:errors.pinLockedSoon' }
        : { key: 'auth:errors.pinLocked', values: { time: istTime(until) } };
    }

    case 'UNAUTHENTICATED':
      return flow === 'ownerPassword'
        ? { key: 'auth:errors.ownerPasswordWrong' }
        : { key: 'auth:errors.signInAgain' };

    case 'DEVICE_NOT_APPROVED': {
      const status = str(e, 'deviceStatus');
      if (status === 'pending') return { key: 'auth:errors.devicePending', action: 'waiting' };
      if (status === 'rejected' || status === 'revoked')
        return { key: 'auth:errors.deviceRejected', action: 'rejected' };
      return { key: 'auth:errors.deviceUnknown', action: 'unknownDevice' };
    }

    case 'SIGNATURE_INVALID':
      return { key: 'auth:errors.signatureInvalid' };

    case 'NONCE_INVALID':
      return { key: 'auth:errors.nonceInvalid' };

    case 'ACCOUNT_INACTIVE':
      return str(e, 'reason') === 'pin_not_set'
        ? { key: 'auth:errors.pinNotSet', action: 'linkJoin' }
        : { key: 'auth:errors.accountInactive' };

    case 'RULE_VIOLATION':
      if (flow === 'stepUp' && e.details?.pinSet === false)
        return { key: 'auth:stepUp.noPin', action: 'noOwnerPin' };
      if (str(e, 'field') === 'pin') return { key: 'auth:join.pin.tooWeak', action: 'toPin' };
      if (Array.isArray(e.details?.consentsRequired))
        return { key: 'auth:errors.consentNeeded', action: 'toNotice' };
      return withRequestId({ key: 'auth:errors.generic' }, e);

    case 'VALIDATION':
    case 'BAD_REQUEST':
      return flow === 'ownerMagic' || flow === 'ownerVerify' || flow === 'ownerPassword'
        ? { key: 'auth:errors.checkOwnerDetails' }
        : { key: 'auth:errors.checkDetails' };

    default:
      return withRequestId({ key: 'auth:errors.generic' }, e);
  }
}
