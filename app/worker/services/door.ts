/**
 * Door QR (PRD 4.5, 10.3): site secrets, token checks, the owner's "Show door code", door device
 * pairing, rotation and the salon-network signal. Owner: WP-4.
 *
 * Secrets: each paired door device has its own 32-byte secret, AES-GCM encrypted with QR_MASTER_KEY
 * (`door_devices.secret_enc`). The owner's phone screen uses a secret derived on the server from
 * QR_MASTER_KEY and the site id, so "Show door code" works with no door device (O-10.3) and that
 * secret never leaves the Worker. A token is valid when it matches any active secret of the site.
 */
import {
  type DoorCode,
  type DoorPairResult,
  fromBase64Url,
  normaliseCode,
  toBase64Url,
} from '@fs/contracts';
import { DOOR_STEP_MS, doorStep, doorToken, matchDoorToken } from '@fs/engine';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '../lib/app-env';
import {
  decryptSecret,
  encryptSecret,
  hashCode,
  hmac,
  randomBytes,
  randomCode,
} from '../lib/crypto';
import { fail } from '../lib/errors';
import { ulid } from '../lib/ulid';
import { issueSession } from '../middleware/session';
import type { Ctx } from './ports';

export const PAIRING_TTL_MS = 10 * 60_000;
/** How far back a token is still recognised as "expired" rather than "not ours" (10 min). */
const EXPIRED_LOOKBACK_STEPS = 20;

export interface DoorDeviceRow {
  id: string;
  org_id: string;
  site_id: string;
  label: string;
  secret_enc: string;
  secret_version: number;
  pairing_code_hash: string | null;
  pairing_expires_at: number | null;
  status: 'pairing' | 'active' | 'revoked';
  paired_at: number | null;
  last_seen_at: number | null;
  created_by: string;
  created_at: number;
}

export interface SiteRow {
  id: string;
  kind: 'salon' | 'venue';
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  max_accuracy_m: number;
  active: number;
  valid_from: number | null;
  valid_to: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export function doorDeviceView(r: DoorDeviceRow) {
  return {
    id: r.id,
    label: r.label,
    siteId: r.site_id,
    status: r.status,
    pairedAt: r.paired_at,
    lastSeenAt: r.last_seen_at,
  };
}

/** A copy of the request context bound to another org (pre-auth door pairing). */
export function withOrg(ctx: Ctx, orgId: string): Ctx {
  return {
    env: ctx.env,
    requestId: ctx.requestId,
    now: ctx.now,
    session: ctx.session,
    user: ctx.user,
    orgId,
    db: ctx.sys.forOrg(orgId),
    sys: ctx.sys,
    ip: ctx.ip,
    ipHmac: ctx.ipHmac,
    cf: ctx.cf,
    waitUntil: ctx.waitUntil,
    services: ctx.services,
  };
}

export async function salonSites(ctx: Ctx): Promise<SiteRow[]> {
  return ctx.db.all<SiteRow>(
    "SELECT * FROM sites WHERE org_id = ?org AND kind = 'salon' AND active = 1 ORDER BY created_at",
  );
}

/** The secret behind the owner's "Show door code" screen for a site (never sent anywhere). */
export async function ownerScreenSecret(
  ctx: Ctx,
  siteId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return fromBase64Url(await hmac(ctx.env.QR_MASTER_KEY, `door-owner|${ctx.orgId}|${siteId}`));
}

export interface SiteSecret {
  siteId: string;
  doorDeviceId: string | null;
  secret: Uint8Array<ArrayBuffer>;
}

/** Every active secret of the org's salon sites: the owner screen's plus each paired device's. */
export async function salonSecrets(ctx: Ctx): Promise<SiteSecret[]> {
  const sites = await salonSites(ctx);
  const devices = await ctx.db.all<DoorDeviceRow>(
    "SELECT * FROM door_devices WHERE org_id = ?org AND status = 'active'",
  );
  const out: SiteSecret[] = [];
  for (const s of sites) {
    out.push({ siteId: s.id, doorDeviceId: null, secret: await ownerScreenSecret(ctx, s.id) });
    for (const d of devices.filter((x) => x.site_id === s.id)) {
      out.push({
        siteId: s.id,
        doorDeviceId: d.id,
        secret: await decryptSecret(ctx.env.QR_MASTER_KEY, d.secret_enc),
      });
    }
  }
  return out;
}

export type DoorTokenCheck =
  | { ok: true; siteId: string; step: number; doorDeviceId: string | null }
  | { ok: false; reason: 'qr_invalid' | 'qr_expired' | 'qr_other_site' };

/**
 * Check a scanned or typed door token (PRD 4.5 "Validation"): the current or previous 30 s step of
 * an active secret. `siteId` limits the match to one site (else any salon site of the org).
 */
export async function checkDoorToken(
  ctx: Ctx,
  rawToken: string,
  nowTs: number,
  siteId?: string,
): Promise<DoorTokenCheck> {
  const token = normaliseCode(rawToken, 10);
  if (!token) return { ok: false, reason: 'qr_invalid' };
  const secrets = await salonSecrets(ctx);
  let otherSite = false;
  for (const s of secrets) {
    const step = await matchDoorToken(s.secret, token, nowTs);
    if (step === null) continue;
    if (siteId && s.siteId !== siteId) {
      otherSite = true;
      continue;
    }
    return { ok: true, siteId: s.siteId, step, doorDeviceId: s.doorDeviceId };
  }
  if (otherSite) return { ok: false, reason: 'qr_other_site' };
  const current = doorStep(nowTs);
  for (const s of secrets) {
    for (let k = 2; k <= EXPIRED_LOOKBACK_STEPS; k++) {
      if ((await doorToken(s.secret, current - k)) === token) {
        return { ok: false, reason: 'qr_expired' };
      }
    }
  }
  return { ok: false, reason: 'qr_invalid' };
}

export const DOOR_TOKEN_MESSAGES: Record<
  'qr_invalid' | 'qr_expired' | 'qr_other_site' | 'qr_reused',
  string
> = {
  qr_invalid: "That's not the door code.",
  qr_expired: 'That code has changed. Scan the new one.',
  qr_other_site: "That's not this salon's code.",
  qr_reused: 'That code was already used. Scan the new one.',
};

/** The owner's phone as the door (PRD 4.5): the current token for the salon site. */
export async function ownerDoorCode(ctx: Ctx, nowTs: number, origin: string): Promise<DoorCode> {
  const site = (await salonSites(ctx))[0];
  if (!site) return fail('NOT_FOUND', 'Set the salon location first.');
  const step = doorStep(nowTs);
  const token = await doorToken(await ownerScreenSecret(ctx, site.id), step);
  return {
    url: `${origin}/q/${site.id}/${token}`,
    token,
    step,
    expiresAt: (step + 1) * DOOR_STEP_MS,
    siteId: site.id,
    siteName: site.name,
  };
}

/** Remember the request's network as the salon's (door device and owner screen; PRD 4.4.3). */
export function salonNetworkStmt(ctx: Ctx): D1PreparedStatement | null {
  if (!ctx.ipHmac) return null;
  const now = ctx.now();
  return ctx.db.stmt(
    `INSERT INTO salon_networks (org_id, ip_hmac, first_seen, last_seen) VALUES (?org, ?, ?, ?)
     ON CONFLICT (org_id, ip_hmac) DO UPDATE SET last_seen = excluded.last_seen`,
    ctx.ipHmac,
    now,
    now,
  );
}

/** Was this request's network seen from the salon in the last 72 h? */
export async function isSalonNetwork(ctx: Ctx, nowTs: number): Promise<boolean> {
  if (!ctx.ipHmac) return false;
  const row = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM salon_networks WHERE org_id = ?org AND ip_hmac = ? AND last_seen >= ?',
    ctx.ipHmac,
    nowTs - 72 * 3_600_000,
  );
  return (row?.n ?? 0) > 0;
}

// ---- Door devices ------------------------------------------------------------------------------

export async function doorDeviceById(ctx: Ctx, id: string): Promise<DoorDeviceRow> {
  const row = await ctx.db.first<DoorDeviceRow>(
    'SELECT * FROM door_devices WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND');
}

/** Owner: start pairing a door device (PRD 4.5): a one-time 8-character code valid 10 minutes. */
export async function createPairing(
  ctx: Ctx,
  input: { label: string; siteId?: string | undefined },
): Promise<{ doorDeviceId: string; pairingCode: string; expiresAt: number }> {
  const sites = await salonSites(ctx);
  const site = input.siteId ? sites.find((s) => s.id === input.siteId) : sites[0];
  if (!site) return fail('NOT_FOUND', 'That salon location was not found.');
  const now = ctx.now();
  const id = ulid(now);
  const code = randomCode(8);
  const expiresAt = now + PAIRING_TTL_MS;
  await ctx.db.batch([
    ctx.db.insert('door_devices', {
      id,
      site_id: site.id,
      label: input.label,
      secret_enc: await encryptSecret(ctx.env.QR_MASTER_KEY, randomBytes(32)),
      secret_version: 1,
      pairing_code_hash: await hashCode(ctx.env.SESSION_SECRET, code),
      pairing_expires_at: expiresAt,
      status: 'pairing',
      created_by: ctx.user?.id ?? 'system',
      created_at: now,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: 'door_device.pairing_started',
      entity: 'door_device',
      entityId: id,
      after: { label: input.label, siteId: site.id, expiresAt },
    }),
  ]);
  return { doorDeviceId: id, pairingCode: code, expiresAt };
}

/** Door device: pair with the code (public), start a 365-day door session, hand over the secret. */
export async function pairDoor(
  ctx: Ctx,
  c: Context<AppEnv>,
  rawCode: string,
): Promise<z.infer<typeof DoorPairResult>> {
  const code = normaliseCode(rawCode, 8);
  if (!code) return fail('CODE_WRONG', "That code doesn't look right. Check it on Urmi's phone.");
  const now = ctx.now();
  const row = await ctx.sys.first<DoorDeviceRow & { site_name: string }>(
    `SELECT d.*, s.name AS site_name FROM door_devices d JOIN sites s ON s.id = d.site_id
      WHERE d.pairing_code_hash = ?1 AND d.status = 'pairing'`,
    await hashCode(ctx.env.SESSION_SECRET, code),
  );
  if (!row) return fail('CODE_WRONG', "That code doesn't match. Ask for a new one.");
  if ((row.pairing_expires_at ?? 0) < now) {
    return fail('LINK_EXPIRED', 'That code has expired. Ask for a new one.');
  }
  const octx = withOrg(ctx, row.org_id);
  await octx.db.batch([
    octx.db.update(
      'door_devices',
      {
        status: 'active',
        paired_at: now,
        last_seen_at: now,
        pairing_code_hash: null,
        pairing_expires_at: null,
      },
      "id = ? AND status = 'pairing'",
      row.id,
    ),
    ...[salonNetworkStmt(octx)].filter((s): s is D1PreparedStatement => s !== null),
    octx.services.audit.stmt(octx, {
      category: 'security',
      action: 'door_device.paired',
      entity: 'door_device',
      entityId: row.id,
      actorType: 'door',
      actorId: row.id,
    }),
  ]);
  await issueSession(octx, c, { orgId: row.org_id, kind: 'door', userId: null, deviceId: row.id });
  return {
    doorDeviceId: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    secret: toBase64Url(await decryptSecret(ctx.env.QR_MASTER_KEY, row.secret_enc)),
    serverTime: now,
  };
}

/** Owner: new secret for a door device; tokens from the old one stop working at once (O-10.4). */
export async function rotateDoorDevice(ctx: Ctx, id: string): Promise<DoorDeviceRow> {
  const row = await doorDeviceById(ctx, id);
  if (row.status === 'revoked') fail('CONFLICT', 'This door device was removed.');
  await ctx.db.batch([
    ctx.db.update(
      'door_devices',
      {
        secret_enc: await encryptSecret(ctx.env.QR_MASTER_KEY, randomBytes(32)),
        secret_version: row.secret_version + 1,
      },
      'id = ?',
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: 'door_device.rotate',
      entity: 'door_device',
      entityId: id,
      before: { secretVersion: row.secret_version },
      after: { secretVersion: row.secret_version + 1 },
    }),
  ]);
  return doorDeviceById(ctx, id);
}

/** Owner: unpair; its door sessions end. */
export async function revokeDoorDevice(ctx: Ctx, id: string): Promise<void> {
  const row = await doorDeviceById(ctx, id);
  const now = ctx.now();
  await ctx.db.batch([
    ctx.db.update(
      'door_devices',
      { status: 'revoked', pairing_code_hash: null, pairing_expires_at: null },
      'id = ?',
      id,
    ),
    ctx.db.update(
      'sessions',
      { revoked_at: now },
      "kind = 'door' AND device_id = ? AND revoked_at IS NULL",
      id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'security',
      action: 'door_device.revoke',
      entity: 'door_device',
      entityId: id,
      before: { status: row.status },
      after: { status: 'revoked' },
    }),
  ]);
}
