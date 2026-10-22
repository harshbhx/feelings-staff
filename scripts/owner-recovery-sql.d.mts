export function sqlString(value: string): string;
export function sqlInt(value: number): string;
export function ulid(now: number): string;
export const OWNER_LOOKUP_SQL: string;
export function clearPinStatements(opts: {
  ownerId: string;
  orgId: string;
  now: number;
  auditId: string;
  reason: string;
}): string[];
export const RECOVERY_CODE_TTL_MS: number;
export function newRecoveryCode(): string;
export function normalizeRecoveryCode(input: string): string | null;
export function recoveryCodeHash(code: string): Promise<string>;
export function issueCodeStatements(opts: {
  ownerId: string;
  orgId: string;
  now: number;
  codeId: string;
  codeHash: string;
  auditId: string;
  reason: string;
}): string[];
