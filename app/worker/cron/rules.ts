/**
 * The 5-minute rules job (PRD 9.5, 4.8, 4.13, 6). For one org, in IST: reminders, not-in-yet,
 * overtime running, missed check-outs, auto-close, held-notification release, morning summary,
 * payroll draft, pay-day reminder and duty reminders. Every action is claimed in `cron_runs`
 * first, so it happens once per slot even when ticks repeat or retry. Owner: WP-8.
 *
 * Late check-in alerts are not here: they are emitted on the punch itself (WP-4), and the Notifier
 * merges same-type alerts within five minutes at that moment, so there is nothing to flush later.
 */
import {
  addDays,
  HOUR_MS,
  hhmmToMin,
  istDate,
  istTime,
  istToEpoch,
  MINUTE_MS,
  prevMonth,
} from '@fs/contracts';
import type { Env } from '../env';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { inQuietHours, releaseHeld } from '../services/notifier';
import { firstStart, lastEnd, loadPersonDays, type PersonDay } from '../services/notifier-schedule';
import { sweepPayslipPdfs } from '../services/payslip-pdf';
import type { Ctx } from '../services/ports';
import { type CronCtx, once, systemCtx } from './context';
import { weeklyDigestRule } from './digest';
import { whatsappEscalation } from './escalation';

const JOB = 'rules';

interface PunchRow {
  user_id: string;
  kind: 'in' | 'out' | 'break_start' | 'break_end';
  effective_ts: number;
  site_id: string | null;
  work_date: string;
}

/** What a person's punches say about one date. */
export interface PunchState {
  firstInTs: number | null;
  /** The last in/out punch is an `in`. */
  open: boolean;
  openInTs: number | null;
  siteId: string | null;
}

export function punchStates(rows: PunchRow[]): Map<string, PunchState> {
  const out = new Map<string, PunchState>();
  for (const r of rows) {
    if (r.kind !== 'in' && r.kind !== 'out') continue;
    const key = `${r.user_id}|${r.work_date}`;
    const s = out.get(key) ?? { firstInTs: null, open: false, openInTs: null, siteId: null };
    if (r.kind === 'in') {
      s.firstInTs ??= r.effective_ts;
      s.open = true;
      s.openInTs = r.effective_ts;
      s.siteId = r.site_id;
    } else {
      s.open = false;
    }
    out.set(key, s);
  }
  return out;
}

const within = (at: number, from: number, windowMs: number) => at >= from && at < from + windowMs;

interface RuleEnv {
  c: CronCtx;
  ctx: Ctx;
  at: number;
  date: string;
  counts: Record<string, number>;
  bump(k: string, n?: number): void;
}

const dutyRunning = (day: PersonDay, at: number) =>
  day.duties.some((d) => d.startTs <= at && at <= d.endTs);

export async function runRules(
  env: Env,
  orgId: string,
  at: number,
): Promise<Record<string, number>> {
  const c = await systemCtx(env, orgId, at);
  const { ctx } = c;
  const counts: Record<string, number> = {};
  const r: RuleEnv = {
    c,
    ctx,
    at,
    date: istDate(at),
    counts,
    bump: (k, n = 1) => {
      counts[k] = (counts[k] ?? 0) + n;
    },
  };
  const rules: [string, (r: RuleEnv) => Promise<void>][] = [
    ['shift', shiftRules],
    ['autoClose', autoClose],
    ['release', releaseHeldRule],
    ['summary', morningSummary],
    ['payroll', payrollRules],
    ['duties', dutyReminders],
    [
      'whatsapp',
      async (rr) => rr.bump('whatsapp_escalation', await whatsappEscalation(rr.ctx, JOB, rr.date)),
    ],
    [
      'digest',
      async (rr) => ((await weeklyDigestRule(rr.ctx, JOB)) ? rr.bump('weekly_digest') : undefined),
    ],
    ['payslipPdfs', async (rr) => rr.bump('payslip_pdf', await sweepPayslipPdfs(rr.ctx))],
  ];
  for (const [name, fn] of rules) {
    try {
      await fn(r);
    } catch (e) {
      console.error(JSON.stringify({ msg: 'cron.rule_error', rule: name, error: String(e) }));
    }
  }
  await c.settle();
  return counts;
}

async function loadPunchStates(ctx: Ctx, dates: string[]): Promise<Map<string, PunchState>> {
  const rows = await ctx.db.all<PunchRow>(
    `SELECT user_id, kind, effective_ts, site_id, work_date FROM punches
      WHERE org_id = ?org AND work_date IN (${dates.map(() => '?').join(', ')})
        AND status NOT IN ('rejected', 'superseded')
      ORDER BY effective_ts, id`,
    ...dates,
  );
  return punchStates(rows);
}

// N4, N3, N9, N10, N11 -------------------------------------------------------------------------

async function shiftRules(r: RuleEnv): Promise<void> {
  const { ctx, at, date } = r;
  const { settings } = await loadOrg(ctx);
  const days = await loadPersonDays(ctx, date);
  const states = await loadPunchStates(ctx, [date]);
  const work = days.filter((d) => d.kind === 'work' && d.segments.length > 0);

  for (const day of work) {
    const st = states.get(`${day.userId}|${date}`);
    const first = firstStart(day);
    const last = lastEnd(day);
    if (!first || !last) continue;

    // N4: shift start + 5 min, no punch (staff push; the Notifier also checks shift +/- 2 h).
    const n4 = first.startTs + 5 * MINUTE_MS;
    if (!st?.firstInTs && within(at, n4, 2 * HOUR_MS))
      if (
        await once(ctx, JOB, `${date}|checkin_reminder|${day.userId}`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'checkin_reminder',
            orgId: ctx.orgId ?? '',
            at,
            userId: day.userId,
            workDate: date,
            shiftStart: first.start,
          });
        })
      )
        r.bump('checkin_reminder');

    // N3: shift start + 30 min, no punch, not on leave or off (those days are not `work`).
    const n3 = first.startTs + 30 * MINUTE_MS;
    if (!st?.firstInTs && within(at, n3, 3 * HOUR_MS))
      if (
        await once(ctx, JOB, `${date}|not_in_yet|${day.userId}`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'not_in_yet',
            orgId: ctx.orgId ?? '',
            at,
            userId: day.userId,
            name: day.name,
            workDate: date,
            shiftStart: first.start,
          });
        })
      )
        r.bump('not_in_yet');

    // N9 and N10: still checked in 30 min after the shift ends, no duty running.
    const n9 = last.endTs + 30 * MINUTE_MS;
    if (st?.open && !dutyRunning(day, at) && within(at, n9, 3 * HOUR_MS)) {
      if (
        await once(ctx, JOB, `${date}|overtime_running|${day.userId}`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'overtime_running',
            orgId: ctx.orgId ?? '',
            at,
            userId: day.userId,
            name: day.name,
            workDate: date,
            shiftEnd: last.end,
          });
        })
      )
        r.bump('overtime_running');
      if (
        await once(ctx, JOB, `${date}|checkout_reminder|${day.userId}`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'checkout_reminder',
            orgId: ctx.orgId ?? '',
            at,
            userId: day.userId,
            workDate: date,
          });
        })
      )
        r.bump('checkout_reminder');
    }
  }

  // N11: closing time + 60 min, one batched alert listing everyone still checked in.
  const n11 = istToEpoch(date, settings.attendance.closingTime) + 60 * MINUTE_MS;
  if (within(at, n11, 3 * HOUR_MS)) {
    const people = days
      .filter((d) => states.get(`${d.userId}|${date}`)?.open && !dutyRunning(d, at))
      .map((d) => ({ userId: d.userId, name: d.name }));
    if (people.length > 0)
      if (
        await once(ctx, JOB, `${date}|missed_checkouts`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'missed_checkouts',
            orgId: ctx.orgId ?? '',
            at,
            workDate: date,
            people,
          });
        })
      )
        r.bump('missed_checkouts');
  }
}

// Auto-close (PRD 4.8) -----------------------------------------------------------------------------

/** End of the window a person was working in: the shift or duty that holds their open check-in. */
export function windowEndFor(day: PersonDay, openInTs: number): number | null {
  const windows = [...day.segments, ...day.duties];
  if (windows.length === 0) return null;
  const pad = 2 * HOUR_MS;
  const holding = windows.filter((w) => openInTs >= w.startTs - pad && openInTs <= w.endTs);
  const pool = holding.length > 0 ? holding : windows;
  return Math.max(...pool.map((w) => w.endTs));
}

async function autoClose(r: RuleEnv): Promise<void> {
  const { ctx, at } = r;
  const dates = [r.date, addDays(r.date, -1)];
  const states = await loadPunchStates(ctx, dates);
  for (const date of dates) {
    const days = await loadPersonDays(ctx, date);
    for (const day of days) {
      const st = states.get(`${day.userId}|${date}`);
      if (!st?.open || st.openInTs === null) continue;
      const windowEnd = windowEndFor(day, st.openInTs);
      if (windowEnd === null || at < windowEnd + 6 * HOUR_MS) continue;
      const outTs = Math.max(windowEnd, st.openInTs);
      const ran = await once(ctx, JOB, `${date}|auto_close|${day.userId}`, async () => {
        const id = ulid(at);
        await ctx.db.batch([
          ctx.db.insert('punches', {
            id,
            user_id: day.userId,
            kind: 'out',
            server_ts: at,
            effective_ts: outTs,
            work_date: date,
            source: 'auto',
            site_id: st.siteId,
            status: 'flagged',
            risk_score: 0,
            risk_reasons_json: '[]',
            idempotency_key: `auto-${date}-${day.userId}`,
            note: 'Closed automatically',
            created_at: at,
          }),
          ctx.services.audit.stmt(ctx, {
            category: 'change',
            action: 'punch.auto_close',
            entity: 'punch',
            entityId: id,
            after: { userId: day.userId, workDate: date, outTs },
            actorType: 'system',
            actorId: null,
          }),
        ]);
        try {
          await ctx.services.days.recompute(ctx, day.userId, date);
        } catch (e) {
          console.error(JSON.stringify({ msg: 'cron.recompute_failed', error: String(e) }));
        }
        await ctx.services.notifier.emit(ctx, {
          type: 'day_auto_closed',
          orgId: ctx.orgId ?? '',
          at,
          userId: day.userId,
          workDate: date,
          outTs,
        });
      });
      if (ran) r.bump('day_auto_closed');
    }
  }
}

// Held notifications --------------------------------------------------------------------------------

async function releaseHeldRule(r: RuleEnv): Promise<void> {
  const { ctx, at, date } = r;
  const { settings } = await loadOrg(ctx);
  const q = settings.notifications.quietHours;
  if (q.enabled && inQuietHours(at, q.start, q.end)) return;
  const held = await ctx.db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM notifications WHERE org_id = ?org AND push_status = 'held'",
  );
  if (!held?.n) return;
  const ran = await once(ctx, JOB, `${date}|release_held`, async () => {
    const people = await releaseHeld(ctx);
    return `people=${people}`;
  });
  if (ran) r.bump('held_released');
}

// N1 morning summary ---------------------------------------------------------------------------------

async function waitingOver48h(ctx: Ctx, at: number): Promise<number> {
  const cutoff = at - 48 * HOUR_MS;
  const row = await ctx.db.first<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM leave_requests WHERE org_id = ?org AND status = 'pending' AND created_at < ?)
     + (SELECT COUNT(*) FROM regularisations WHERE org_id = ?org AND status = 'pending' AND created_at < ?)
     + (SELECT COUNT(*) FROM punches WHERE org_id = ?org AND status IN ('flagged', 'pending') AND reviewed_at IS NULL AND created_at < ?)
     + (SELECT COUNT(*) FROM devices WHERE org_id = ?org AND status = 'pending' AND requested_at < ?)
     + (SELECT COUNT(*) FROM advances WHERE org_id = ?org AND status = 'requested' AND created_at < ?) AS n`,
    cutoff,
    cutoff,
    cutoff,
    cutoff,
    cutoff,
  );
  return row?.n ?? 0;
}

async function morningSummary(r: RuleEnv): Promise<void> {
  const { ctx, at, date } = r;
  const { settings } = await loadOrg(ctx);
  const days = await loadPersonDays(ctx, date);
  const work = days.filter((d) => d.kind === 'work' && d.segments.length > 0);
  if (work.length === 0) return;
  const earliest = Math.min(...work.map((d) => firstStart(d)?.startTs ?? Number.MAX_SAFE_INTEGER));
  const at0 = earliest + settings.notifications.morningSummaryOffsetMin * MINUTE_MS;
  if (!within(at, at0, 3 * HOUR_MS)) return;
  const states = await loadPunchStates(ctx, [date]);
  const graceMs = settings.attendance.graceMin * MINUTE_MS;
  let present = 0;
  let late = 0;
  let notInYet = 0;
  for (const d of days) {
    const st = states.get(`${d.userId}|${date}`);
    if (st?.firstInTs) {
      present += 1;
      const start = firstStart(d);
      if (start && st.firstInTs > start.startTs + graceMs) late += 1;
    } else if (d.kind === 'work') notInYet += 1;
  }
  const onLeave = days.filter((d) => d.kind === 'leave').length;
  const waiting = await waitingOver48h(ctx, at);
  const ran = await once(ctx, JOB, `${date}|morning_summary`, async () => {
    await ctx.services.notifier.emit(ctx, {
      type: 'morning_summary',
      orgId: ctx.orgId ?? '',
      at: at0,
      date,
      present,
      late,
      notInYet,
      onLeave,
      waitingOver48h: waiting,
    });
  });
  if (ran) r.bump('morning_summary');
}

// N24 payroll draft and N26 pay day ----------------------------------------------------------------------

async function payrollRules(r: RuleEnv): Promise<void> {
  const { ctx, at, date } = r;
  const day = Number(date.slice(8));
  const minutes = hhmmToMin(istTime(at));
  const month = prevMonth(date.slice(0, 7));

  if (day === 1 && minutes >= 9 * 60) {
    const existing = await ctx.db.first<{ id: string }>(
      'SELECT id FROM payroll_runs WHERE org_id = ?org AND month = ? LIMIT 1',
      month,
    );
    if (!existing) {
      const ran = await once(ctx, JOB, `${month}|payroll_draft`, async () => {
        const view = await ctx.services.payroll.draft(ctx, month);
        await ctx.services.notifier.emit(ctx, {
          type: 'payroll_draft_ready',
          orgId: ctx.orgId ?? '',
          at,
          runId: view.run.id,
          month,
          blockersCount: view.blockers.reduce((n, b) => n + b.count, 0),
        });
      });
      if (ran) r.bump('payroll_draft');
    }
  }

  const { settings } = await loadOrg(ctx);
  if (day === settings.pay.payDay && minutes >= 10 * 60) {
    const run = await ctx.db.first<{ id: string }>(
      `SELECT id FROM payroll_runs WHERE org_id = ?org AND month = ? AND status = 'finalised'
        ORDER BY revision DESC LIMIT 1`,
      month,
    );
    if (run) {
      const unpaid = await ctx.db.first<{ n: number }>(
        'SELECT COUNT(*) AS n FROM payslips WHERE org_id = ?org AND payroll_run_id = ? AND paid_on IS NULL',
        run.id,
      );
      if (unpaid?.n) {
        const ran = await once(ctx, JOB, `${month}|pay_day`, async () => {
          await ctx.services.notifier.emit(ctx, {
            type: 'salary_unpaid',
            orgId: ctx.orgId ?? '',
            at,
            runId: run.id,
            month,
            unpaidCount: unpaid.n,
          });
        });
        if (ran) r.bump('salary_unpaid');
      }
    }
  }
}

// N18 duty reminders ----------------------------------------------------------------------------------

async function dutyReminders(r: RuleEnv): Promise<void> {
  const { ctx, at } = r;
  const duties = await ctx.db.all<{
    id: string;
    work_date: string;
    start_ts: number;
    end_ts: number;
    place_name: string;
  }>(
    `SELECT id, work_date, start_ts, end_ts, place_name FROM offsite_duties
      WHERE org_id = ?org AND cancelled_at IS NULL AND start_ts > ? AND start_ts <= ?
        AND created_at <= start_ts - ?`,
    at,
    at + 12 * HOUR_MS,
    12 * HOUR_MS,
  );
  for (const d of duties) {
    const staff = await ctx.db.all<{ user_id: string }>(
      `SELECT user_id FROM offsite_duty_staff
        WHERE duty_id IN (SELECT id FROM offsite_duties WHERE org_id = ?org AND id = ?)`,
      d.id,
    );
    const userIds = staff.map((s) => s.user_id);
    if (userIds.length === 0) continue;
    const ran = await once(ctx, JOB, `${d.id}|duty_reminder`, async () => {
      await ctx.services.notifier.emit(ctx, {
        type: 'duty_assigned',
        orgId: ctx.orgId ?? '',
        at,
        userIds,
        dutyId: d.id,
        workDate: d.work_date,
        startTs: d.start_ts,
        endTs: d.end_ts,
        placeName: d.place_name,
        change: 'reminder',
      });
    });
    if (ran) r.bump('duty_reminder');
  }
}
