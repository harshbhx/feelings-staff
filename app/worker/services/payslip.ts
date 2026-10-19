/**
 * Payslips (PRD 4.14): the frozen snapshot written at finalise, its views for staff and owner, the
 * public verify lookup and the PDF download. A snapshot never changes; a reopened month gets new
 * payslips and the old ones stay, marked superseded. Owner: WP-5.
 */
import {
  type Endpoints,
  istDate,
  type OutputOf,
  type PayslipResult,
  type PayslipSummary,
  type PayslipVerify,
  type PayslipView,
} from '@fs/contracts';
import { json } from '../db';
import { fail } from '../lib/errors';
import { loadOrg } from '../lib/settings';
import { leaveBalances } from './leave';
import type { PersonCalc, RunRow } from './payroll-calc';
import type { Ctx } from './ports';

export interface PayslipSnapshot {
  result: PayslipResult;
  org: { name: string; address: string | null };
  person: {
    id: string;
    name: string;
    phone: string | null;
    employeeCode: string | null;
    designation: string | null;
    joinDate: string;
  };
  leaveBalances: PayslipView['leaveBalances'];
  generatedAt: number;
}

export interface PayslipRow {
  id: string;
  payroll_run_id: string;
  user_id: string;
  snapshot_json: string;
  gross_paise: number;
  deductions_paise: number;
  net_paise: number;
  rounding_paise: number;
  pdf_key: string | null;
  pdf_status: 'pending' | 'ready' | 'failed';
  verify_token: string;
  paid_on: string | null;
  pay_mode: 'cash' | 'upi' | 'bank' | null;
  pay_ref: string | null;
  paid_marked_by: string | null;
  created_at: number;
}

export const verifyUrl = (ctx: Ctx, token: string) => `${ctx.env.APP_ORIGIN}/v/${token}`;

export const snapshotOf = (row: PayslipRow): PayslipSnapshot =>
  json<PayslipSnapshot>(row.snapshot_json, {} as PayslipSnapshot);

/** Build the snapshot stored at finalise (and shown for a draft preview). */
export async function buildSnapshot(ctx: Ctx, p: PersonCalc): Promise<PayslipSnapshot> {
  const { org } = await loadOrg(ctx);
  const balances = await leaveBalances(ctx, p.profile.user_id);
  return {
    result: p.result,
    org: { name: org.name, address: org.address },
    person: {
      id: p.profile.user_id,
      name: p.profile.name,
      phone: p.profile.phone_e164,
      employeeCode: p.profile.employee_code,
      designation: p.profile.designation,
      joinDate: p.profile.join_date,
    },
    leaveBalances: balances.map((b) => ({ code: b.code, name: b.name, balance: b.balance })),
    generatedAt: ctx.now(),
  };
}

function baseView(snap: PayslipSnapshot, run: RunRow) {
  return {
    runId: run.id,
    revision: run.revision,
    month: run.month,
    org: snap.org,
    person: {
      id: snap.person.id,
      name: snap.person.name,
      employeeCode: snap.person.employeeCode,
      designation: snap.person.designation,
      joinDate: snap.person.joinDate,
    },
    result: snap.result,
    leaveBalances: snap.leaveBalances,
    generatedAt: snap.generatedAt,
  };
}

/** A finalised or superseded payslip as shown to staff and owner. */
export function payslipView(ctx: Ctx, row: PayslipRow, run: RunRow): PayslipView {
  return {
    ...baseView(snapshotOf(row), run),
    id: row.id,
    status: run.status === 'superseded' ? 'superseded' : 'final',
    paid: row.paid_on ? { on: row.paid_on, mode: row.pay_mode ?? 'cash', ref: row.pay_ref } : null,
    pdfStatus: row.pdf_status,
    pdfUrl: row.pdf_status === 'ready' ? `/api/v1/payslips/${row.id}/pdf` : null,
    verifyUrl: verifyUrl(ctx, row.verify_token),
  };
}

/** A draft payslip: computed live, no id, no PDF, nothing paid. */
export function draftPayslipView(snap: PayslipSnapshot, run: RunRow): PayslipView {
  return {
    ...baseView(snap, run),
    id: null,
    status: 'draft',
    paid: null,
    pdfStatus: 'pending',
    pdfUrl: null,
    verifyUrl: null,
  };
}

export async function payslipRow(ctx: Ctx, id: string): Promise<PayslipRow> {
  const row = await ctx.db.first<PayslipRow>(
    'SELECT * FROM payslips WHERE org_id = ?org AND id = ?',
    id,
  );
  return row ?? fail('NOT_FOUND', 'That payslip was not found.');
}

export async function runOfPayslip(ctx: Ctx, row: PayslipRow): Promise<RunRow> {
  const run = await ctx.db.first<RunRow>(
    'SELECT * FROM payroll_runs WHERE org_id = ?org AND id = ?',
    row.payroll_run_id,
  );
  return run ?? fail('NOT_FOUND', 'That payslip was not found.');
}

// ---- Staff ---------------------------------------------------------------------------------------

export async function staffMaySee(ctx: Ctx): Promise<boolean> {
  return (await loadOrg(ctx)).settings.pay.showPayslipsToStaff;
}

export async function myPayslips(ctx: Ctx): Promise<PayslipSummary[]> {
  const userId = ctx.user?.id ?? fail('UNAUTHENTICATED');
  if (!(await staffMaySee(ctx))) return [];
  const rows = await ctx.db.all<
    PayslipRow & { month: string; run_status: string; revision: number }
  >(
    `SELECT p.*, r.month, r.status AS run_status, r.revision FROM payslips p
       JOIN payroll_runs r ON r.id = p.payroll_run_id
      WHERE p.org_id = ?org AND p.user_id = ? AND r.status IN ('finalised', 'superseded')
      ORDER BY r.month DESC, r.revision DESC`,
    userId,
  );
  return rows.map((r) => ({
    id: r.id,
    month: r.month,
    netPaise: r.net_paise,
    revision: r.revision,
    superseded: r.run_status === 'superseded',
    paidOn: r.paid_on,
    payMode: r.pay_mode,
    pdfStatus: r.pdf_status,
  }));
}

export async function myPayslip(ctx: Ctx, id: string): Promise<PayslipView> {
  const userId = ctx.user?.id ?? fail('UNAUTHENTICATED');
  const row = await payslipRow(ctx, id);
  if (row.user_id !== userId || !(await staffMaySee(ctx)))
    fail('NOT_FOUND', 'That payslip was not found.');
  return payslipView(ctx, row, await runOfPayslip(ctx, row));
}

// ---- Public verify -------------------------------------------------------------------------------

const NOT_VALID: PayslipVerify = {
  valid: false,
  orgName: null,
  staffName: null,
  month: null,
  netPaise: null,
  revision: null,
  superseded: false,
};

/** "Priya Shah" -> "Priya S." (PRD 4.14: nothing else about the person is shown). */
export function firstNameAndInitial(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${parts[0]} ${last.charAt(0).toUpperCase()}.` : (parts[0] ?? '');
}

export async function verifyPayslip(
  ctx: Ctx,
  token: string,
): Promise<OutputOf<Endpoints['verifyPayslip']>> {
  const row = await ctx.sys.first<{
    org_name: string;
    name: string;
    month: string;
    net_paise: number;
    revision: number;
    status: string;
  }>(
    `SELECT o.name AS org_name, u.name, r.month, p.net_paise, r.revision, r.status
       FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
       JOIN users u ON u.id = p.user_id JOIN orgs o ON o.id = p.org_id
      WHERE p.verify_token = ?1`,
    token,
  );
  if (!row || row.status === 'draft') return NOT_VALID;
  return {
    valid: true,
    orgName: row.org_name,
    staffName: firstNameAndInitial(row.name),
    month: row.month,
    netPaise: row.net_paise,
    revision: row.revision,
    superseded: row.status === 'superseded',
  };
}

export const todayIst = (ctx: Ctx) => istDate(ctx.now());
