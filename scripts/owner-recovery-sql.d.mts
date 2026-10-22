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
