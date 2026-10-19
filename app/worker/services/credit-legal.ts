/**
 * The legal overtime band of Time credits (PRD 7.17.7): approved overtime beyond 9 h a day or 48 h
 * an ISO week counts a second time (`ot_legal`). The band of a day depends on the days before it in
 * its week, so recomputing a day also refreshes the `ot_legal` entries of the later, unlocked days of
 * that week, in the same batch. Owner: WP-9.
 */
import { addDays, weekday } from '@fs/contracts';
import { legalOtBand } from '@fs/engine';
import { ulid } from '../lib/ulid';
import type { CreditEntryRow } from './credit-entries';
import type { Ctx } from './ports';

interface WeekRow {
  work_date: string;
  worked_min: number;
  ot_approved_min: number;
  locked: number;
}

export interface LegalPlan {
  /** `legal_d` of the recomputed day itself. */
  legalMin: number;
  /** Statements that bring the later days' `ot_legal` entries in line. */
  stmts: D1PreparedStatement[];
}

/**
 * @param day the recomputed day: its total worked minutes and approved overtime
 * @param creditsOnFor whether Time credits is on for this person on a date
 */
export async function legalPlan(
  ctx: Ctx,
  userId: string,
  day: { date: string; totalMin: number; otApprovedMin: number },
  creditsOnFor: (date: string) => boolean,
): Promise<LegalPlan> {
  const monday = addDays(day.date, -((weekday(day.date) + 6) % 7));
  const sunday = addDays(monday, 6);
  const rows = await ctx.db.all<WeekRow>(
    `SELECT work_date, worked_min, ot_approved_min, locked FROM attendance_days
      WHERE org_id = ?org AND user_id = ? AND work_date BETWEEN ? AND ?`,
    userId,
    monday,
    sunday,
  );
  const days = new Map(
    rows.map((r) => [
      r.work_date,
      { workDate: r.work_date, totalMin: r.worked_min, otApprovedMin: r.ot_approved_min },
    ]),
  );
  days.set(day.date, {
    workDate: day.date,
    totalMin: day.totalMin,
    otApprovedMin: day.otApprovedMin,
  });
  const band = new Map(
    legalOtBand([...days.values()]).map((b) => [b.workDate, b.legalMin] as const),
  );
  const later = rows
    .filter((r) => r.work_date > day.date && r.locked === 0 && creditsOnFor(r.work_date))
    .map((r) => r.work_date);
  if (later.length === 0) return { legalMin: band.get(day.date) ?? 0, stmts: [] };

  const ents = await ctx.db.all<CreditEntryRow>(
    `SELECT * FROM credit_entries WHERE org_id = ?org AND user_id = ? AND status = 'active'
        AND kind IN ('ot', 'ot_legal') AND work_date IN (SELECT value FROM json_each(?))`,
    userId,
    JSON.stringify(later),
  );
  const now = ctx.now();
  const stmts: D1PreparedStatement[] = [];
  for (const date of later) {
    const ot = ents.find((e) => e.work_date === date && e.kind === 'ot');
    const old = ents.find((e) => e.work_date === date && e.kind === 'ot_legal');
    const want = ot ? Math.min(band.get(date) ?? 0, ot.minutes) : 0;
    if ((old?.minutes ?? 0) === want) continue;
    if (old)
      stmts.push(ctx.db.update('credit_entries', { status: 'superseded' }, 'id = ?', old.id));
    if (want > 0 && ot) {
      stmts.push(
        ctx.db.insert('credit_entries', {
          id: ulid(now),
          user_id: userId,
          work_date: date,
          kind: 'ot_legal',
          minutes: want,
          source_kind: ot.source_kind,
          source_id: ot.source_id,
          confirmed_by: ot.confirmed_by,
          confirmed_at: ot.confirmed_at,
          status: 'active',
          engine_version: ot.engine_version,
          created_at: now,
        }),
      );
    }
  }
  return { legalMin: band.get(day.date) ?? 0, stmts };
}
