/**
 * The `payroll-october` scenario (WP-5, added to the integration seed with the lead's OK): three staff
 * with a full October 2026 of punches and an October draft payroll run waiting for review, so the
 * owner sees a real run: blockers with their defaults, an incentive, a deduction and an advance.
 *
 * - Priya Shah is PRD 7.15 example 11 to the paisa once the incentive and advance below are in
 *   (net 11,987.00). The two October holidays are removed so 2 Oct is an ordinary half day.
 * - Meena Parmar (daily wage) has a pending punch and an unreviewed flagged punch.
 * - Kajal Solanki has two absences, undecided overtime, a pending leave request and a pending fix.
 *
 * The draft is not stored as payslips: it is computed from this data when opened. October is only
 * over once the test clock is on or after 1 Nov 2026 (`POST /__test/clock`), which finalising needs.
 */
import { istToEpoch, monthDates, weekday } from '@fs/contracts';
import { ENGINE_VERSION } from '@fs/engine';
import { hashPin, randomToken } from '../lib/crypto';
import { ulid } from '../lib/ulid';
import type { BasicSalon, SeedContext } from './index';

export const PAYROLL_OCTOBER_PIN = '2580';
const MONTH = '2026-10';

interface Person {
  key: 'priya' | 'meena' | 'kajal';
  name: string;
  phone: string;
  designation: string;
  salaryType: 'monthly' | 'daily';
  amountPaise: number;
  weekOffDow: number;
  /** Date -> punches ([] = none) instead of the standard shift. */
  script: Record<string, [string, string][]>;
}

const PEOPLE: Person[] = [
  {
    key: 'priya',
    name: 'Priya Shah',
    phone: '+919824011201',
    designation: 'Stylist',
    salaryType: 'monthly',
    amountPaise: 1_500_000,
    weekOffDow: 2,
    script: {
      '2026-10-01': [],
      '2026-10-02': [['10:00', '15:00']],
      '2026-10-07': [['10:25', '20:00']],
      '2026-10-08': [['10:30', '20:00']],
      '2026-10-09': [['10:22', '20:00']],
      '2026-10-11': [['10:15', '13:00']],
      '2026-10-14': [['10:00', '22:30']],
    },
  },
  {
    key: 'meena',
    name: 'Meena Parmar',
    phone: '+919824011202',
    designation: 'Helper',
    salaryType: 'daily',
    amountPaise: 55_000,
    weekOffDow: 2,
    script: {},
  },
  {
    key: 'kajal',
    name: 'Kajal Solanki',
    phone: '+919824011203',
    designation: 'Beautician',
    salaryType: 'monthly',
    amountPaise: 1_200_000,
    weekOffDow: 3,
    script: {
      '2026-10-05': [],
      '2026-10-06': [],
      '2026-10-22': [['10:00', '21:30']],
    },
  },
];

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

function insertStatements(
  db: D1Database,
  table: string,
  rows: Record<string, unknown>[],
): D1PreparedStatement[] {
  if (rows.length === 0) return [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += 40) {
    const values = rows.slice(i, i + 40).map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`);
    out.push(db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`));
  }
  return out;
}

export async function seedPayrollOctober(
  s: SeedContext,
  base: BasicSalon,
): Promise<
  { id: string; name: string; phone: string; pin: string | null; joinCode: string | null }[]
> {
  const { db, env, now } = s;
  const { orgId, ownerId, templateIds, leaveTypeIds } = base;
  const users: Record<string, unknown>[] = [];
  const profiles: Record<string, unknown>[] = [];
  const salaries: Record<string, unknown>[] = [];
  const roster: Record<string, unknown>[] = [];
  const punches: Record<string, unknown>[] = [];
  const ids = {} as Record<Person['key'], string>;
  const result: Awaited<ReturnType<typeof seedPayrollOctober>> = [];

  const punch = (
    userId: string,
    date: string,
    kind: 'in' | 'out',
    hhmm: string,
    status: 'accepted' | 'pending' | 'flagged' = 'accepted',
  ) => {
    const ts = istToEpoch(date, hhmm);
    punches.push({
      id: ulid(ts),
      org_id: orgId,
      user_id: userId,
      kind,
      server_ts: ts,
      effective_ts: ts,
      work_date: date,
      source: 'online',
      site_id: base.siteId,
      distance_m: 12,
      distance_bucket: '0-50',
      fence_result: status === 'flagged' ? 'uncertain' : 'pass',
      pin_verified: 1,
      sig_verified: 1,
      risk_score: status === 'flagged' ? 35 : 0,
      risk_reasons_json: status === 'flagged' ? '["new_device"]' : '[]',
      status,
      idempotency_key: randomToken(16),
      created_at: ts,
    });
  };

  for (const p of PEOPLE) {
    const id = ulid(now);
    ids[p.key] = id;
    const salt = randomToken(16);
    users.push({
      id,
      org_id: orgId,
      role: 'staff',
      name: p.name,
      phone_e164: p.phone,
      lang: 'en',
      status: 'active',
      pin_hash: await hashPin(env.PIN_PEPPER, salt, PAYROLL_OCTOBER_PIN),
      pin_salt: salt,
      pin_set_at: now,
      created_at: now,
      updated_at: now,
    });
    profiles.push({
      user_id: id,
      org_id: orgId,
      employee_code: `FBC-${String(PEOPLE.indexOf(p) + 1).padStart(3, '0')}`,
      designation: p.designation,
      join_date: '2024-03-01',
      default_template_id: templateIds['Full day'],
      week_off_dow: p.weekOffDow,
      strong_mode: 0,
      created_at: now,
      updated_at: now,
    });
    salaries.push({
      id: ulid(now),
      org_id: orgId,
      user_id: id,
      effective_from: '2024-03-01',
      salary_type: p.salaryType,
      amount_paise: p.amountPaise,
      created_by: ownerId,
      created_at: now,
    });
    result.push({ id, name: p.name, phone: p.phone, pin: PAYROLL_OCTOBER_PIN, joinCode: null });

    for (const date of monthDates(MONTH)) {
      const dow = weekday(date);
      if (dow === 0) {
        roster.push({
          org_id: orgId,
          user_id: id,
          work_date: date,
          kind: 'template',
          template_id: templateIds.Sunday,
          created_by: ownerId,
          created_at: now,
        });
      }
      const scripted = p.script[date];
      if (scripted !== undefined) {
        for (const [from, to] of scripted) {
          punch(id, date, 'in', from);
          punch(id, date, 'out', to);
        }
      } else if (dow !== p.weekOffDow) {
        punch(id, date, 'in', '10:00');
        punch(id, date, 'out', dow === 0 ? '13:00' : '20:00');
      }
    }
  }

  // Blockers (PRD 4.13.2): a pending punch and an unreviewed flagged one for Meena.
  punch(ids.meena, '2026-10-15', 'out', '20:05', 'pending');
  punch(ids.meena, '2026-10-16', 'in', '09:58', 'flagged');
  const leaveRequests = [
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.kajal,
      leave_type_id: leaveTypeIds.CL,
      from_date: '2026-10-28',
      to_date: '2026-10-29',
      half: 'none',
      days_paid: 2,
      days_unpaid: 0,
      reason: 'Cousin wedding in Rajkot',
      blackout_hit: 0,
      status: 'pending',
      created_at: istToEpoch('2026-10-19', '09:12'),
    },
  ];
  const regularisations = [
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.kajal,
      work_date: '2026-10-23',
      kind: 'missed_out',
      proposed_out_ts: istToEpoch('2026-10-23', '20:10'),
      reason: 'Forgot to check out. Left at 20:10.',
      status: 'pending',
      created_at: istToEpoch('2026-10-24', '09:02'),
    },
  ];
  const otDecisions = [
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.priya,
      work_date: '2026-10-14',
      candidate_min: 150,
      approved_min: 150,
      decision: 'approved',
      decided_by: ownerId,
      decided_at: istToEpoch('2026-10-15', '10:00'),
    },
  ];

  // The draft run with an incentive, a deduction and an advance recovered from it.
  const runId = ulid(now);
  const org = await db
    .prepare('SELECT settings_json FROM orgs WHERE id = ?1')
    .bind(orgId)
    .first<{ settings_json: string }>();
  const snapshot = { settings: JSON.parse(org?.settings_json ?? '{}'), overrides: [] };
  const runs = [
    {
      id: runId,
      org_id: orgId,
      month: MONTH,
      revision: 1,
      status: 'draft',
      settings_snapshot_json: JSON.stringify(snapshot),
      engine_version: ENGINE_VERSION,
      created_by: ownerId,
      created_at: istToEpoch('2026-11-01', '09:00'),
    },
  ];
  const adjustment = (userKey: Person['key'], kind: string, amountPaise: number, note: string) => ({
    id: ulid(now),
    org_id: orgId,
    payroll_run_id: runId,
    user_id: ids[userKey],
    kind,
    amount_paise: amountPaise,
    note,
    created_by: ownerId,
    created_at: istToEpoch('2026-11-01', '09:30'),
  });
  const adjustments = [
    adjustment('priya', 'incentive', 50_000, 'Bridal season incentive'),
    adjustment('kajal', 'other_deduction', 20_000, 'Uniform replacement'),
  ];
  const advances = [
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.priya,
      amount_paise: 300_000,
      given_on: '2026-10-12',
      mode: 'cash',
      reason: 'Family function',
      plan: 'full',
      first_month: MONTH,
      status: 'active',
      staff_ack: 'pending',
      created_by: ownerId,
      created_at: istToEpoch('2026-10-12', '13:15'),
    },
  ];

  const stmts = [
    db.prepare("DELETE FROM holidays WHERE org_id = ?1 AND date LIKE '2026-10-%'").bind(orgId),
    ...insertStatements(db, 'users', users),
    ...insertStatements(db, 'staff_profiles', profiles),
    ...insertStatements(db, 'salary_history', salaries),
    ...insertStatements(db, 'roster_overrides', roster),
    ...insertStatements(db, 'punches', punches),
    ...insertStatements(db, 'leave_requests', leaveRequests),
    ...insertStatements(db, 'regularisations', regularisations),
    ...insertStatements(db, 'ot_decisions', otDecisions),
    ...insertStatements(db, 'payroll_runs', runs),
    ...insertStatements(db, 'adjustments', adjustments),
    ...insertStatements(db, 'advances', advances),
  ];
  for (let i = 0; i < stmts.length; i += 25) await db.batch(stmts.slice(i, i + 25));
  return result;
}
