/**
 * Demo scenario for the preview (WP-1, integration). Raw data only: about 12 staff, devices, the last
 * ~7 weeks of punches relative to "now", Sunday roster, one wedding duty, leave, a pending fix,
 * advances and a few inbox rows. Derived rows (attendance_days, payroll) are produced afterwards by
 * the real services (scripts/seed-demo.mjs runs the nightly job per day and the payroll flow), so the
 * demo exercises the same code as production. Test data only; never used in production.
 */
import { addDays, istDate, istToEpoch, weekday } from '@fs/contracts';
import { hashPin, jwkThumbprint, randomToken } from '../lib/crypto';
import { ulid } from '../lib/ulid';
import type { BasicSalon, SeedContext } from './index';

/** Shared PIN for every demo staff member (test data, preview only). */
export const DEMO_STAFF_PIN = '2580';

interface DemoPerson {
  key: string;
  name: string;
  phone: string;
  designation: string;
  salaryType: 'monthly' | 'daily';
  amountPaise: number;
  template: 'Full day' | 'Morning' | 'Evening' | 'Split';
  weekOffDow: number;
  joinDate: string;
  lang: 'en' | 'gu';
  device: string;
}

export const DEMO_STAFF: DemoPerson[] = [
  {
    key: 'priya',
    name: 'Priya Shah',
    phone: '+919824011201',
    designation: 'Stylist',
    salaryType: 'monthly',
    amountPaise: 1_500_000,
    template: 'Full day',
    weekOffDow: 2,
    joinDate: '2024-03-01',
    lang: 'en',
    device: 'Redmi Note 12 · Chrome',
  },
  {
    key: 'neha',
    name: 'Neha Parmar',
    phone: '+919824011202',
    designation: 'Makeup artist',
    salaryType: 'monthly',
    amountPaise: 1_800_000,
    template: 'Full day',
    weekOffDow: 3,
    joinDate: '2023-11-15',
    lang: 'en',
    device: 'iPhone 13 · Safari',
  },
  {
    key: 'kajal',
    name: 'Kajal Solanki',
    phone: '+919824011203',
    designation: 'Helper',
    salaryType: 'monthly',
    amountPaise: 1_200_000,
    template: 'Full day',
    weekOffDow: 4,
    joinDate: '2025-06-02',
    lang: 'gu',
    device: 'Realme C55 · Chrome',
  },
  {
    key: 'meena',
    name: 'Meena Vaghela',
    phone: '+919824011204',
    designation: 'Helper',
    salaryType: 'daily',
    amountPaise: 55_000,
    template: 'Full day',
    weekOffDow: 1,
    joinDate: '2025-01-06',
    lang: 'gu',
    device: 'Redmi 12C · Chrome',
  },
  {
    key: 'hetal',
    name: 'Hetal Dave',
    phone: '+919824011205',
    designation: 'Nail technician',
    salaryType: 'monthly',
    amountPaise: 1_400_000,
    template: 'Full day',
    weekOffDow: 5,
    joinDate: '2024-08-01',
    lang: 'en',
    device: 'Samsung Galaxy A15 · Chrome',
  },
  {
    key: 'dhara',
    name: 'Dhara Gohil',
    phone: '+919824011206',
    designation: 'Stylist',
    salaryType: 'monthly',
    amountPaise: 1_600_000,
    template: 'Full day',
    weekOffDow: 1,
    joinDate: '2023-04-10',
    lang: 'en',
    device: 'Vivo Y28 · Chrome',
  },
  {
    key: 'jinal',
    name: 'Jinal Kotak',
    phone: '+919824011207',
    designation: 'Beautician',
    salaryType: 'monthly',
    amountPaise: 1_350_000,
    template: 'Full day',
    weekOffDow: 3,
    joinDate: '2025-02-17',
    lang: 'en',
    device: 'Oppo A79 · Chrome',
  },
  {
    key: 'sejal',
    name: 'Sejal Makwana',
    phone: '+919824011208',
    designation: 'Makeup artist',
    salaryType: 'monthly',
    amountPaise: 1_700_000,
    template: 'Full day',
    weekOffDow: 4,
    joinDate: '2024-01-08',
    lang: 'en',
    device: 'iPhone 12 · Safari',
  },
  {
    key: 'riya',
    name: 'Riya Joshi',
    phone: '+919824011209',
    designation: 'Receptionist',
    salaryType: 'monthly',
    amountPaise: 1_250_000,
    template: 'Morning',
    weekOffDow: 2,
    joinDate: '2025-07-01',
    lang: 'en',
    device: 'Redmi Note 13 · Chrome',
  },
  {
    key: 'komal',
    name: 'Komal Chauhan',
    phone: '+919824011210',
    designation: 'Mehndi artist',
    salaryType: 'monthly',
    amountPaise: 1_450_000,
    template: 'Full day',
    weekOffDow: 5,
    joinDate: '2024-10-21',
    lang: 'gu',
    device: 'Samsung Galaxy M14 · Chrome',
  },
  {
    key: 'pooja',
    name: 'Pooja Rathod',
    phone: '+919824011211',
    designation: 'Beautician',
    salaryType: 'monthly',
    amountPaise: 1_300_000,
    template: 'Evening',
    weekOffDow: 6,
    joinDate: '2025-04-14',
    lang: 'en',
    device: 'Poco M6 · Chrome',
  },
  {
    key: 'bhavna',
    name: 'Bhavna Trivedi',
    phone: '+919824011212',
    designation: 'Trainer',
    salaryType: 'monthly',
    amountPaise: 2_000_000,
    template: 'Split',
    weekOffDow: 0,
    joinDate: '2022-06-01',
    lang: 'en',
    device: 'iPhone 14 · Safari',
  },
];

const SEGMENTS: Record<DemoPerson['template'] | 'Sunday', [string, string][]> = {
  'Full day': [['10:00', '20:00']],
  Morning: [['10:00', '15:00']],
  Evening: [['15:00', '20:00']],
  Split: [
    ['10:00', '14:00'],
    ['17:00', '21:00'],
  ],
  Sunday: [['10:00', '13:00']],
};

/** Small deterministic PRNG so the demo looks the same on every reset of the same day. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Multi-row INSERTs with literal values (generated data only), chunked under D1's statement size. */
function insertStatements(
  db: D1Database,
  table: string,
  rows: Record<string, unknown>[],
): D1PreparedStatement[] {
  if (rows.length === 0) return [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const out: D1PreparedStatement[] = [];
  let chunk: string[] = [];
  let size = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    out.push(db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.join(', ')}`));
    chunk = [];
    size = 0;
  };
  for (const r of rows) {
    const values = `(${cols.map((c) => lit(r[c])).join(', ')})`;
    if (size + values.length > 80_000) flush();
    chunk.push(values);
    size += values.length;
  }
  flush();
  return out;
}

async function newDeviceJwk(): Promise<
  JsonWebKey & { x: string; y: string; crv: string; kty: string }
> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { kty: 'EC', crv: 'P-256', x: jwk.x as string, y: jwk.y as string };
}

export interface DemoResult {
  staff: { id: string; name: string; phone: string; pin: string | null; joinCode: string | null }[];
  firstDate: string;
  today: string;
}

export async function seedDemo(s: SeedContext, base: BasicSalon, days = 49): Promise<DemoResult> {
  const { db, env, now } = s;
  const rand = mulberry32(Number(istDate(now).replace(/-/g, '')));
  const pick = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const today = istDate(now);
  const firstDate = addDays(today, -(days - 1));
  const holidays = new Set(
    (
      await db
        .prepare('SELECT date FROM holidays WHERE org_id = ?1')
        .bind(base.orgId)
        .all<{ date: string }>()
    ).results.map((r) => r.date),
  );
  const tpl = base.templateIds;
  const orgId = base.orgId;
  const ownerId = base.ownerId;

  const users: Record<string, unknown>[] = [];
  const profiles: Record<string, unknown>[] = [];
  const salaries: Record<string, unknown>[] = [];
  const devices: Record<string, unknown>[] = [];
  const consents: Record<string, unknown>[] = [];
  const roster: Record<string, unknown>[] = [];
  const punches: Record<string, unknown>[] = [];
  const leaveRequests: Record<string, unknown>[] = [];
  const ledger: Record<string, unknown>[] = [];
  const regs: Record<string, unknown>[] = [];
  const duties: Record<string, unknown>[] = [];
  const dutyStaff: Record<string, unknown>[] = [];
  const sites: Record<string, unknown>[] = [];
  const advances: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const otDecisions: Record<string, unknown>[] = [];

  const ids: Record<string, string> = {};
  const deviceIds: Record<string, string> = {};
  const result: DemoResult['staff'] = [];

  for (const p of DEMO_STAFF) {
    const id = ulid(now);
    ids[p.key] = id;
    const salt = randomToken(16);
    users.push({
      id,
      org_id: orgId,
      role: 'staff',
      name: p.name,
      phone_e164: p.phone,
      email: null,
      lang: p.lang,
      status: 'active',
      pin_hash: await hashPin(env.PIN_PEPPER, salt, DEMO_STAFF_PIN),
      pin_salt: salt,
      pin_set_at: now,
      created_at: now,
      updated_at: now,
    });
    profiles.push({
      user_id: id,
      org_id: orgId,
      employee_code: `FBC-${String(DEMO_STAFF.indexOf(p) + 1).padStart(3, '0')}`,
      designation: p.designation,
      join_date: p.joinDate,
      default_template_id: tpl[p.template],
      week_off_dow: p.weekOffDow,
      strong_mode: 0,
      created_at: now,
      updated_at: now,
    });
    salaries.push({
      id: ulid(now),
      org_id: orgId,
      user_id: id,
      effective_from: p.joinDate,
      salary_type: p.salaryType,
      amount_paise: p.amountPaise,
      created_by: ownerId,
      created_at: now,
    });
    const jwk = await newDeviceJwk();
    const deviceId = ulid(now);
    deviceIds[p.key] = deviceId;
    devices.push({
      id: deviceId,
      org_id: orgId,
      user_id: id,
      public_jwk: JSON.stringify(jwk),
      jwk_thumbprint: await jwkThumbprint(jwk),
      label: p.device,
      platform: p.device.includes('iPhone') ? 'ios' : 'android',
      status: 'approved',
      requested_at: istToEpoch(p.joinDate, '11:00'),
      decided_at: istToEpoch(p.joinDate, '11:05'),
      decided_by: ownerId,
      approved_at: istToEpoch(p.joinDate, '11:05'),
      last_seen_at: now,
    });
    consents.push({
      id: ulid(now),
      org_id: orgId,
      user_id: id,
      kind: 'privacy_notice',
      version: '2026-10-19',
      lang: p.lang,
      accepted_at: istToEpoch(p.joinDate, '11:02'),
    });
    result.push({ id, name: p.name, phone: p.phone, pin: DEMO_STAFF_PIN, joinCode: null });
  }

  // Pooja asked to move to a new phone: a pending device for the owner's Needs action.
  {
    const jwk = await newDeviceJwk();
    devices.push({
      id: ulid(now),
      org_id: orgId,
      user_id: ids.pooja,
      public_jwk: JSON.stringify(jwk),
      jwk_thumbprint: await jwkThumbprint(jwk),
      label: 'Redmi 13C · Chrome',
      platform: 'android',
      status: 'pending',
      requested_at: now - 40 * 60_000,
    });
  }

  // Leave plan, relative to today: [person, offset from today, code, status].
  const leavePlan: [
    string,
    number,
    number,
    'CL' | 'SL' | 'LOP',
    'approved' | 'pending' | 'rejected',
  ][] = [
    ['priya', -26, -25, 'CL', 'approved'],
    ['jinal', -12, -12, 'SL', 'approved'],
    ['kajal', -33, -33, 'LOP', 'approved'],
    ['riya', 0, 0, 'CL', 'approved'],
    ['hetal', 6, 7, 'CL', 'pending'],
    ['sejal', 3, 3, 'CL', 'pending'],
  ];
  const onLeave = new Set<string>();
  for (const [key, from, to, code, status] of leavePlan) {
    const fromDate = addDays(today, from);
    const toDate = addDays(today, to);
    const n = to - from + 1;
    const reqId = ulid(now);
    leaveRequests.push({
      id: reqId,
      org_id: orgId,
      user_id: ids[key],
      leave_type_id: base.leaveTypeIds[code],
      from_date: fromDate,
      to_date: toDate,
      half: 'none',
      days_paid: code === 'LOP' ? 0 : n,
      days_unpaid: code === 'LOP' ? n : 0,
      reason:
        code === 'SL'
          ? 'Fever'
          : key === 'hetal'
            ? "Cousin's wedding in Rajkot"
            : key === 'sejal'
              ? 'Family function'
              : 'Personal work',
      blackout_hit: 0,
      status,
      decided_by: status === 'pending' ? null : ownerId,
      decided_at: status === 'pending' ? null : istToEpoch(addDays(fromDate, -3), '12:10'),
      created_at: istToEpoch(addDays(fromDate, -4), '18:30'),
    });
    if (status === 'approved') {
      for (let i = 0; i < n; i++) onLeave.add(`${key}|${addDays(fromDate, i)}`);
      if (code !== 'LOP') {
        ledger.push({
          id: ulid(now),
          org_id: orgId,
          user_id: ids[key],
          leave_type_id: base.leaveTypeIds[code],
          entry_date: fromDate,
          kind: 'debit',
          days: -n,
          ref_type: 'leave_request',
          ref_id: reqId,
          created_by: ownerId,
          created_at: now,
        });
      }
    }
  }
  const year = today.slice(0, 4);
  for (const p of DEMO_STAFF) {
    for (const code of ['CL', 'SL'] as const) {
      ledger.push({
        id: ulid(now),
        org_id: orgId,
        user_id: ids[p.key],
        leave_type_id: base.leaveTypeIds[code],
        entry_date: p.joinDate > `${year}-01-01` ? p.joinDate : `${year}-01-01`,
        kind: 'credit',
        days: 7,
        ref_type: 'annual',
        created_by: ownerId,
        created_at: now,
      });
    }
  }

  const absent = new Set([
    `kajal|${addDays(today, -9)}`,
    `kajal|${addDays(today, -20)}`,
    `meena|${addDays(today, -16)}`,
  ]);

  // A wedding duty two Sundays ago at a venue, 04:00-09:00, for Neha and Komal; one tomorrow for Sejal.
  const lastSunday = (() => {
    let d = addDays(today, -7);
    while (weekday(d) !== 0) d = addDays(d, -1);
    return d;
  })();
  const venueDate = lastSunday;
  const venueSite = ulid(now);
  sites.push({
    id: venueSite,
    org_id: orgId,
    kind: 'venue',
    name: 'Hotel Aram, Jamnagar',
    lat: 22.4672,
    lng: 70.0663,
    radius_m: 200,
    max_accuracy_m: 50,
    active: 1,
    valid_from: istToEpoch(venueDate, '02:00'),
    valid_to: istToEpoch(venueDate, '11:00'),
    created_by: ownerId,
    created_at: now,
    updated_at: now,
  });
  const dutyId = ulid(now);
  duties.push({
    id: dutyId,
    org_id: orgId,
    site_id: venueSite,
    work_date: venueDate,
    start_ts: istToEpoch(venueDate, '04:00'),
    end_ts: istToEpoch(venueDate, '09:00'),
    mode: 'geofence',
    ot_preapproved: 1,
    place_name: 'Hotel Aram, Jamnagar',
    note: 'Patel wedding: bride and two family members',
    created_by: ownerId,
    created_at: istToEpoch(addDays(venueDate, -3), '16:00'),
  });
  dutyStaff.push({ duty_id: dutyId, user_id: ids.neha }, { duty_id: dutyId, user_id: ids.komal });
  const tomorrow = addDays(today, 1);
  const futureSite = ulid(now);
  sites.push({
    id: futureSite,
    org_id: orgId,
    kind: 'venue',
    name: 'Lal Bungalow lawns',
    lat: 22.4705,
    lng: 70.0577,
    radius_m: 200,
    max_accuracy_m: 50,
    active: 1,
    valid_from: istToEpoch(tomorrow, '03:00'),
    valid_to: istToEpoch(tomorrow, '12:00'),
    created_by: ownerId,
    created_at: now,
    updated_at: now,
  });
  const futureDuty = ulid(now);
  duties.push({
    id: futureDuty,
    org_id: orgId,
    site_id: futureSite,
    work_date: tomorrow,
    start_ts: istToEpoch(tomorrow, '05:00'),
    end_ts: istToEpoch(tomorrow, '10:00'),
    mode: 'geofence',
    ot_preapproved: 1,
    place_name: 'Lal Bungalow lawns',
    note: 'Mehta engagement',
    created_by: ownerId,
    created_at: now - 3 * 3_600_000,
  });
  dutyStaff.push({ duty_id: futureDuty, user_id: ids.sejal });

  const punch = (
    key: string,
    kind: 'in' | 'out',
    date: string,
    hhmm: string,
    extra: Partial<Record<string, unknown>> = {},
    dayOffset = 0,
  ) => {
    const ts = istToEpoch(date, hhmm, dayOffset) + pick(0, 59) * 1000;
    const dist = pick(4, 38);
    punches.push({
      id: ulid(ts),
      org_id: orgId,
      user_id: ids[key],
      device_id: deviceIds[key],
      kind,
      server_ts: ts,
      effective_ts: ts,
      client_ts: ts - pick(200, 1500),
      work_date: date,
      source: 'online',
      site_id: base.siteId,
      lat: 22.4606479 + (rand() - 0.5) * 0.0004,
      lng: 70.0565093 + (rand() - 0.5) * 0.0004,
      accuracy_m: pick(9, 32),
      distance_m: dist,
      distance_bucket: '0-50',
      fence_result: 'pass',
      samples_n: pick(3, 9),
      samples_spread_m: pick(2, 14),
      pin_verified: 1,
      sig_verified: 1,
      risk_score: 0,
      risk_reasons_json: '[]',
      status: 'accepted',
      ip_country: 'IN',
      device_tz: 'Asia/Kolkata',
      clock_skew_ms: pick(-900, 900),
      app_version: '0.1.0',
      client_duration_ms: pick(4200, 11800),
      idempotency_key: randomToken(16),
      created_at: ts,
      ...extra,
    });
  };

  const hm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const nowMin = toMin(new Date(now + 330 * 60_000).toISOString().slice(11, 16));

  for (let d = firstDate; d <= today; d = addDays(d, 1)) {
    const dow = weekday(d);
    const isToday = d === today;
    for (const p of DEMO_STAFF) {
      const key = p.key;
      if (
        d < p.joinDate ||
        holidays.has(d) ||
        onLeave.has(`${key}|${d}`) ||
        absent.has(`${key}|${d}`)
      )
        continue;
      if (dow === p.weekOffDow) continue;
      if (d === venueDate && (key === 'neha' || key === 'komal')) {
        const venueFix = {
          site_id: venueSite,
          offsite_duty_id: dutyId,
          lat: 22.4672,
          lng: 70.0663,
          place_name: null,
        };
        punch(key, 'in', d, '03:52', venueFix);
        punch(key, 'out', d, '09:24', venueFix);
        continue;
      }
      const sunday = dow === 0;
      if (sunday) {
        roster.push({
          org_id: orgId,
          user_id: ids[key],
          work_date: d,
          kind: 'template',
          template_id: tpl.Sunday,
          note: 'Sunday short shift',
          created_by: ownerId,
          created_at: now,
        });
      }
      const segs = SEGMENTS[sunday ? 'Sunday' : p.template];
      for (const [start, end] of segs) {
        const r = rand();
        const lateBy = r < 0.68 ? pick(-12, 3) : r < 0.88 ? pick(4, 14) : pick(15, 38);
        const inMin = toMin(start) + lateBy;
        const r2 = rand();
        const outDelta = r2 < 0.74 ? pick(0, 12) : r2 < 0.84 ? -pick(5, 25) : pick(35, 110);
        const outMin = toMin(end) + outDelta;
        if (isToday) {
          if (nowMin < inMin) continue;
          const special: Partial<Record<string, unknown>> =
            key === 'jinal'
              ? {
                  fence_result: 'uncertain',
                  distance_m: 118,
                  distance_bucket: '100-200',
                  accuracy_m: 64,
                  risk_score: 45,
                  risk_reasons_json: JSON.stringify(['fence_uncertain', 'device_tz']),
                  status: 'flagged',
                  device_tz: 'Asia/Dubai',
                }
              : key === 'sejal'
                ? {
                    fence_result: 'outside',
                    distance_m: 1340,
                    distance_bucket: '500+',
                    lat: 22.4705,
                    lng: 70.0577,
                    risk_score: 0,
                    status: 'pending',
                    pending_reason: 'offsite_unplanned',
                    place_name: "Bride's home, Lal Bungalow",
                    note: 'Trial makeup for Saturday bride',
                    site_id: null,
                  }
                : {};
          if (key === 'kajal') continue; // not in yet
          punch(key, 'in', d, hm(inMin), special);
          if (nowMin > outMin + 5) punch(key, 'out', d, hm(outMin));
          continue;
        }
        punch(key, 'in', d, hm(inMin));
        if (key === 'dhara' && d === addDays(today, -1)) continue; // forgot to check out
        punch(key, 'out', d, hm(outMin));
      }
    }
  }

  // Dhara forgot to check out yesterday and asked to fix it.
  const yesterday = addDays(today, -1);
  regs.push({
    id: ulid(now),
    org_id: orgId,
    user_id: ids.dhara,
    work_date: yesterday,
    kind: 'missed_out',
    proposed_out_ts: istToEpoch(yesterday, '20:10'),
    reason: 'Phone battery died before I left',
    status: 'pending',
    created_at: istToEpoch(today, '09:12'),
  });

  // Advances: Kajal's from last month (recovered in last month's payroll), Priya's from this month.
  const thisMonth = today.slice(0, 7);
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
  const nextMonth = addDays(`${thisMonth}-28`, 7).slice(0, 7);
  advances.push(
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.kajal,
      amount_paise: 300_000,
      given_on: `${lastMonth}-12`,
      mode: 'cash',
      reason: "Mother's medicine",
      plan: 'full',
      instalments_n: null,
      first_month: lastMonth,
      status: 'active',
      staff_ack: 'confirmed',
      staff_ack_at: istToEpoch(`${lastMonth}-12`, '19:40'),
      created_by: ownerId,
      created_at: istToEpoch(`${lastMonth}-12`, '19:30'),
    },
    {
      id: ulid(now),
      org_id: orgId,
      user_id: ids.priya,
      amount_paise: 200_000,
      given_on: addDays(today, -4),
      mode: 'upi',
      reason: 'School fees',
      plan: 'full',
      instalments_n: null,
      first_month: nextMonth,
      status: 'active',
      staff_ack: 'pending',
      created_by: ownerId,
      created_at: istToEpoch(addDays(today, -4), '13:15'),
    },
  );

  // A few inbox rows so the bell and inbox are not empty.
  const note = (
    userId: string,
    type: string,
    title: string,
    body: string,
    url: string,
    at: number,
    read: boolean,
  ) =>
    notifications.push({
      id: ulid(at),
      org_id: orgId,
      user_id: userId,
      type,
      title,
      body,
      url,
      priority: 'normal',
      push_status: 'sent',
      read_at: read ? at + 600_000 : null,
      created_at: at,
    });
  note(
    ownerId,
    'leave_requested',
    'Hetal asked for leave',
    "Casual · 'Cousin's wedding in Rajkot'",
    '/o/actions',
    now - 5 * 3_600_000,
    false,
  );
  note(
    ownerId,
    'new_device',
    'New phone for Pooja',
    'Approve it before she can check in.',
    '/o/actions',
    now - 40 * 60_000,
    false,
  );
  note(
    ownerId,
    'regularisation_requested',
    'Dhara asked to fix yesterday',
    'Forgot to check out. Left at 20:10.',
    '/o/actions',
    istToEpoch(today, '09:12'),
    false,
  );
  note(
    ids.priya as string,
    'advance_recorded',
    'Urmi recorded an advance of ₹2,000',
    'Recovery: ₹2,000 from next month. Is this right?',
    '/me',
    istToEpoch(addDays(today, -4), '13:15'),
    false,
  );
  note(
    ids.priya as string,
    'leave_decided',
    'Your leave is approved',
    '',
    '/requests',
    istToEpoch(addDays(today, -29), '12:10'),
    true,
  );

  const stmts = [
    ...insertStatements(db, 'users', users),
    ...insertStatements(db, 'staff_profiles', profiles),
    ...insertStatements(db, 'salary_history', salaries),
    ...insertStatements(db, 'devices', devices),
    ...insertStatements(db, 'consents', consents),
    ...insertStatements(db, 'sites', sites),
    ...insertStatements(db, 'offsite_duties', duties),
    ...insertStatements(db, 'offsite_duty_staff', dutyStaff),
    ...insertStatements(db, 'roster_overrides', roster),
    ...insertStatements(db, 'punches', punches),
    ...insertStatements(db, 'leave_requests', leaveRequests),
    ...insertStatements(db, 'leave_ledger', ledger),
    ...insertStatements(db, 'regularisations', regs),
    ...insertStatements(db, 'advances', advances),
    ...insertStatements(db, 'notifications', notifications),
    ...insertStatements(db, 'ot_decisions', otDecisions),
  ];
  for (let i = 0; i < stmts.length; i += 25) await db.batch(stmts.slice(i, i + 25));
  return { staff: result, firstDate, today };
}
