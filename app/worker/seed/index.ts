/**
 * Test and demo seed scenarios for /__test/reset (PRD 9.4). Owner: WP-1.
 * - empty: schema only, no org (for the /setup and first-run flows).
 * - basic-salon: the salon, owner, site, five templates, 2026 holidays, leave types; no staff.
 * - payroll-october / demo: filled by the integration seed (WP-1 phase C) on top of basic-salon.
 * All credentials here are test data for preview/local only.
 */
import {
  DEFAULT_ORG_SETTINGS,
  DEFAULT_SHIFT_TEMPLATES,
  SALON_DEFAULTS,
  type TestResetResult,
  type TestScenario,
} from '@fs/contracts';
import type { Env } from '../env';
import { hashPassword, hashPin, PASSWORD_ITERATIONS, randomToken } from '../lib/crypto';
import { ulid } from '../lib/ulid';

export const TEST_OWNER = {
  email: 'owner@feelings.test',
  name: 'Urmi Mengar',
  password: 'feelings-demo-2026',
  pin: '482913',
} as const;

export const HOLIDAYS_2026 = [
  { date: '2026-01-14', name: 'Uttarayan', workedComp: 'extra_pay' },
  { date: '2026-01-26', name: 'Republic Day', workedComp: 'extra_pay' },
  { date: '2026-03-04', name: 'Holi', workedComp: 'extra_pay' },
  { date: '2026-08-15', name: 'Independence Day', workedComp: 'extra_pay' },
  { date: '2026-09-04', name: 'Janmashtami', workedComp: 'extra_pay' },
  { date: '2026-10-02', name: 'Gandhi Jayanti', workedComp: 'extra_pay' },
  { date: '2026-10-20', name: 'Dussehra', workedComp: 'extra_pay' },
  { date: '2026-11-08', name: 'Diwali', workedComp: 'extra_pay' },
] as const;

export const LEAVE_TYPES = [
  {
    code: 'CL',
    name: 'Casual leave',
    paid: 1,
    quota: 7,
    accrual: 'annual',
    usable: 90,
    notice: 2,
    backdate: 0,
    expiry: null,
    active: 1,
  },
  {
    code: 'SL',
    name: 'Sick leave',
    paid: 1,
    quota: 7,
    accrual: 'annual',
    usable: 90,
    notice: 0,
    backdate: 3,
    expiry: null,
    active: 1,
  },
  {
    code: 'EL',
    name: 'Earned leave',
    paid: 1,
    quota: null,
    accrual: 'earned',
    usable: 0,
    notice: 7,
    backdate: 0,
    expiry: null,
    active: 0,
  },
  {
    code: 'CO',
    name: 'Comp-off',
    paid: 1,
    quota: null,
    accrual: 'event',
    usable: 0,
    notice: 0,
    backdate: 0,
    expiry: 60,
    active: 1,
  },
  {
    code: 'LOP',
    name: 'Unpaid leave',
    paid: 0,
    quota: null,
    accrual: 'none',
    usable: 0,
    notice: 0,
    backdate: 0,
    expiry: null,
    active: 1,
  },
] as const;

export interface SeedContext {
  env: Env;
  db: D1Database;
  now: number;
}

export interface BasicSalon {
  orgId: string;
  ownerId: string;
  siteId: string;
  templateIds: Record<string, string>;
  leaveTypeIds: Record<string, string>;
}

export async function seedBasicSalon(s: SeedContext): Promise<BasicSalon> {
  const { db, env, now } = s;
  const orgId = ulid(now);
  const ownerId = ulid(now);
  const siteId = ulid(now);
  const pinSalt = randomToken(16);
  const pwSalt = randomToken(16);
  const settings = { ...DEFAULT_ORG_SETTINGS, setup: { ...DEFAULT_ORG_SETTINGS.setup } };
  for (const k of Object.keys(settings.setup) as (keyof typeof settings.setup)[])
    settings.setup[k] = 'done';

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO orgs (id, name, slug, timezone, owner_display_name, address, phone_e164, settings_json, settings_version, created_at, updated_at)
         VALUES (?1, ?2, 'feelings', 'Asia/Kolkata', ?3, ?4, ?5, ?6, 1, ?7, ?7)`,
      )
      .bind(
        orgId,
        SALON_DEFAULTS.name,
        SALON_DEFAULTS.ownerDisplayName,
        SALON_DEFAULTS.address,
        SALON_DEFAULTS.phone,
        JSON.stringify(settings),
        now,
      ),
    db
      .prepare(
        `INSERT INTO users (id, org_id, role, name, phone_e164, email, lang, status, pin_hash, pin_salt, pin_set_at,
                            password_hash, password_salt, password_iter, created_at, updated_at)
         VALUES (?1, ?2, 'owner', ?3, ?4, ?5, 'en', 'active', ?6, ?7, ?8, ?9, ?10, ?11, ?8, ?8)`,
      )
      .bind(
        ownerId,
        orgId,
        TEST_OWNER.name,
        SALON_DEFAULTS.phone,
        TEST_OWNER.email,
        await hashPin(env.PIN_PEPPER, pinSalt, TEST_OWNER.pin),
        pinSalt,
        now,
        await hashPassword(env.PIN_PEPPER, pwSalt, TEST_OWNER.password),
        pwSalt,
        PASSWORD_ITERATIONS,
      ),
    db
      .prepare(
        `INSERT INTO sites (id, org_id, kind, name, lat, lng, radius_m, max_accuracy_m, active, created_by, created_at, updated_at)
         VALUES (?1, ?2, 'salon', ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?9)`,
      )
      .bind(
        siteId,
        orgId,
        SALON_DEFAULTS.name,
        SALON_DEFAULTS.lat,
        SALON_DEFAULTS.lng,
        SALON_DEFAULTS.radiusM,
        SALON_DEFAULTS.maxAccuracyM,
        ownerId,
        now,
      ),
  ];

  const templateIds: Record<string, string> = {};
  DEFAULT_SHIFT_TEMPLATES.forEach((t, i) => {
    const id = ulid(now);
    templateIds[t.name] = id;
    stmts.push(
      db
        .prepare(
          `INSERT INTO shift_templates (id, org_id, name, segments_json, break_min, active, sort, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)`,
        )
        .bind(id, orgId, t.name, JSON.stringify(t.segments), t.breakMin, i, now),
    );
  });

  for (const h of HOLIDAYS_2026) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO holidays (id, org_id, date, name, paid, worked_comp, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
        )
        .bind(ulid(now), orgId, h.date, h.name, h.workedComp, now),
    );
  }

  const leaveTypeIds: Record<string, string> = {};
  for (const lt of LEAVE_TYPES) {
    const id = ulid(now);
    leaveTypeIds[lt.code] = id;
    stmts.push(
      db
        .prepare(
          `INSERT INTO leave_types (id, org_id, code, name, paid, annual_quota, accrual, carry_max, usable_after_days, notice_days, backdate_days, expiry_days, active)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          id,
          orgId,
          lt.code,
          lt.name,
          lt.paid,
          lt.quota,
          lt.accrual,
          lt.usable,
          lt.notice,
          lt.backdate,
          lt.expiry,
          lt.active,
        ),
    );
  }

  stmts.push(
    db
      .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('min_app_version', ?1)")
      .bind(env.MIN_APP_VERSION),
  );
  await db.batch(stmts);
  return { orgId, ownerId, siteId, templateIds, leaveTypeIds };
}

export async function seedScenario(
  s: SeedContext,
  scenario: TestScenario,
): Promise<TestResetResult> {
  if (scenario === 'empty') {
    return {
      orgId: '00000000000000000000000000',
      owner: { email: '', password: null, pin: null },
      staff: [],
    };
  }
  const base = await seedBasicSalon(s);
  // payroll-october and demo add staff, attendance and payroll on top (integration seed, phase C).
  return {
    orgId: base.orgId,
    owner: { email: TEST_OWNER.email, password: TEST_OWNER.password, pin: TEST_OWNER.pin },
    staff: [],
  };
}
