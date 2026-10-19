/** WP-5 test kit: people, month-long punch scripts and the clock for payroll API tests. */
import { istToEpoch, monthDates, weekday } from '@fs/contracts';
import { ulid } from '../../../lib/ulid';
import { testEnv } from '../../../test/helpers';
import { createStaff, setClock, templateId } from '../../auth/test/kit';

/** 2 Nov 2026, 10:30 IST: October is over. */
export const NOV_2 = Date.UTC(2026, 10, 2, 5, 0);

export async function monthIsOver(): Promise<void> {
  await setClock(NOV_2);
}

export async function noHolidays(): Promise<void> {
  await testEnv.DB.prepare('DELETE FROM holidays').run();
}

export interface Person {
  id: string;
  name: string;
}

/** Priya-style staff: monthly, week-off Tuesday, Full day template; active so payroll includes her. */
export async function addPerson(
  ownerCookie: string,
  over: Record<string, unknown> = {},
): Promise<Person> {
  const created = await createStaff(ownerCookie, { joinDate: '2025-04-01', ...over });
  await testEnv.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?1")
    .bind(created.id)
    .run();
  const row = await testEnv.DB.prepare('SELECT name FROM users WHERE id = ?1')
    .bind(created.id)
    .first<{ name: string }>();
  return { id: created.id, name: row?.name ?? '' };
}

async function orgOf(userId: string): Promise<string> {
  const r = await testEnv.DB.prepare('SELECT org_id FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ org_id: string }>();
  return r?.org_id ?? '';
}

/** Sundays run the 10:00-13:00 template, as in PRD 7.15. */
export async function sundayRoster(userId: string, month: string): Promise<void> {
  const org = await orgOf(userId);
  const tpl = await templateId('Sunday');
  const sundays = monthDates(month).filter((d) => weekday(d) === 0);
  await testEnv.DB.batch(
    sundays.map((d) =>
      testEnv.DB.prepare(
        `INSERT INTO roster_overrides (org_id, user_id, work_date, kind, template_id, created_by, created_at)
         VALUES (?1, ?2, ?3, 'template', ?4, 'test', 0)`,
      ).bind(org, userId, d, tpl),
    ),
  );
}

type Punch = [kind: 'in' | 'out', hhmm: string];

export function punchStmts(
  org: string,
  userId: string,
  date: string,
  punches: Punch[],
  status: 'accepted' | 'pending' | 'flagged' = 'accepted',
): D1PreparedStatement[] {
  return punches.map(([kind, hhmm], i) => {
    const ts = istToEpoch(date, hhmm);
    return testEnv.DB.prepare(
      `INSERT INTO punches (id, org_id, user_id, kind, server_ts, effective_ts, work_date, source, pin_verified,
                            sig_verified, risk_score, risk_reasons_json, status, idempotency_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, 'online', 1, 1, 0, '[]', ?7, ?8, ?5)`,
    ).bind(ulid(ts + i), org, userId, kind, ts, date, status, `k-${userId}-${date}-${i}`);
  });
}

export interface MonthScript {
  /** Dates with these punches instead of the standard shift (empty list = no punches at all). */
  script?: Record<string, Punch[]>;
}

/** Standard shifts for every working day of the month (Tuesday off, Sundays 10-13). */
export async function fillMonth(userId: string, month: string, s: MonthScript = {}): Promise<void> {
  const org = await orgOf(userId);
  const stmts: D1PreparedStatement[] = [];
  for (const date of monthDates(month)) {
    const dow = weekday(date);
    const custom = s.script?.[date];
    if (custom !== undefined) {
      stmts.push(...punchStmts(org, userId, date, custom));
    } else if (dow === 2) {
    } else if (dow === 0) {
      stmts.push(
        ...punchStmts(org, userId, date, [
          ['in', '10:00'],
          ['out', '13:00'],
        ]),
      );
    } else {
      stmts.push(
        ...punchStmts(org, userId, date, [
          ['in', '10:00'],
          ['out', '20:00'],
        ]),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await testEnv.DB.batch(stmts.slice(i, i + 90));
}

export async function decideOvertime(
  userId: string,
  date: string,
  candidateMin: number,
  approvedMin: number,
): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO ot_decisions (id, org_id, user_id, work_date, candidate_min, approved_min, decision, decided_by, decided_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved', ?3, 0)`,
  )
    .bind(ulid(), await orgOf(userId), userId, date, candidateMin, approvedMin)
    .run();
}

export async function addPunches(
  userId: string,
  date: string,
  punches: Punch[],
  status: 'accepted' | 'pending' | 'flagged',
): Promise<void> {
  await testEnv.DB.batch(punchStmts(await orgOf(userId), userId, date, punches, status));
}
