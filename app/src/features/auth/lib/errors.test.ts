import { ApiError, type ErrorCode } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { DeviceKeyError } from '../../../lib/device-key';
import { describeAuthError } from './errors';

const err = (code: ErrorCode, details?: Record<string, unknown>, requestId?: string) =>
  new ApiError({ code, status: 400, details, requestId });

describe('auth error copy (PRD 4.1)', () => {
  it('S-01.6 join: wrong code, expired and used invites, too many tries', () => {
    expect(describeAuthError(err('CODE_WRONG'), 'join')).toEqual({
      key: 'auth:errors.codeWrong',
      action: 'toDetails',
    });
    expect(describeAuthError(err('CODE_WRONG', { triesLeft: 2 }), 'join')).toEqual({
      key: 'auth:errors.codeWrongTries',
      values: { count: 2 },
      action: 'toDetails',
    });
    expect(describeAuthError(err('INVITE_EXPIRED', { state: 'expired' }), 'join').key).toBe(
      'auth:errors.inviteExpired',
    );
    expect(describeAuthError(err('INVITE_EXPIRED', { state: 'used' }), 'join').key).toBe(
      'auth:errors.inviteUsed',
    );
    expect(describeAuthError(err('RATE_LIMITED'), 'join').key).toBe('auth:errors.joinRateLimited');
  });

  it('join: a weak PIN or a missing consent sends the person back to that step', () => {
    expect(
      describeAuthError(err('RULE_VIOLATION', { field: 'pin', pinProblem: 'sequence' }), 'join'),
    ).toEqual({ key: 'auth:join.pin.tooWeak', action: 'toPin' });
    expect(
      describeAuthError(err('RULE_VIOLATION', { consentsRequired: ['selfie'] }), 'join').action,
    ).toBe('toNotice');
  });

  it('S-02.3 wrong PIN shows tries left; a lock shows the IST unlock time', () => {
    expect(describeAuthError(err('PIN_WRONG', { triesLeft: 3 }), 'staffLogin')).toEqual({
      key: 'auth:errors.pinWrongTries',
      values: { count: 3 },
    });
    expect(describeAuthError(err('PIN_WRONG'), 'staffLogin').key).toBe('auth:errors.pinWrong');
    const until = Date.parse('2026-10-19T10:42:00+05:30');
    expect(describeAuthError(err('PIN_LOCKED', { until }), 'staffLogin')).toEqual({
      key: 'auth:errors.pinLocked',
      values: { time: '10:42' },
    });
  });

  it('S-02.2 a pending, rejected or unknown phone cannot sign in', () => {
    expect(
      describeAuthError(err('DEVICE_NOT_APPROVED', { deviceStatus: 'pending' }), 'staffLogin')
        .action,
    ).toBe('waiting');
    for (const deviceStatus of ['rejected', 'revoked'])
      expect(
        describeAuthError(err('DEVICE_NOT_APPROVED', { deviceStatus }), 'staffLogin').action,
      ).toBe('rejected');
    expect(
      describeAuthError(err('DEVICE_NOT_APPROVED', { deviceStatus: 'unknown' }), 'staffLogin')
        .action,
    ).toBe('unknownDevice');
    expect(describeAuthError(new DeviceKeyError('missing'), 'staffLogin').action).toBe(
      'unknownDevice',
    );
    expect(describeAuthError(new DeviceKeyError('indexeddb'), 'join').action).toBe('unsupported');
  });

  it('a PIN never set points to the join code', () => {
    expect(
      describeAuthError(err('ACCOUNT_INACTIVE', { reason: 'pin_not_set' }), 'staffLogin'),
    ).toEqual({ key: 'auth:errors.pinNotSet', action: 'linkJoin' });
    expect(describeAuthError(err('ACCOUNT_INACTIVE'), 'staffLogin').key).toBe(
      'auth:errors.accountInactive',
    );
  });

  it('O-01.5 owner errors never say which part was wrong', () => {
    expect(describeAuthError(err('PIN_WRONG'), 'ownerPassword').key).toBe(
      'auth:errors.ownerPasswordWrong',
    );
    expect(describeAuthError(err('PIN_WRONG', { triesLeft: 4 }), 'ownerPassword').key).toBe(
      'auth:errors.pinWrongTries',
    );
    expect(describeAuthError(err('LINK_EXPIRED'), 'ownerVerify').key).toBe(
      'auth:errors.linkExpired',
    );
    expect(describeAuthError(err('CODE_WRONG', { triesLeft: 1 }), 'ownerVerify')).toEqual({
      key: 'auth:errors.ownerCodeWrongTries',
      values: { count: 1 },
    });
    expect(describeAuthError(err('RATE_LIMITED'), 'ownerMagic').key).toBe(
      'auth:errors.emailRateLimited',
    );
  });

  it('step-up without an owner PIN points to Settings', () => {
    expect(describeAuthError(err('RULE_VIOLATION', { pinSet: false }), 'stepUp')).toEqual({
      key: 'auth:stepUp.noPin',
      action: 'noOwnerPin',
    });
  });

  it('unexpected failures keep the request id for support; never a raw code', () => {
    expect(describeAuthError(err('INTERNAL', undefined, 'req-1'), 'join')).toEqual({
      key: 'auth:errors.generic',
      requestId: 'req-1',
    });
    expect(describeAuthError(err('UNAVAILABLE'), 'join').key).toBe('auth:errors.network');
    expect(describeAuthError(new Error('boom'), 'join').key).toBe('auth:errors.generic');
  });
});
