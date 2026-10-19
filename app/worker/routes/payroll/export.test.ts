/** WP-5 exports (PRD 4.16; O-15): every kind, CSV with a BOM and the stated columns, step-up, audit, expiry. */
import type { ExportView, PayrollRunView } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakePdf } from '../../test/fakes';
import { call, callJson, resetScenario, type Scenario, testEnv } from '../../test/helpers';
import { errorCode, setClock } from '../auth/test/kit';
import {
  addPerson,
  decideOvertime,
  fillMonth,
  login,
  monthIsOver,
  NOV_2,
  noHolidays,
  type Person,
  stepUpLogin,
  sundayRoster,
} from './test/kit';

let s: Scenario;
let owner: string;
let stepUp: string;
let priya: Person;

async function make(body: Record<string, unknown>, cookie = stepUp): Promise<ExportView> {
  const res = await callJson<{ exportId: string }>('POST', '/owner/exports', { cookie, body });
  expect(res.status).toBe(202);
  let view: ExportView | undefined;
  await vi.waitFor(async () => {
    view = (await callJson<ExportView>('GET', `/owner/exports/${res.body.exportId}`, { cookie }))
      .body;
    expect(view.status).toBe('ready');
  });
  return view as ExportView;
}

async function csv(kind: string, extra: Record<string, unknown> = {}): Promise<string[][]> {
  const view = await make({ kind, month: '2026-10', format: 'csv', ...extra });
  const res = await call('GET', `/owner/exports/${view.id}/file`, { cookie: owner });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  expect(res.headers.get('Content-Disposition')).toContain(`${kind.replace('_', '-')}-2026-10.csv`);
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return (await res.text())
    .trim()
    .split('\r\n')
    .map((line) => line.split(','));
}

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  owner = await login(s.ownerId);
  stepUp = await stepUpLogin(s.ownerId);
  setServiceOverridesForTests({ pdf: fakePdf() });
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
  await sundayRoster(priya.id, '2026-10');
  await fillMonth(priya.id, '2026-10', {
    script: {
      '2026-10-01': [],
      '2026-10-14': [
        ['in', '10:00'],
        ['out', '22:30'],
      ],
      '2026-10-07': [
        ['in', '10:25'],
        ['out', '20:00'],
      ],
    },
  });
  await decideOvertime(priya.id, '2026-10-14', 150, 150);
  await monthIsOver();
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('O-15.1 each export downloads in the stated formats', () => {
  it('O-15.1 the attendance register CSV has staff x days and totals', async () => {
    const rows = await csv('register');
    expect(rows[0]?.slice(0, 3)).toEqual(['Staff', 'Code', '01-10-2026']);
    expect(rows[0]?.slice(-7)).toEqual(['P', 'H', 'A', 'L', 'WO', 'HO', 'Paid days']);
    const mine = rows.find((r) => r[0] === 'Priya Solanki');
    expect(mine?.[2]).toBe('A');
    expect(mine?.[2 + 5]).toBe('WO');
    expect(rows).toHaveLength(2);
  });

  it('O-15.1 the salary register CSV carries rupees with two decimals', async () => {
    const rows = await csv('salary_register');
    expect(rows[0]).toEqual([
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
    ]);
    expect(rows[1]?.[0]).toBe('Priya Solanki');
    expect(rows[1]?.[2]).toBe('483.87');
    expect(rows[1]?.[4]).toBe('15000.00');
    expect(rows[1]?.[5]).toBe('268.82');
  });

  it('O-15.1 after finalise the salary register reads the frozen payslips, with the paid date', async () => {
    const run = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
      cookie: owner,
      body: { month: '2026-10' },
    });
    await call('POST', `/owner/payroll-runs/${run.body.run.id}/finalise`, {
      cookie: stepUp,
      body: { acceptDefaults: true },
    });
    const slip = await testEnv.DB.prepare('SELECT id FROM payslips').first<{ id: string }>();
    await call('POST', `/owner/payslips/${slip?.id}/mark-paid`, {
      cookie: owner,
      body: { paidOn: '2026-11-02', mode: 'upi' },
    });
    const rows = await csv('salary_register');
    expect(rows[1]?.slice(-2)).toEqual(['02-11-2026', 'upi']);
  });

  it('O-15.1 the punches log lists every punch in DD-MM-YYYY', async () => {
    const rows = await csv('punches');
    expect(rows[0]?.slice(0, 5)).toEqual(['Date', 'Time', 'Staff', 'Kind', 'Source']);
    expect(rows[1]?.[0]).toBe('02-10-2026');
    expect(rows[1]?.[1]).toBe('10:00');
  });

  it('O-15.1 late and early and overtime list the days that matter', async () => {
    const late = await csv('late_early');
    expect(late[0]?.[0]).toBe('Date');
    expect(late.find((r) => r[0] === '07-10-2026')?.[2]).toBe('25');
    const ot = await csv('overtime');
    const day = ot.find((r) => r[0] === '14-10-2026');
    expect(day?.slice(2, 7)).toEqual(['150', '0', '150', '0', 'approved']);
    expect(day?.[8]).toBe('268.82');
  });

  it('O-15.1 leave, advances, exceptions and the audit log export', async () => {
    await callJson('POST', '/owner/advances', {
      cookie: owner,
      body: {
        userId: priya.id,
        amountPaise: 300_000,
        givenOn: '2026-10-12',
        mode: 'cash',
        plan: 'full',
        firstMonth: '2026-10',
        askStaffAck: false,
      },
    });
    expect((await csv('leave'))[0]?.[0]).toBe('Record');
    const adv = await csv('advances');
    expect(adv[1]?.slice(0, 3)).toEqual(['Priya Solanki', '12-10-2026', '3000.00']);
    expect((await csv('exceptions'))[0]).toEqual(['Date', 'Time', 'Staff', 'Exception', 'Detail']);
    const audit = await csv('audit', { month: '2026-11' });
    expect(audit[0]?.[0]).toBe('Date');
  });

  it('O-15.1 both registers come as PDF through the PdfRenderer', async () => {
    for (const kind of ['register', 'salary_register']) {
      const view = await make({ kind, month: '2026-10', format: 'pdf' });
      const res = await call('GET', `/owner/exports/${view.id}/file`, { cookie: owner });
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(await res.text()).toBe('%PDF-1.4 fake');
    }
    const bad = await call('POST', '/owner/exports', {
      cookie: stepUp,
      body: { kind: 'punches', month: '2026-10', format: 'pdf' },
    });
    expect(bad.status).toBe(400);
  });

  it('O-15.1 a staff filter limits the rows', async () => {
    const asha = await addPerson(owner, { name: 'Asha Mehta' });
    await fillMonth(asha.id, '2026-10');
    expect((await csv('register')).length).toBe(3);
    expect((await csv('register', { userIds: [asha.id] })).map((r) => r[0])).toEqual([
      'Staff',
      'Asha Mehta',
    ]);
  });
});

describe('O-15.2 CSV escaping', () => {
  it('O-15.2 quotes commas and keeps Indian characters', async () => {
    await testEnv.DB.prepare("UPDATE users SET name = 'Pooja, કાજલ' WHERE id = ?1")
      .bind(priya.id)
      .run();
    const view = await make({ kind: 'register', month: '2026-10', format: 'csv' });
    const text = await (
      await call('GET', `/owner/exports/${view.id}/file`, { cookie: owner })
    ).text();
    expect(text).toContain('"Pooja, કાજલ"');
  });
});

describe('O-15.3 step-up, audit and expiry', () => {
  it('O-15.3 needs the step-up PIN and writes an export audit row for the create and the download', async () => {
    const refused = await call('POST', '/owner/exports', {
      cookie: owner,
      body: { kind: 'register', month: '2026-10', format: 'csv' },
    });
    expect((await errorCode(refused)).code).toBe('STEP_UP_REQUIRED');
    const view = await make({ kind: 'register', month: '2026-10', format: 'csv' });
    await call('GET', `/owner/exports/${view.id}/file`, { cookie: owner });
    const rows = await testEnv.DB.prepare(
      'SELECT action, category FROM audit_log WHERE entity_id = ?1 ORDER BY created_at, id',
    )
      .bind(view.id)
      .all<{ action: string; category: string }>();
    expect(rows.results).toEqual([
      { action: 'export.create', category: 'export' },
      { action: 'export.download', category: 'export' },
    ]);
  });

  it('O-15.3 expires after 7 days', async () => {
    const view = await make({ kind: 'register', month: '2026-10', format: 'csv' });
    expect(view.expiresAt - view.createdAt).toBe(7 * 24 * 3_600_000);
    expect(
      (await callJson<ExportView[]>('GET', '/owner/exports', { cookie: owner })).body,
    ).toHaveLength(1);
    await setClock(NOV_2 + 8 * 24 * 3_600_000);
    expect(
      (await callJson<ExportView[]>('GET', '/owner/exports', { cookie: owner })).body,
    ).toHaveLength(0);
    expect((await call('GET', `/owner/exports/${view.id}/file`, { cookie: owner })).status).toBe(
      404,
    );
  });

  it('O-15.3 allows 10 exports an hour, and the audit log is owner only', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', '/owner/exports', {
        cookie: stepUp,
        body: { kind: 'register', month: '2026-10', format: 'csv' },
      });
      expect(res.status).toBe(202);
    }
    const over = await call('POST', '/owner/exports', {
      cookie: stepUp,
      body: { kind: 'register', month: '2026-10', format: 'csv' },
    });
    expect(over.status).toBe(429);
  });

  it('O-15.3 a manager needs the exports permission and cannot export the audit log', async () => {
    const manager = await addPerson(owner, { name: 'Mina Joshi' });
    await testEnv.DB.prepare("UPDATE users SET role = 'manager' WHERE id = ?1")
      .bind(manager.id)
      .run();
    const plain = await login(manager.id, { stepUp: true });
    expect((await call('GET', '/owner/exports', { cookie: plain })).status).toBe(403);
    await testEnv.DB.prepare('UPDATE users SET permissions_json = \'["exports"]\' WHERE id = ?1')
      .bind(manager.id)
      .run();
    expect((await call('GET', '/owner/exports', { cookie: plain })).status).toBe(200);
    const audit = await call('POST', '/owner/exports', {
      cookie: plain,
      body: { kind: 'audit', month: '2026-10', format: 'csv' },
    });
    expect(audit.status).toBe(403);
  });
});
