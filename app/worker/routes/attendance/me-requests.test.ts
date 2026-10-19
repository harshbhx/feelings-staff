/**
 * WP-4 staff views and requests over the real API (PRD 4.9, 4.11, 5.1, 10.6; S-11, S-12, S-13,
 * S-16): month and day views, leave, fixes and My data.
 */
import type {
  DayDetail,
  LeavePreview,
  LeaveRequestView,
  MonthView,
  MyData,
  RegularisationView,
} from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import { callJson, testEnv } from '../../test/helpers';
import { DAY, ist, setSettings } from '../../test/notify-kit';
import { setClock } from '../auth/test/kit';
import { expectStatus, fixAt, type Harness, harness, jpeg, punch, rows } from './test/punch-kit';

type Err = { error: { code: string; details?: Record<string, unknown> } };

let h: Harness;
let notifier: ReturnType<typeof fakeNotifier>;

beforeEach(async () => {
  h = await harness({ joinDate: '2025-01-01' });
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

const staff = <T>(method: string, path: string, body?: unknown) =>
  callJson<T>(method, path, { cookie: h.phone.cookie, ...(body === undefined ? {} : { body }) });
const owner = <T>(method: string, path: string, body?: unknown) =>
  callJson<T>(method, path, { cookie: h.owner, ...(body === undefined ? {} : { body }) });

async function workedDay() {
  await punch(h);
  await h.at(ist('18:05'));
  await punch(h, { kind: 'out', fix: fixAt(0.00002) });
}

describe('S-11 My month and day', () => {
  it('S-11.1 the month calendar statuses match attendance_days', async () => {
    await workedDay();
    const month = await staff<MonthView>('GET', '/me/days?month=2026-10');
    expect(month.status).toBe(200);
    const today = month.body.days.find((d) => d.workDate === DAY);
    const stored = await rows<{ status: string; worked_min: number }>(
      'SELECT status, worked_min FROM attendance_days WHERE user_id = ?1 AND work_date = ?2',
      h.phone.id,
      DAY,
    );
    expect(today?.status).toBe(stored[0]?.status);
    expect(today?.workedMin).toBe(stored[0]?.worked_min);
    expect(today?.status).toBe('P');
  });

  it('S-11.2 day detail lists punches with tags and the pay effect', async () => {
    await h.at(ist('10:30'));
    await punch(h);
    await h.at(ist('18:05'));
    await punch(h, { kind: 'out', fix: fixAt(0.00002) });
    const res = await staff<DayDetail>('GET', `/me/days/${DAY}`);
    expect(res.status).toBe(200);
    expect(res.body.punches.map((p) => p.kind)).toEqual(['in', 'out']);
    expect(res.body.day.lateMin).toBe(30);
    expect(res.body.lines.some((l) => l.code === 'late')).toBe(true);
  });

  it('S-11.3 totals equal the day results', async () => {
    await workedDay();
    const month = await staff<MonthView>('GET', '/me/days?month=2026-10');
    const sum = month.body.days.reduce((s, d) => s + d.workedMin, 0);
    expect(month.body.totals.workedMin).toBe(sum);
    expect(month.body.totals.present).toBe(1);
  });
});

describe('S-12 Leave', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    typeCode: 'CL',
    fromDate: '2026-10-28',
    toDate: '2026-10-29',
    acceptUnpaidSplit: true,
    reason: 'Cousin wedding',
    ...over,
  });

  it('S-12.1 balances are listed per type', async () => {
    const res = await staff<{ balances: { code: string }[] }>('GET', '/me/leave');
    expect(res.status).toBe(200);
    expect(res.body.balances.map((b) => b.code)).toEqual(expect.arrayContaining(['CL']));
  });

  it('S-12.2 the preview counts days and warns before sending', async () => {
    const res = await staff<LeavePreview>('POST', '/leave-requests/preview', body());
    expect(res.status).toBe(200);
    expect(res.body.countedDays).toBe(2);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('S-12.3 overlapping requests are blocked', async () => {
    const first = await staff<LeaveRequestView>('POST', '/leave-requests', body());
    expectStatus(first, 201);
    const second = await staff<Err>(
      'POST',
      '/leave-requests',
      body({ fromDate: '2026-10-29', toDate: '2026-10-30' }),
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('S-12.4 approval writes the ledger and the days; rejection keeps a reason', async () => {
    const made = await staff<LeaveRequestView>('POST', '/leave-requests', body());
    expectStatus(made, 201);
    const approved = await owner<LeaveRequestView>(
      'POST',
      `/owner/leave-requests/${made.body.id}/decide`,
      {
        decision: 'approve',
      },
    );
    expectStatus(approved, 200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.daysPaid + approved.body.daysUnpaid).toBe(2);
    const day = await staff<DayDetail>('GET', '/me/days/2026-10-28');
    expect(['L', 'LOP']).toContain(day.body.day.status);
    expect(notifier.events.map((e) => e.type)).toContain('leave_decided');

    const other = await staff<LeaveRequestView>(
      'POST',
      '/leave-requests',
      body({ fromDate: '2026-11-02', toDate: '2026-11-02' }),
    );
    const noReason = await owner<Err>('POST', `/owner/leave-requests/${other.body.id}/decide`, {
      decision: 'reject',
    });
    expect(noReason.status).toBe(400);
    const rejected = await owner<LeaveRequestView>(
      'POST',
      `/owner/leave-requests/${other.body.id}/decide`,
      {
        decision: 'reject',
        note: 'Busy that day',
      },
    );
    expect(rejected.body).toMatchObject({ status: 'rejected', decisionNote: 'Busy that day' });
  });

  it('S-12.4 a pending request can be cancelled by the person', async () => {
    const made = await staff<LeaveRequestView>('POST', '/leave-requests', body());
    expectStatus(made, 201);
    const res = await staff<LeaveRequestView>('POST', `/leave-requests/${made.body.id}/cancel`);
    expectStatus(res, 200);
    expect(res.body.status).toBe('cancelled');
  });

  it('S-12.5 requests in a finalised month are blocked', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO payroll_runs (id, org_id, month, revision, status, settings_snapshot_json, engine_version, created_by, created_at)
       VALUES ('run-nov', ?1, '2026-11', 1, 'finalised', '{}', 'test', ?2, 1)`,
    )
      .bind(h.salon.orgId, h.salon.ownerId)
      .run();
    const res = await staff<Err>(
      'POST',
      '/leave-requests',
      body({ fromDate: '2026-11-10', toDate: '2026-11-10' }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('S-13 Fixes (regularisation)', () => {
  const fix = (over: Record<string, unknown> = {}) => ({
    workDate: DAY,
    kind: 'missed_out',
    proposedOutTs: ist('19:00'),
    reason: 'Phone died before I left',
    ...over,
  });

  beforeEach(async () => {
    await punch(h);
    await h.at(ist('21:00'));
  });

  it('S-13.1 only dates in the last 7 days of an open month are allowed', async () => {
    const old = await staff<Err>(
      'POST',
      '/regularisations',
      fix({ workDate: '2026-10-05', proposedOutTs: ist('19:00', '2026-10-05') }),
    );
    expect(old.status).toBeGreaterThanOrEqual(400);
    const ok = await staff<RegularisationView>('POST', '/regularisations', fix());
    expect(ok.status).toBe(201);
    expect(notifier.events.map((e) => e.type)).toContain('regularisation_requested');
  });

  it('S-13.2 one open request per day', async () => {
    await staff('POST', '/regularisations', fix());
    const again = await staff<Err>('POST', '/regularisations', fix());
    expect(again.status).toBe(409);
  });

  it('S-13.3 approval creates owner-source punches, recomputes the day and writes audit rows', async () => {
    const made = await staff<RegularisationView>('POST', '/regularisations', fix());
    expectStatus(made, 201);
    const res = await owner<RegularisationView>(
      'POST',
      `/owner/regularisations/${made.body.id}/decide`,
      {
        decision: 'approve',
      },
    );
    expectStatus(res, 200);
    expect(res.body.status).toBe('approved');
    const out = await rows<{ source: string; effective_ts: number }>(
      "SELECT source, effective_ts FROM punches WHERE user_id = ?1 AND kind = 'out'",
      h.phone.id,
    );
    expect(out).toEqual([{ source: 'owner', effective_ts: ist('19:00') }]);
    const day = await staff<DayDetail>('GET', `/me/days/${DAY}`);
    expect(day.body.day.lastOutTs).toBe(ist('19:00'));
    expect(day.body.day.status).toBe('P');
    const audit = await rows<{ action: string }>(
      "SELECT action FROM audit_log WHERE action IN ('punch.create_owner', 'regularisation.approve')",
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'punch.create_owner',
      'regularisation.approve',
    ]);
    expect(notifier.events.map((e) => e.type)).toContain('regularisation_decided');
  });

  it('S-13.1 a finalised month refuses fixes', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO payroll_runs (id, org_id, month, revision, status, settings_snapshot_json, engine_version, created_by, created_at)
       VALUES ('run-oct', ?1, '2026-10', 1, 'finalised', '{}', 'test', ?2, 1)`,
    )
      .bind(h.salon.orgId, h.salon.ownerId)
      .run();
    const res = await staff<Err>('POST', '/regularisations', fix());
    expect(res.status).toBe(409);
  });
});

describe('S-16 My data', () => {
  it('S-16.1 lists punches with fence results, kept selfies with deletion dates and consents', async () => {
    await setSettings(h.salon, (s) => {
      (s.attendance as Record<string, unknown>).selfieOnCheckIn = true;
    });
    const { bytes, sha } = await jpeg();
    const res = await punch(h, { selfieSha256: sha }, { selfie: bytes });
    expect(res.status).toBe(200);
    const data = await staff<MyData>('GET', '/me/data');
    expect(data.status).toBe(200);
    expect(data.body.punches[0]).toMatchObject({
      kind: 'in',
      fenceResult: 'pass',
      locationKept: true,
    });
    expect(data.body.punches[0]?.distanceBucket).toBeTruthy();
    expect(data.body.selfies).toHaveLength(1);
    expect(data.body.selfies[0]?.punchId).toBe(res.body.punch.id);
    expect(data.body.selfies[0]?.deletesOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.body.consents.map((c) => c.kind)).toContain('privacy_notice');
    expect(data.body.retention.selfieDays).toBeGreaterThan(0);
    expect(data.body.grievance.name).toBeTruthy();
  });
});
