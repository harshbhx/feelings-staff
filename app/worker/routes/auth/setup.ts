/**
 * `POST /setup` (PRD 4.1.7, 15.4 step 9, O-02.1): creates the org and its owner once, with the
 * default settings, the salon site, the five shift templates, the holidays and the leave types.
 * Needs the `X-Setup-Token` header; refuses with 409 once any org exists.
 */
import {
  DEFAULT_ORG_SETTINGS,
  DEFAULT_SHIFT_TEMPLATES,
  type Endpoints,
  type OrgSettings,
  SALON_DEFAULTS,
} from '@fs/contracts';
import type { Context } from 'hono';
import type { Handler } from '../../lib/api';
import type { AppEnv } from '../../lib/app-env';
import { timingSafeEqual } from '../../lib/crypto';
import { ApiException, fail } from '../../lib/errors';
import { ulid } from '../../lib/ulid';
import { forgetSingleOrg } from '../../middleware/context';
import { HOLIDAYS_2026, LEAVE_TYPES } from '../../seed';
import { normaliseEmail, withOrg } from '../../services/auth';
import type { Ctx } from '../../services/ports';

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'salon';
}

function checkToken(ctx: Ctx, c: Context<AppEnv>): void {
  const token = c.req.header('X-Setup-Token') ?? '';
  const expected = ctx.env.SETUP_TOKEN ?? '';
  if (expected.length < 16 || !timingSafeEqual(token, expected))
    fail('FORBIDDEN', 'The setup token is missing or wrong.');
}

export const setup: Handler<Endpoints['setup']> = async ({ body }, ctx, c) => {
  checkToken(ctx, c);
  const existing = await ctx.sys.first<{ id: string }>('SELECT id FROM orgs LIMIT 1');
  if (existing) fail('CONFLICT', 'The salon is already set up.');

  const email = normaliseEmail(body.ownerEmail);
  const bootstrap = ctx.env.OWNER_BOOTSTRAP_EMAIL
    ? normaliseEmail(ctx.env.OWNER_BOOTSTRAP_EMAIL)
    : '';
  if (bootstrap && email !== bootstrap)
    fail('RULE_VIOLATION', 'The owner email must be the one set in OWNER_BOOTSTRAP_EMAIL.', {
      field: 'ownerEmail',
    });

  const now = ctx.now();
  const orgId = ulid(now);
  const ownerId = ulid(now);
  const octx = withOrg(ctx, orgId);
  const db = octx.db;
  const settings: OrgSettings = structuredClone(DEFAULT_ORG_SETTINGS);

  const stmts: D1PreparedStatement[] = [
    ctx.sys.stmt(
      `INSERT INTO orgs (id, name, slug, timezone, owner_display_name, address, phone_e164, settings_json,
                         settings_version, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Asia/Kolkata', ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
      orgId,
      body.orgName.trim(),
      slugify(body.orgName),
      body.ownerDisplayName.trim(),
      SALON_DEFAULTS.address,
      SALON_DEFAULTS.phone,
      JSON.stringify(settings),
      now,
    ),
    db.insert('users', {
      id: ownerId,
      role: 'owner',
      name: body.ownerName.trim(),
      email,
      lang: 'en',
      status: 'active',
      created_at: now,
      updated_at: now,
    }),
    db.insert('sites', {
      id: ulid(now),
      kind: 'salon',
      name: body.orgName.trim(),
      lat: SALON_DEFAULTS.lat,
      lng: SALON_DEFAULTS.lng,
      radius_m: SALON_DEFAULTS.radiusM,
      max_accuracy_m: SALON_DEFAULTS.maxAccuracyM,
      active: 1,
      created_by: ownerId,
      created_at: now,
      updated_at: now,
    }),
  ];
  DEFAULT_SHIFT_TEMPLATES.forEach((t, i) => {
    stmts.push(
      db.insert('shift_templates', {
        id: ulid(now),
        name: t.name,
        segments_json: JSON.stringify(t.segments),
        break_min: t.breakMin,
        active: 1,
        sort: i,
        created_at: now,
        updated_at: now,
      }),
    );
  });
  for (const h of HOLIDAYS_2026) {
    stmts.push(
      db.insert('holidays', {
        id: ulid(now),
        date: h.date,
        name: h.name,
        paid: 1,
        worked_comp: h.workedComp,
        created_at: now,
      }),
    );
  }
  for (const lt of LEAVE_TYPES) {
    stmts.push(
      db.insert('leave_types', {
        id: ulid(now),
        code: lt.code,
        name: lt.name,
        paid: lt.paid,
        annual_quota: lt.quota,
        accrual: lt.accrual,
        usable_after_days: lt.usable,
        notice_days: lt.notice,
        backdate_days: lt.backdate,
        expiry_days: lt.expiry,
        active: lt.active,
      }),
    );
  }
  stmts.push(
    ctx.sys.stmt(
      "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('min_app_version', ?1)",
      ctx.env.MIN_APP_VERSION,
    ),
    octx.services.audit.stmt(octx, {
      category: 'change',
      action: 'org.setup',
      entity: 'org',
      entityId: orgId,
      after: { orgName: body.orgName.trim(), ownerId },
      actorType: 'system',
      actorId: null,
    }),
  );

  try {
    await ctx.sys.batch(stmts);
  } catch (e) {
    if (e instanceof ApiException) throw e;
    if (e instanceof Error && /UNIQUE/i.test(e.message))
      fail('CONFLICT', 'The salon is already set up.');
    throw e;
  }
  forgetSingleOrg();
  return { orgId };
};
