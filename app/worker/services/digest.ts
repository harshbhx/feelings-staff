/**
 * The weekly digest numbers (PRD 6 N30, O-21): one Monday-to-Sunday week of attendance, what is
 * still waiting for the owner, and the Time credits balances. Read-only. Owner: WP-8.
 */
import { addDays } from '@fs/contracts';
import { creditsOverview } from './credits';
import type { Ctx } from './ports';

export interface WeeklyDigest {
  weekStart: string;
  weekEnd: string;
  onTimePct: number;
  late: number;
  absent: number;
  leaves: number;
  otApprovedMin: number;
  pending: number;
  /** Null when Time credits are off. People at zero are left out. */
  credits: { name: string; balanceMin: number }[] | null;
}

export async function weeklyDigest(ctx: Ctx, weekStart: string): Promise<WeeklyDigest> {
  const weekEnd = addDays(weekStart, 6);
  const att = await ctx.db.first<{
    present: number;
    late: number;
    absent: number;
    leaves: number;
    ot: number;
  }>(
    `SELECT
       COALESCE(SUM(status IN ('P', 'H')), 0) AS present,
       COALESCE(SUM(status IN ('P', 'H') AND late_min > 0), 0) AS late,
       COALESCE(SUM(status IN ('A', 'LOP')), 0) AS absent,
       COALESCE(SUM(status = 'L'), 0) AS leaves,
       COALESCE(SUM(ot_approved_min), 0) AS ot
     FROM attendance_days WHERE org_id = ?org AND work_date >= ? AND work_date <= ?`,
    weekStart,
    weekEnd,
  );
  const present = att?.present ?? 0;
  const late = att?.late ?? 0;
  const pending = await ctx.db.first<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM leave_requests WHERE org_id = ?org AND status = 'pending')
     + (SELECT COUNT(*) FROM regularisations WHERE org_id = ?org AND status = 'pending')
     + (SELECT COUNT(*) FROM attendance_days WHERE org_id = ?org AND ot_status = 'pending')
     + (SELECT COUNT(*) FROM punches WHERE org_id = ?org AND status IN ('flagged', 'pending') AND reviewed_at IS NULL)
     + (SELECT COUNT(*) FROM devices WHERE org_id = ?org AND status = 'pending')
     + (SELECT COUNT(*) FROM advances WHERE org_id = ?org AND status = 'requested') AS n`,
  );
  const overview = await creditsOverview(ctx, {});
  return {
    weekStart,
    weekEnd,
    onTimePct: present === 0 ? 100 : Math.round(((present - late) / present) * 100),
    late,
    absent: att?.absent ?? 0,
    leaves: att?.leaves ?? 0,
    otApprovedMin: att?.ot ?? 0,
    pending: pending?.n ?? 0,
    credits: overview.enabled
      ? overview.staff
          .filter((s) => s.balanceMin !== 0)
          .map((s) => ({ name: s.name, balanceMin: s.balanceMin }))
      : null,
  };
}
