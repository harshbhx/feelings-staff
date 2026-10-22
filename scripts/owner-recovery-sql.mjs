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
