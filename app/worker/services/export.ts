/**
 * Exports (PRD 4.16): the nine reports in CSV (UTF-8 with a BOM, `DD-MM-YYYY`, rupees with two
 * decimals) and the two registers in PDF. Created with step-up, generated in `waitUntil`, stored at
 * `exports/<org>/<id>.<ext>` for 7 days and served only through the session-checked file route.
 * Every create and download writes an `export` audit row. Owner: WP-5.
 */
import {
  type DayTag,
  type Endpoints,
  type ExportKind,
  type ExportView,
  istTime,
  monthDates,
  type OutputOf,
  type ParsedInputOf,
  type PayslipLineCode,
  type PayslipResult,
} from '@fs/contracts';
import type { RegisterData, SalaryRegisterData } from '@fs/templates';
import { json } from '../db';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { ulid } from '../lib/ulid';
import { jsonList } from './day';
import { calcRun, monthEnd, monthStart, type PersonCalc } from './payroll-calc';
import { type PayslipRow, snapshotOf } from './payslip';
import type { Ctx } from './ports';

const WEEK_MS = 7 * 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const LIMIT_PER_HOUR = 10;
const BOM = '﻿';

export interface ExportRow {
  id: string;
  kind: ExportKind;
  format: 'csv' | 'pdf';
  params_json: string;
  status: 'queued' | 'ready' | 'failed';
  r2_key: string | null;
  created_by: string;
  created_at: number;
  expires_at: number;
}

interface Params {
  month: string;
  userIds?: string[];
}

// ---- CSV helpers ---------------------------------------------------------------------------------

const dmy = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
const rupees = (paise: number) => (paise / 100).toFixed(2);
const istDay = (ts: number) => new Date(ts + 19_800_000).toISOString().slice(0, 10);

type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

const sumLines = (r: PayslipResult, ...codes: PayslipLineCode[]) =>
  Math.abs(r.lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amountPaise, 0));

// ---- Data ----------------------------------------------------------------------------------------

async function monthPeople(ctx: Ctx, p: Params): Promise<PersonCalc[]> {
  const { settings } = await loadOrg(ctx);
  const calc = await calcRun(ctx, { month: p.month, settings, overrides: [], runId: null });
  return p.userIds
    ? calc.people.filter((x) => p.userIds?.includes(x.profile.user_id))
    : calc.people;
}

const DAY_CODE: Record<string, string> = { OPEN: 'P', NE: '-' };

function registerData(
  people: PersonCalc[],
  month: string,
  org: RegisterData['org'],
  at: number,
): RegisterData {
  return {
    org,
    month,
    dates: monthDates(month),
    generatedAt: at,
    rows: people.map((p) => {
      const byDate = new Map(p.days.map((c) => [c.date, c]));
      const cells = monthDates(month).map((d) => {
        const c = byDate.get(d);
        if (!c) return '-';
        const tags = c.tags as DayTag[];
        if (c.result.status === 'P' && tags.includes('offsite')) return 'OD';
        return DAY_CODE[c.result.status] ?? c.result.status;
      });
      const count = (code: string) => cells.filter((x) => x === code).length;
      return {
        name: p.profile.name,
        code: p.profile.employee_code,
        designation: p.profile.designation,
        cells,
        totals: {
          P: count('P') + count('OD'),
          H: count('H'),
          A: count('A'),
          L: count('L'),
          WO: count('WO'),
          HO: count('HO'),
          paid: p.result.counts.paidDays,
        },
      };
    }),
  };
}

function salaryRow(
  name: string,
  code: string | null,
  r: PayslipResult,
  paid: { on: string; mode: string } | null,
) {
  return {
    name,
    code,
    ratePaise: r.dailyRatePaise,
    paidDays: r.counts.paidDays,
    salaryPaise: sumLines(r, 'salary', 'basic'),
    overtimePaise: sumLines(r, 'overtime'),
    otherEarningsPaise: sumLines(
      r,
      'offday_extra',
      'incentive',
      'bonus',
      'other_earning',
      'arrears',
    ),
    lopPaise: sumLines(r, 'lop'),
    lateEarlyPaise: sumLines(r, 'undertime'),
    advancePaise: sumLines(r, 'advance_recovery'),
    otherDeductionsPaise: sumLines(r, 'fine', 'damage', 'other_deduction', 'recovery'),
    grossPaise: r.grossPaise,
    deductionsPaise: r.deductionsPaise,
    netPaise: r.netPaise,
    paid,
  };
}

/** The frozen payslips of the latest final run of the month, else the live draft numbers. */
async function salaryRegisterData(
  ctx: Ctx,
  p: Params,
  org: RegisterData['org'],
): Promise<SalaryRegisterData> {
  const run = await ctx.db.first<{ id: string; revision: number }>(
    "SELECT id, revision FROM payroll_runs WHERE org_id = ?org AND month = ? AND status = 'finalised' ORDER BY revision DESC LIMIT 1",
    p.month,
  );
  const want = (id: string) => !p.userIds || p.userIds.includes(id);
  if (run) {
    const slips = await ctx.db.all<PayslipRow>(
      'SELECT * FROM payslips WHERE org_id = ?org AND payroll_run_id = ? ORDER BY created_at, id',
      run.id,
    );
    return {
      org,
      month: p.month,
      revision: run.revision,
      generatedAt: ctx.now(),
      rows: slips
        .filter((s) => want(s.user_id))
        .map((s) => {
          const snap = snapshotOf(s);
          return salaryRow(
            snap.person.name,
            snap.person.employeeCode,
            snap.result,
            s.paid_on ? { on: s.paid_on, mode: s.pay_mode ?? 'cash' } : null,
          );
        }),
    };
  }
  const people = await monthPeople(ctx, p);
  return {
    org,
    month: p.month,
    revision: 0,
    generatedAt: ctx.now(),
    rows: people.map((x) => salaryRow(x.profile.name, x.profile.employee_code, x.result, null)),
  };
}

type Table = { header: string[]; rows: Cell[][] };

async function table(ctx: Ctx, kind: ExportKind, p: Params): Promise<Table> {
  const from = monthStart(p.month);
  const to = monthEnd(p.month);
  const ids = p.userIds ? jsonList(p.userIds) : null;
  const filter = (col: string) => (ids ? `AND ${col} IN (SELECT value FROM json_each(?))` : '');
  const bind = (...rest: (string | number)[]) => (ids ? [ids, ...rest] : rest);

  switch (kind) {
    case 'punches': {
      const rows = await ctx.db.all<{
        work_date: string;
        effective_ts: number;
        name: string;
        kind: string;
        source: string;
        site: string | null;
        fence_result: string | null;
        distance_bucket: string | null;
        risk_score: number;
        risk_reasons_json: string;
        status: string;
        reviewer: string | null;
        reviewed_at: number | null;
      }>(
        `SELECT p.work_date, p.effective_ts, u.name, p.kind, p.source, s.name AS site, p.fence_result, p.distance_bucket,
                p.risk_score, p.risk_reasons_json, p.status, r.name AS reviewer, p.reviewed_at
           FROM punches p JOIN users u ON u.id = p.user_id LEFT JOIN sites s ON s.id = p.site_id
           LEFT JOIN users r ON r.id = p.reviewed_by
          WHERE p.org_id = ?org AND p.work_date BETWEEN ? AND ? ${filter('p.user_id')}
          ORDER BY p.work_date, p.effective_ts, p.id`,
        from,
        to,
        ...bind(),
      );
      return {
        header: [
          'Date',
          'Time',
          'Staff',
          'Kind',
          'Source',
          'Site',
          'Fence result',
          'Distance',
          'Risk score',
          'Risk reasons',
          'Status',
          'Reviewed by',
          'Reviewed on',
        ],
        rows: rows.map((r) => [
          dmy(r.work_date),
          istTime(r.effective_ts),
          r.name,
          r.kind,
          r.source,
          r.site,
          r.fence_result,
          r.distance_bucket,
          r.risk_score,
          json<string[]>(r.risk_reasons_json, []).join('; '),
          r.status,
          r.reviewer,
          r.reviewed_at ? dmy(istDay(r.reviewed_at)) : '',
        ]),
      };
    }
    case 'late_early': {
      const people = await monthPeople(ctx, p);
      const rows: Cell[][] = [];
      for (const x of people) {
        for (const c of x.days) {
          const r = c.result;
          if (r.lateMin + r.earlyMin === 0) continue;
          const deduction = Math.round(
            (x.result.dailyRatePaise * r.undertimeMin) / Math.max(1, r.scheduledMin),
          );
          rows.push([
            dmy(c.date),
            x.profile.name,
            r.lateMin,
            r.earlyMin,
            r.lateBillableMin,
            r.earlyBillableMin,
            r.undertimeMin,
            rupees(deduction),
          ]);
        }
      }
      return {
        header: [
          'Date',
          'Staff',
          'Late min',
          'Early min',
          'Late billable min',
          'Early billable min',
          'Short min',
          'Deduction (Rs)',
        ],
        rows,
      };
    }
    case 'overtime': {
      const people = await monthPeople(ctx, p);
      const rows: Cell[][] = [];
      for (const x of people) {
        const rate = x.person.otRate;
        for (const c of x.days) {
          const r = c.result;
          if (r.otCandidateMin + r.otPreapprovedMin === 0) continue;
          const decided = c.otApprovedMin - r.otPreapprovedMin;
          const rejected = Math.max(0, r.otCandidateMin - decided);
          const hourly =
            rate.mode === 'flat'
              ? rate.paisePerHour
              : (x.result.dailyRatePaise *
                  (rate.mode === 'multiplier' ? rate.multiplier : 0) *
                  60) /
                Math.max(1, x.person.stdMin);
          const pays = rate.mode === 'flat' || rate.mode === 'multiplier';
          rows.push([
            dmy(c.date),
            x.profile.name,
            r.otCandidateMin,
            r.otPreapprovedMin,
            c.otApprovedMin,
            rejected,
            c.otStatus,
            pays ? rupees(Math.round(hourly)) : '',
            pays ? rupees(Math.round((hourly * c.otApprovedMin) / 60)) : '',
          ]);
        }
      }
      return {
        header: [
          'Date',
          'Staff',
          'Candidate min',
          'Pre-approved min',
          'Approved min',
          'Rejected min',
          'Status',
          'Rate per hour (Rs)',
          'Amount (Rs)',
        ],
        rows,
      };
    }
    case 'leave': {
      const requests = await ctx.db.all<{
        name: string;
        code: string;
        from_date: string;
        to_date: string;
        days_paid: number;
        days_unpaid: number;
        status: string;
        reason: string | null;
        decided_at: number | null;
      }>(
        `SELECT u.name, t.code, r.from_date, r.to_date, r.days_paid, r.days_unpaid, r.status, r.reason, r.decided_at
           FROM leave_requests r JOIN users u ON u.id = r.user_id JOIN leave_types t ON t.id = r.leave_type_id
          WHERE r.org_id = ?org AND r.from_date <= ? AND r.to_date >= ? ${filter('r.user_id')}
          ORDER BY r.from_date, u.name`,
        to,
        from,
        ...bind(),
      );
      const ledger = await ctx.db.all<{
        name: string;
        code: string;
        entry_date: string;
        kind: string;
        days: number;
        note: string | null;
      }>(
        `SELECT u.name, t.code, l.entry_date, l.kind, l.days, l.note FROM leave_ledger l
           JOIN users u ON u.id = l.user_id JOIN leave_types t ON t.id = l.leave_type_id
          WHERE l.org_id = ?org AND l.entry_date BETWEEN ? AND ? ${filter('l.user_id')}
          ORDER BY l.entry_date, u.name`,
        from,
        to,
        ...bind(),
      );
      return {
        header: [
          'Record',
          'Staff',
          'Type',
          'From',
          'To',
          'Days paid',
          'Days unpaid',
          'Status',
          'Note',
        ],
        rows: [
          ...requests.map((r): Cell[] => [
            'Request',
            r.name,
            r.code,
            dmy(r.from_date),
            dmy(r.to_date),
            r.days_paid,
            r.days_unpaid,
            r.status,
            r.reason,
          ]),
          ...ledger.map((l): Cell[] => [
            'Ledger',
            l.name,
            l.code,
            dmy(l.entry_date),
            '',
            l.days,
            '',
            l.kind,
            l.note,
          ]),
        ],
      };
    }
    case 'advances': {
      const rows = await ctx.db.all<{
        name: string;
        amount_paise: number;
        given_on: string | null;
        mode: string | null;
        plan: string;
        status: string;
        month: string | null;
        scheduled: number | null;
        recovered: number | null;
        carried: number | null;
        total_recovered: number;
      }>(
        `SELECT u.name, a.amount_paise, a.given_on, a.mode, a.plan, a.status, r.month, r.scheduled_paise AS scheduled,
                r.recovered_paise AS recovered, r.carried_paise AS carried,
                COALESCE((SELECT SUM(recovered_paise) FROM advance_recoveries x WHERE x.advance_id = a.id), 0) AS total_recovered
           FROM advances a JOIN users u ON u.id = a.user_id
           LEFT JOIN advance_recoveries r ON r.advance_id = a.id AND r.month = ?
          WHERE a.org_id = ?org AND a.status IN ('active', 'closed') ${filter('a.user_id')}
            AND (a.given_on BETWEEN ? AND ? OR r.month IS NOT NULL OR a.status = 'active')
          ORDER BY a.given_on, u.name`,
        p.month,
        ...bind(from, to),
      );
      return {
        header: [
          'Staff',
          'Given on',
          'Amount (Rs)',
          'Mode',
          'Plan',
          'Month',
          'Scheduled (Rs)',
          'Recovered (Rs)',
          'Carried (Rs)',
          'Balance (Rs)',
          'Status',
        ],
        rows: rows.map((r) => [
          r.name,
          r.given_on ? dmy(r.given_on) : '',
          rupees(r.amount_paise),
          r.mode,
          r.plan,
          r.month ?? '',
          r.scheduled === null ? '' : rupees(r.scheduled),
          r.recovered === null ? '' : rupees(r.recovered),
          r.carried === null ? '' : rupees(r.carried),
          rupees(r.amount_paise - r.total_recovered),
          r.status,
        ]),
      };
    }
    case 'exceptions': {
      const flagged = await ctx.db.all<{
        work_date: string;
        effective_ts: number;
        name: string;
        kind: string;
        status: string;
        reasons: string;
        source: string;
      }>(
        `SELECT p.work_date, p.effective_ts, u.name, p.kind, p.status, p.risk_reasons_json AS reasons, p.source
           FROM punches p JOIN users u ON u.id = p.user_id
          WHERE p.org_id = ?org AND p.work_date BETWEEN ? AND ? ${filter('p.user_id')}
            AND (p.status IN ('flagged', 'pending', 'rejected') OR p.source = 'auto')
          ORDER BY p.work_date, p.effective_ts`,
        from,
        to,
        ...bind(),
      );
      const overrides = await ctx.db.all<{
        work_date: string;
        name: string;
        override_json: string;
      }>(
        `SELECT d.work_date, u.name, d.override_json FROM attendance_days d JOIN users u ON u.id = d.user_id
          WHERE d.org_id = ?org AND d.work_date BETWEEN ? AND ? AND d.override_json IS NOT NULL ${filter('d.user_id')}
          ORDER BY d.work_date`,
        from,
        to,
        ...bind(),
      );
      const devices = await ctx.db.all<{ created_at: number; name: string | null; action: string }>(
        `SELECT a.created_at, u.name, a.action FROM audit_log a LEFT JOIN users u ON u.id = a.entity_id
          WHERE a.org_id = ?org AND a.action LIKE 'device.%' AND a.created_at >= ? AND a.created_at < ?
          ORDER BY a.created_at`,
        Date.parse(`${from}T00:00:00+05:30`),
        Date.parse(`${to}T00:00:00+05:30`) + 24 * HOUR_MS,
      );
      return {
        header: ['Date', 'Time', 'Staff', 'Exception', 'Detail'],
        rows: [
          ...flagged.map((f): Cell[] => [
            dmy(f.work_date),
            istTime(f.effective_ts),
            f.name,
            f.source === 'auto' ? 'Auto-closed' : `Punch ${f.status}`,
            `${f.kind}: ${json<string[]>(f.reasons, []).join('; ')}`,
          ]),
          ...overrides.map((o): Cell[] => [
            dmy(o.work_date),
            '',
            o.name,
            'Day override',
            json<{ status?: string; reason?: string }>(o.override_json, {}).reason ?? '',
          ]),
          ...devices.map((d): Cell[] => [
            dmy(istDay(d.created_at)),
            istTime(d.created_at),
            d.name ?? '',
            'Device change',
            d.action,
          ]),
        ],
      };
    }
    case 'audit': {
      const rows = await ctx.db.all<{
        created_at: number;
        category: string;
        actor: string | null;
        action: string;
        entity: string;
        entity_id: string | null;
        reason: string | null;
      }>(
        `SELECT a.created_at, a.category, u.name AS actor, a.action, a.entity, a.entity_id, a.reason
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.org_id = ?org AND a.created_at >= ? AND a.created_at < ? ORDER BY a.created_at, a.id`,
        Date.parse(`${from}T00:00:00+05:30`),
        Date.parse(`${to}T00:00:00+05:30`) + 24 * HOUR_MS,
      );
      return {
        header: ['Date', 'Time', 'Category', 'Who', 'Action', 'Entity', 'Entity id', 'Reason'],
        rows: rows.map((r) => [
          dmy(istDay(r.created_at)),
          istTime(r.created_at),
          r.category,
          r.actor ?? 'system',
          r.action,
          r.entity,
          r.entity_id,
          r.reason,
        ]),
      };
    }
    case 'register':
    case 'salary_register': {
      const org = (await loadOrg(ctx)).org;
      const head = { name: org.name, address: org.address };
      if (kind === 'register') {
        const data = registerData(await monthPeople(ctx, p), p.month, head, ctx.now());
        return {
          header: [
            'Staff',
            'Code',
            ...data.dates.map((d) => dmy(d)),
            'P',
            'H',
            'A',
            'L',
            'WO',
            'HO',
            'Paid days',
          ],
          rows: data.rows.map((r) => [
            r.name,
            r.code,
            ...r.cells,
            r.totals.P,
            r.totals.H,
            r.totals.A,
            r.totals.L,
            r.totals.WO,
            r.totals.HO,
            r.totals.paid,
          ]),
        };
      }
      const data = await salaryRegisterData(ctx, p, head);
      return {
        header: [
          'Staff',
          'Code',
          'Rate per day (Rs)',
          'Paid days',
          'Salary (Rs)',
          'Overtime (Rs)',
          'Other earnings (Rs)',
          'Gross (Rs)',
          'Loss of pay (Rs)',
          'Late and early (Rs)',
          'Advance (Rs)',
          'Other deductions (Rs)',
          'Net (Rs)',
          'Paid on',
          'Mode',
        ],
        rows: data.rows.map((r) => [
          r.name,
          r.code,
          rupees(r.ratePaise),
          r.paidDays,
          rupees(r.salaryPaise),
          rupees(r.overtimePaise),
          rupees(r.otherEarningsPaise),
          rupees(r.grossPaise),
          rupees(r.lopPaise),
          rupees(r.lateEarlyPaise),
          rupees(r.advancePaise),
          rupees(r.otherDeductionsPaise),
          rupees(r.netPaise),
          r.paid ? dmy(r.paid.on) : '',
          r.paid?.mode ?? '',
        ]),
      };
    }
  }
}

// ---- Service -------------------------------------------------------------------------------------

export const fileNameOf = (e: Pick<ExportRow, 'kind' | 'format'>, month: string) =>
  `${e.kind.replace('_', '-')}-${month}.${e.format}`;

const paramsOf = (e: ExportRow) => json<Params>(e.params_json, { month: '' });

function view(e: ExportRow): ExportView {
  const p = paramsOf(e);
  return {
    id: e.id,
    kind: e.kind,
    format: e.format,
    month: p.month,
    status: e.status,
    createdAt: e.created_at,
    expiresAt: e.expires_at,
    fileUrl: e.status === 'ready' ? `/api/v1/owner/exports/${e.id}/file` : null,
    fileName: fileNameOf(e, p.month),
  };
}

async function load(ctx: Ctx, id: string): Promise<ExportRow> {
  const row = await ctx.db.first<ExportRow>(
    'SELECT * FROM exports WHERE org_id = ?org AND id = ?',
    id,
  );
  if (!row || row.expires_at <= ctx.now()) fail('NOT_FOUND', 'That export was not found.');
  return row;
}

export async function listExports(ctx: Ctx): Promise<ExportView[]> {
  const rows = await ctx.db.all<ExportRow>(
    'SELECT * FROM exports WHERE org_id = ?org AND expires_at > ? ORDER BY created_at DESC, id',
    ctx.now(),
  );
  return rows.map(view);
}

export async function getExport(ctx: Ctx, id: string): Promise<ExportView> {
  return view(await load(ctx, id));
}

type CreateBody = ParsedInputOf<Endpoints['ownerExportCreate']>['body'];

export async function createExport(
  ctx: Ctx,
  body: CreateBody,
): Promise<OutputOf<Endpoints['ownerExportCreate']>> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  if (body.format === 'pdf' && body.kind !== 'register' && body.kind !== 'salary_register') {
    fail('VALIDATION', 'Only the registers come as PDF.', { field: 'format' });
  }
  if (body.kind === 'audit' && user.role !== 'owner')
    fail('FORBIDDEN', 'Only the owner can export the audit log.');
  const recent = await ctx.db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM exports WHERE org_id = ?org AND created_at > ?',
    ctx.now() - HOUR_MS,
  );
  if ((recent?.n ?? 0) >= LIMIT_PER_HOUR) {
    fail('RATE_LIMITED', 'That is 10 exports in the last hour. Try again a little later.');
  }
  const id = ulid(ctx.now());
  const params: Params = { month: body.month, ...(body.userIds ? { userIds: body.userIds } : {}) };
  await ctx.db.batch([
    ctx.db.insert('exports', {
      id,
      kind: body.kind,
      format: body.format,
      params_json: JSON.stringify(params),
      status: 'queued',
      created_by: user.id,
      created_at: ctx.now(),
      expires_at: ctx.now() + WEEK_MS,
    }),
    ctx.services.audit.stmt(ctx, {
      category: 'export',
      action: 'export.create',
      entity: 'export',
      entityId: id,
      after: { kind: body.kind, format: body.format, ...params },
    }),
  ]);
  ctx.waitUntil(runExport(ctx, id));
  return { exportId: id };
}

/** Build the file, store it in R2 and mark the export ready (or failed). Never throws. */
export async function runExport(ctx: Ctx, id: string): Promise<void> {
  const e = await ctx.db.first<ExportRow>(
    'SELECT * FROM exports WHERE org_id = ?org AND id = ?',
    id,
  );
  if (e?.status !== 'queued') return;
  const p = paramsOf(e);
  try {
    let bytes: ArrayBuffer | Uint8Array;
    if (e.format === 'csv') {
      const t = await table(ctx, e.kind, p);
      bytes = new TextEncoder().encode(toCsv(t.header, t.rows));
    } else {
      const org = (await loadOrg(ctx)).org;
      const head = { name: org.name, address: org.address };
      bytes =
        e.kind === 'register'
          ? await ctx.services.pdf.render(
              'register',
              registerData(await monthPeople(ctx, p), p.month, head, ctx.now()),
              'en',
            )
          : await ctx.services.pdf.render(
              'salary_register',
              await salaryRegisterData(ctx, p, head),
              'en',
            );
    }
    const key = `exports/${ctx.orgId}/${id}.${e.format}`;
    await ctx.env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: e.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      },
      customMetadata: { 'x-org-id': ctx.orgId ?? '' },
    });
    await ctx.db.update('exports', { status: 'ready', r2_key: key }, 'id = ?', id).run();
  } catch (err) {
    console.error(JSON.stringify({ msg: 'export.failed', exportId: id, error: String(err) }));
    await ctx.db.update('exports', { status: 'failed' }, 'id = ?', id).run();
  }
}

export async function exportFile(ctx: Ctx, id: string): Promise<Response> {
  const e = await load(ctx, id);
  if (e.status !== 'ready' || !e.r2_key) {
    return new Response(JSON.stringify({ status: e.status }), {
      status: e.status === 'failed' ? 503 : 202,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '3' },
    });
  }
  const object = await ctx.env.MEDIA.get(e.r2_key);
  if (!object) fail('NOT_FOUND', 'That file has expired.');
  await ctx.services.audit.log(ctx, {
    category: 'export',
    action: 'export.download',
    entity: 'export',
    entityId: id,
  });
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': e.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileNameOf(e, paramsOf(e).month)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
