import { z } from 'zod';

/** Every error code the API can return, with its HTTP status (PRD 9.2). */
export const ERROR_STATUS = {
  VALIDATION: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  PIN_WRONG: 401,
  CODE_WRONG: 401,
  SIGNATURE_INVALID: 401,
  FORBIDDEN: 403,
  CSRF: 403,
  DEVICE_NOT_APPROVED: 403,
  ACCOUNT_INACTIVE: 403,
  STEP_UP_REQUIRED: 403,
  INSTALL_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NONCE_INVALID: 409,
  ALREADY_DECIDED: 409,
  MONTH_LOCKED: 409,
  DUPLICATE: 409,
  INVITE_EXPIRED: 410,
  LINK_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  LOCATION_APPROXIMATE: 422,
  OUTSIDE_FENCE: 422,
  TOO_EARLY: 422,
  RULE_VIOLATION: 422,
  PIN_LOCKED: 423,
  UPGRADE_REQUIRED: 426,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCode = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/**
 * Default safe English messages. The client maps `code` to translated copy where it has one;
 * the server may send a more specific message (for example "Wrong PIN. 3 tries left.").
 */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: 'Some details need fixing.',
  BAD_REQUEST: "We couldn't read that request.",
  UNAUTHENTICATED: 'Please sign in again.',
  PIN_WRONG: 'Wrong PIN.',
  CODE_WRONG: "That code doesn't match.",
  SIGNATURE_INVALID: "This phone's security key didn't match.",
  FORBIDDEN: "You don't have access to this.",
  CSRF: "We couldn't verify where this request came from. Reload the app and try again.",
  DEVICE_NOT_APPROVED: "This phone isn't approved yet.",
  ACCOUNT_INACTIVE: 'Your account is not active. Talk to the owner.',
  STEP_UP_REQUIRED: 'Enter your PIN to continue.',
  INSTALL_REQUIRED: 'The staff app works after you add it to your home screen.',
  NOT_FOUND: "We couldn't find that.",
  CONFLICT: 'That changed in the meantime. Reload and try again.',
  NONCE_INVALID: 'That took too long. Try again.',
  ALREADY_DECIDED: 'This was already decided.',
  MONTH_LOCKED: 'This month is closed.',
  DUPLICATE: 'This already exists.',
  INVITE_EXPIRED: 'This invite has expired.',
  LINK_EXPIRED: 'This link has expired. Send a new one.',
  PAYLOAD_TOO_LARGE: 'The photo is too large.',
  LOCATION_APPROXIMATE: 'Your phone is sharing only an approximate location.',
  OUTSIDE_FENCE: "You're outside the salon.",
  TOO_EARLY: "It's too early to check in.",
  RULE_VIOLATION: "That isn't allowed by the salon's rules.",
  PIN_LOCKED: 'Too many wrong tries.',
  UPGRADE_REQUIRED: 'Please update the app.',
  RATE_LIMITED: 'Too many tries. Wait a little and try again.',
  INTERNAL: "We couldn't complete that. Try again in a moment.",
  NOT_IMPLEMENTED: "This isn't ready yet.",
  UNAVAILABLE: "We couldn't reach the server. Try again in a moment.",
};
