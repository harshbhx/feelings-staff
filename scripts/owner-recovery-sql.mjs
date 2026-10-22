/**
 * SQL for scripts/owner-recovery.mjs (docs/runbooks/owner-recovery.md). Pure: no I/O and no Node
 * APIs, so the Workers tests run these exact statements against a real D1
 * (app/worker/routes/auth/pin-reset.test.ts). `wrangler d1 execute --command` takes no bound
 * parameters, so every value goes through `sqlString` or `sqlInt`.
 */

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** SQLite string literal (single quotes doubled). */
export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Integer literal; anything else is refused. */
export function sqlInt(value) {
  if (!Number.isSafeInteger(value)) throw new Error(`Not an integer: ${value}`);
  return String(value);
}

/** ULID (48-bit time + 80-bit randomness, Crockford base32), like app/worker/lib/ulid.ts. */
export function ulid(now) {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return time + [...bytes].map((b) => ULID_ALPHABET[b % 32]).join('');
}

/** Read only: the owners who can sign in, to pick the target. Never selects a hash or a salt. */
export const OWNER_LOOKUP_SQL = `SELECT id, org_id, name, email, pin_hash IS NOT NULL AS pin_set, pin_locked_until FROM users WHERE role = 'owner' AND status <> 'exited' ORDER BY id`;

/**
 * --clear-pin: clear the owner PIN with its failures and lock, sign the owner out everywhere, and
 * write the audit row `owner.pin_cleared_by_admin`. The next sign-in (email code) goes through the
 * first-PIN flow. Every statement is safe to run again.
 */
export function clearPinStatements({ ownerId, orgId, now, auditId, reason }) {
  const owner = sqlString(ownerId);
  const org = sqlString(orgId);
  const at = sqlInt(now);
  return [
    `UPDATE users SET pin_hash = NULL, pin_salt = NULL, pin_set_at = NULL, pin_failures = 0, pin_locked_until = NULL, updated_at = ${at} WHERE org_id = ${org} AND id = ${owner} AND role = 'owner'`,
    `UPDATE sessions SET revoked_at = ${at} WHERE org_id = ${org} AND user_id = ${owner} AND revoked_at IS NULL`,
    `INSERT INTO audit_log (id, org_id, category, actor_type, actor_id, action, entity, entity_id, after_json, reason, created_at) VALUES (${sqlString(auditId)}, ${org}, 'security', 'system', NULL, 'owner.pin_cleared_by_admin', 'user', ${owner}, '{"sessionsRevoked":true}', ${sqlString(reason)}, ${at})`,
  ];
}

/** A recovery code is valid for 24 hours. */
export const RECOVERY_CODE_TTL_MS = 24 * 60 * 60_000;
const RECOVERY_CODE_LENGTH = 16;
const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/**
 * A fresh recovery code: 16 Crockford base32 characters (80 bits) in groups of four
 * ("K7QM-4T9X-B2NE-VH5R"). 256 is a multiple of 32, so `byte % 32` is uniform.
 */
export function newRecoveryCode() {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ULID_ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}

/**
 * What the owner typed, as the 16 characters that were issued: case, dashes and spaces ignored, and
 * the look-alikes Crockford folds (I and L to 1, O to 0). Null when it cannot be a code.
 */
export function normalizeRecoveryCode(input) {
  const code = String(input)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return RECOVERY_CODE_PATTERN.test(code) ? code : null;
}

/**
 * The stored form: SHA-256 (hex) of the normalised code. The code carries 80 random bits, so a
 * plain hash (no secret, which this script does not have) cannot be guessed offline. The Worker
 * (app/worker/services/owner-recovery.ts) computes the same value.
 */
export async function recoveryCodeHash(code) {
  const data = new TextEncoder().encode(`owner-recovery:${code}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * --issue-code: a one-time code for the owner. Earlier unused codes of this owner stop working, the
 * new one is stored hashed (24 hours), and `owner.recovery_issued` is audited. The code itself is
 * never in the SQL, only its hash. Nothing else changes: sessions and passkeys stay until the owner
 * redeems the code.
 */
export function issueCodeStatements({ ownerId, orgId, now, codeId, codeHash, auditId, reason }) {
  const owner = sqlString(ownerId);
  const org = sqlString(orgId);
  const at = sqlInt(now);
  const expiresAt = sqlInt(now + RECOVERY_CODE_TTL_MS);
  return [
    `UPDATE owner_recovery_codes SET expires_at = ${at} WHERE org_id = ${org} AND user_id = ${owner} AND used_at IS NULL AND expires_at > ${at}`,
    `INSERT INTO owner_recovery_codes (id, org_id, user_id, code_hash, issued_by, expires_at, used_at, created_at) VALUES (${sqlString(codeId)}, ${org}, ${owner}, ${sqlString(codeHash)}, 'admin', ${expiresAt}, NULL, ${at})`,
    `INSERT INTO audit_log (id, org_id, category, actor_type, actor_id, action, entity, entity_id, after_json, reason, created_at) VALUES (${sqlString(auditId)}, ${org}, 'security', 'system', NULL, 'owner.recovery_issued', 'owner_recovery_code', ${sqlString(codeId)}, ${sqlString(JSON.stringify({ userId: ownerId, expiresAt: now + RECOVERY_CODE_TTL_MS }))}, ${sqlString(reason)}, ${at})`,
  ];
}
