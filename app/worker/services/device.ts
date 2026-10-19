/**
 * Devices (PRD 4.1.4-4.1.6, 10.3): registration of a phone's public key, approval with the one
 * approved device per person rule, rejection and revocation. Owner: WP-3.
 *
 * WP-4 calls `requireApprovedDevice(ctx)` before accepting a punch from a staff session.
 */
import type { DeviceStatus, DeviceView, EcPublicJwk, Platform } from '@fs/contracts';
import { jwkThumbprint } from '../lib/crypto';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import type { Ctx } from './ports';
import { revokeDeviceSessionsStmt } from './session';

export interface DeviceRow {
  id: string;
  org_id: string;
  user_id: string;
  public_jwk: string;
  jwk_thumbprint: string;
  label: string;
  platform: Platform;
  status: DeviceStatus;
  requested_at: number;
  decided_at: number | null;
  decided_by: string | null;
  approved_at: number | null;
  revoked_reason: string | null;
  last_seen_at: number | null;
}

export function deviceView(r: DeviceRow): DeviceView {
  return {
    id: r.id,
    userId: r.user_id,
    label: r.label,
    platform: r.platform,
    status: r.status,
    requestedAt: r.requested_at,
    approvedAt: r.approved_at,
    lastSeenAt: r.last_seen_at,
  };
}

export async function getDevice(ctx: Ctx, id: string): Promise<DeviceRow | null> {
  return ctx.db.first<DeviceRow>('SELECT * FROM devices WHERE org_id = ?org AND id = ?', id);
}

/** Only the public coordinates are kept (RFC 7638 members). */
function publicPart(jwk: EcPublicJwk): { kty: 'EC'; crv: 'P-256'; x: string; y: string } {
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

async function assertUsableKey(jwk: EcPublicJwk): Promise<void> {
  try {
    await crypto.subtle.importKey(
      'jwk',
      publicPart(jwk),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    fail('VALIDATION', "This phone's security key isn't valid.", {
      issues: [{ path: 'deviceJwk', message: 'Not a P-256 public key', code: 'custom' }],
    });
  }
}

export interface PreparedDevice {
  id: string;
  status: DeviceStatus;
  /** True when the same key was already registered for this person (pending or approved). */
  reused: boolean;
  stmts: D1PreparedStatement[];
}

/**
 * Prepare the statements that register a phone key for a person as `pending`. Any older pending
 * phone of the same person is superseded, so at most one waits for approval. The same key sent
 * again by the same person is reused as it is (a PIN reset on an approved phone keeps it approved).
 * A key that belongs to someone else, or one that was rejected or revoked, is refused (409).
 */
export async function prepareDevice(
  ctx: Ctx,
  opts: { userId: string; jwk: EcPublicJwk; label: string; platform: Platform },
): Promise<PreparedDevice> {
  await assertUsableKey(opts.jwk);
  const jwk = publicPart(opts.jwk);
  const thumbprint = await jwkThumbprint(jwk);
  const existing = await ctx.sys.first<Pick<DeviceRow, 'id' | 'org_id' | 'user_id' | 'status'>>(
    'SELECT id, org_id, user_id, status FROM devices WHERE jwk_thumbprint = ?1',
    thumbprint,
  );
  if (existing) {
    if (
      existing.org_id === ctx.orgId &&
      existing.user_id === opts.userId &&
      (existing.status === 'pending' || existing.status === 'approved')
    ) {
      return { id: existing.id, status: existing.status, reused: true, stmts: [] };
    }
    fail('CONFLICT', 'This phone needs a new security key. Try again.', {
      reason: 'device_key_used',
    });
  }
  const now = ctx.now();
  const id = ulid(now);
  return {
    id,
    status: 'pending',
    reused: false,
    stmts: [
      ctx.db.stmt(
        `UPDATE devices SET status = 'revoked', revoked_reason = 'superseded', decided_at = ?
          WHERE org_id = ?org AND user_id = ? AND status = 'pending'`,
        now,
        opts.userId,
      ),
      ctx.db.insert('devices', {
        id,
        user_id: opts.userId,
        public_jwk: JSON.stringify(jwk),
        jwk_thumbprint: thumbprint,
        label: opts.label.trim().slice(0, 80) || 'Phone',
        platform: opts.platform,
        status: 'pending',
        requested_at: now,
      }),
    ],
  };
}

/**
 * Statements that approve a pending device: every other approved phone of the person is revoked
 * (with its sessions) first, so the one-approved-device index always holds.
 */
export async function approveDeviceStmts(
  ctx: Ctx,
  device: DeviceRow,
  decidedBy: string,
): Promise<D1PreparedStatement[]> {
  const now = ctx.now();
  const others = await ctx.db.all<{ id: string }>(
    `SELECT id FROM devices WHERE org_id = ?org AND user_id = ? AND status = 'approved' AND id <> ?`,
    device.user_id,
    device.id,
  );
  const stmts: D1PreparedStatement[] = [];
  for (const o of others) {
    stmts.push(
      ctx.db.update(
        'devices',
        { status: 'revoked', revoked_reason: 'replaced', decided_at: now, decided_by: decidedBy },
        'id = ?',
        o.id,
      ),
      revokeDeviceSessionsStmt(ctx, o.id),
    );
  }
  stmts.push(
    ctx.db.update(
      'devices',
      { status: 'approved', decided_at: now, decided_by: decidedBy, approved_at: now },
      "id = ? AND status = 'pending'",
      device.id,
    ),
  );
  return stmts;
}

/** Statements that reject a pending device and end its sessions. */
export function rejectDeviceStmts(
  ctx: Ctx,
  device: DeviceRow,
  decidedBy: string,
): D1PreparedStatement[] {
  return [
    ctx.db.update(
      'devices',
      { status: 'rejected', decided_at: ctx.now(), decided_by: decidedBy },
      "id = ? AND status = 'pending'",
      device.id,
    ),
    revokeDeviceSessionsStmt(ctx, device.id),
  ];
}

/** Statements that revoke a device (owner removes a phone, person exits) and end its sessions. */
export function revokeDeviceStmts(
  ctx: Ctx,
  deviceId: string,
  reason: string,
  decidedBy: string | null,
): D1PreparedStatement[] {
  return [
    ctx.db.update(
      'devices',
      { status: 'revoked', revoked_reason: reason, decided_at: ctx.now(), decided_by: decidedBy },
      'id = ?',
      deviceId,
    ),
    revokeDeviceSessionsStmt(ctx, deviceId),
  ];
}

/**
 * For staff actions that need a trusted phone (punches): the session's device must be approved and
 * belong to the signed-in person. Throws 403 DEVICE_NOT_APPROVED otherwise.
 */
export async function requireApprovedDevice(ctx: Ctx): Promise<DeviceRow> {
  const deviceId = ctx.session?.deviceId;
  const userId = ctx.user?.id;
  const device = deviceId ? await getDevice(ctx, deviceId) : null;
  if (!device || device.user_id !== userId || device.status !== 'approved') {
    fail('DEVICE_NOT_APPROVED', undefined, { deviceStatus: device?.status ?? 'unknown' });
  }
  return device;
}
