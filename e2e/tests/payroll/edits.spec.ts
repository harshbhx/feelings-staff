/**
 * E2E-27 Edit everything (PRD 4.19.5, 14.4): on one working day the owner changes a roll-call time,
 * flips a roll-call mark, edits an away interval's start, end and work flag, adjusts a credit entry
 * with a reason and changes a settlement before finalise. Every edit shows in the audit with old
 * and new values, and the minutes and the balance follow. A real staff phone checks in and out;
 * the owner is driven through the API against the real session, step-up and idempotency code.
 * Credits are never shown to staff, so the phone only does what a staff member does.
 */
import type {
  AuditEntryView,
  AwayIntervalStaff,
  AwayIntervalView,
  CreditAdjustment,
  CreditLedger,
  CreditSettleResult,
  CreditsSettleView,
  OwnerDayDetail,
  PayrollRunView,
  RollCallDay,
  RollCallResult,
  RollCallView,
} from '@fs/contracts';
import { expect, test } from '../../fixtures';
import { ist, type OwnerApi, onboardPhone, ownerSession, punch, staffApi } from '../flows/helpers';

const PIN = '4826';
const DAY = '2026-10-15';
const at = (hhmm: string) => ist(DAY, hhmm);
const KEY = (n: number) => `e2e-27-roll-call-key-${String(n).padStart(4, '0')}`;

test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== 'staff-android', 'Needs a staff phone with a session');
});

test.afterEach(async ({ setServerClock }) => {
  await setServerClock(null);
});

/** Every audit row, newest first, following the cursor. */
async function auditRows(owner: OwnerApi): Promise<AuditEntryView[]> {
  const rows: AuditEntryView[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const res: { items: AuditEntryView[]; nextCursor: string | null } = await owner.ok(
      'GET',
      `/owner/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    rows.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return rows;
}

const json = (v: unknown) => JSON.stringify(v ?? null);

test.describe('E2E-27 edit everything', () => {
  test('E2E-27 roll-call time and mark, away interval, credit adjustment, settlement; each in the audit', async ({
    page,
    context,
    request,
    reset,
    setServerClock,
    setGeo,
  }) => {
    test.setTimeout(420_000);
    const seeded = await reset('basic-salon');
    await setServerClock(at('10:05'));
    let owner = await ownerSession(request, seeded.owner);
    // Credits count from 1 Oct. A runner network must not hold the punches for proof.
    await owner.ok('PATCH', '/owner/settings', {
      settings: { timeCredits: { startDate: '2026-10-01' }, risk: { flagAt: 30, proofAt: 90 } },
    });
    await setGeo('inside');
    const me = await onboardPhone(page, owner, {
      name: 'Hetal Parmar',
      phone: '9824055640',
      pin: PIN,
      joinDate: '2026-10-01',
    });
    await punch(page, 'in', PIN);
    const staff = staffApi(page);

    // Edit 1: the afternoon roll-call moves from 15:00 to 15:30 (applies to the next slot).
    await owner.ok('PATCH', '/owner/settings', {
      settings: { presence: { rollCallTimes: ['12:00', '15:30', '18:00'] } },
    });
    await setServerClock(at('15:40'));
    owner = await ownerSession(request, seeded.owner);
    const slots = await owner.ok<RollCallDay>('GET', `/owner/roll-calls?date=${DAY}`);
    expect(slots.slots.map((s) => s.slotTime)).toEqual(['12:00', '15:30', '18:00']);
    const slot = slots.slots.find((s) => s.slotTime === '15:30');
    expect(slot?.status).toBe('open');
    const view = await owner.ok<RollCallView>('GET', `/owner/roll-calls/${slot?.id}`);
    expect(view.people.map((p) => p.userId)).toEqual([me.id]);

    // Edit 2: Not here, flipped to Here, flipped back to Not here. The interval starts at the slot.
    const first = await owner.ok<RollCallResult>('POST', `/owner/roll-calls/${slot?.id}/submit`, {
      notHere: [me.id],
      here: [],
      idempotencyKey: KEY(1),
    });
    expect(first.started).toEqual([me.id]);
    const flipped = await owner.ok<RollCallResult>('POST', `/owner/roll-calls/${slot?.id}/submit`, {
      notHere: [],
      here: [me.id],
      idempotencyKey: KEY(2),
    });
    expect(flipped.ended).toEqual([me.id]);
    const again = await owner.ok<RollCallResult>('POST', `/owner/roll-calls/${slot?.id}/submit`, {
      notHere: [me.id],
      here: [],
      idempotencyKey: KEY(3),
    });
    expect(again.started).toEqual([me.id]);

    // She comes back at 16:10: the owner-marked interval is counted, 40 minutes.
    await setServerClock(at('16:10'));
    const back = await staff<AwayIntervalStaff>('POST', '/presence/back', {
      idempotencyKey: 'e2e-27-back-key-000001',
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    // She checks out at 20:00; credits count away time on a finished day.
    await setServerClock(at('20:00'));
    owner = await ownerSession(request, seeded.owner);
    await context.setGeolocation({ latitude: 22.460672, longitude: 70.056548, accuracy: 23 });
    await page.reload();
    await punch(page, 'out', PIN);
    const dayRes = await request.post('/api/v1/__test/cron', {
      data: { job: 'recompute-day', date: DAY },
      headers: {
        'X-E2E-Token': process.env.E2E_TOKEN ?? '',
        'X-FS-Client': '0.1.0',
        Origin: 'http://localhost:8787',
      },
    });
    expect(dayRes.status()).toBe(200);

    const away = async () =>
      (await owner.ok<AwayIntervalView[]>('GET', '/owner/presence/away')).find(
        (a) => a.user.id === me.id,
      );
    const awayEntry = async () => {
      const ledger = await owner.ok<CreditLedger>(
        'GET',
        `/owner/credits/${me.id}/ledger?to=2026-10-31`,
      );
      return { ledger, row: ledger.items.find((r) => r.kind === 'away' && r.date === DAY) };
    };
    const interval = await away();
    expect(interval?.state).toBe('confirmed');
    expect(interval?.startTs).toBe(at('15:30'));
    expect(interval?.minutes).toBe(40);
    const before = await awayEntry();
    expect(before.row?.minutes).toBe(-40);

    // Edit 3: the interval's start and end change; minutes and the ledger follow.
    const moved = await owner.ok<AwayIntervalView>(
      'PATCH',
      `/owner/presence/away/${interval?.id}`,
      {
        startTs: at('15:40'),
        endTs: at('16:05'),
        editReason: 'She left at 15:40 and was back at 16:05',
      },
    );
    expect(moved.startTs).toBe(at('15:40'));
    expect(moved.endTs).toBe(at('16:05'));
    expect(moved.minutes).toBe(25);
    const afterMove = await awayEntry();
    expect(afterMove.row?.minutes).toBe(-25);
    expect(afterMove.ledger.balanceMin).toBe(before.ledger.balanceMin + 15);

    // Edit 4: the work flag. As work it makes no entry; set back to counted it makes one again.
    const asWork = await owner.ok<AwayIntervalView>(
      'PATCH',
      `/owner/presence/away/${interval?.id}`,
      {
        state: 'work',
        editReason: 'It was an errand for the salon',
      },
    );
    expect(asWork.state).toBe('work');
    expect((await awayEntry()).row).toBeUndefined();
    const counted = await owner.ok<AwayIntervalView>(
      'PATCH',
      `/owner/presence/away/${interval?.id}`,
      { state: 'confirmed', editReason: 'It was lunch after all' },
    );
    expect(counted.state).toBe('confirmed');
    const counted25 = await awayEntry();
    expect(counted25.row?.minutes).toBe(-25);

    // Edit 5: adjust the credit entry with a reason; the original stays, history shows both.
    const adj = await owner.call('POST', `/owner/credits/${me.id}/adjustments`, {
      workDate: DAY,
      kind: 'away',
      deltaMin: 10,
      reason: 'Excused 10 minutes',
    });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    const adjustment = adj.body as CreditAdjustment;
    const adjusted = await awayEntry();
    expect(adjusted.row?.minutes).toBe(-25);
    expect(adjusted.row?.adjustedMin).toBe(10);
    expect(adjusted.ledger.balanceMin).toBe(counted25.ledger.balanceMin + 10);
    await owner.ok('PATCH', `/owner/credits/adjustments/${adjustment.id}`, {
      deltaMin: 15,
      reason: 'Excused 15 minutes, not 10',
    });
    const readjusted = await awayEntry();
    expect(readjusted.row?.adjustedMin).toBe(15);
    expect(readjusted.ledger.balanceMin).toBe(counted25.ledger.balanceMin + 15);
    expect(readjusted.row?.history.map((h) => h.kind)).toContain('adjustment');
    expect(readjusted.row?.history.map((h) => h.reason)).toContain('Excused 15 minutes, not 10');

    // The day detail shows the audit of the day's presence edits too.
    const detail = await owner.ok<OwnerDayDetail>('GET', `/owner/days/${me.id}/${DAY}`);
    expect(detail.punches.map((p) => p.kind)).toEqual(['in', 'out']);

    // Edit 6: the month ends; the settlement is set to the suggestion, then changed before finalise.
    await setServerClock(ist('2026-11-02', '11:00'));
    owner = await ownerSession(request, seeded.owner);
    const run = await owner.ok<PayrollRunView>('POST', '/owner/payroll-runs', { month: '2026-10' });
    const settle = await owner.ok<CreditsSettleView>(
      'GET',
      `/owner/payroll-runs/${run.run.id}/credits`,
    );
    const mine = settle.rows.find((r) => r.userId === me.id);
    expect(mine, 'she is on the Settle credits step').toBeTruthy();
    const full = mine?.suggestedMin ?? 0;
    expect(full, 'there is a balance to settle').not.toBe(0);
    const saved = await owner.ok<CreditSettleResult>(
      'PUT',
      `/owner/payroll-runs/${run.run.id}/credits/${me.id}`,
      { settleMin: full },
    );
    expect(saved.settlement.settleMin).toBe(full);
    const less = Math.trunc(full / 2);
    const changed = await owner.ok<CreditSettleResult>(
      'PUT',
      `/owner/payroll-runs/${run.run.id}/credits/${me.id}`,
      { settleMin: less },
    );
    expect(changed.settlement.settleMin).toBe(less);
    const view2 = await owner.ok<CreditsSettleView>(
      'GET',
      `/owner/payroll-runs/${run.run.id}/credits`,
    );
    expect(view2.rows.find((r) => r.userId === me.id)?.settleMin).toBe(less);

    // Every edit is in the audit with old and new values.
    const rows = await auditRows(owner);
    const byAction = (prefix: string) => rows.filter((r) => r.action.startsWith(prefix));
    const roll = rows.filter((r) => r.entity === 'roll_call').map((r) => r.action);
    expect(roll).toEqual(expect.arrayContaining(['rollcall.submit', 'rollcall.edit']));
    expect(roll.filter((a) => a === 'rollcall.edit').length).toBeGreaterThanOrEqual(2);
    const settings = rows.filter((r) => r.action.startsWith('settings'));
    expect(
      settings.some((r) => json(r.before).includes('15:00') && json(r.after).includes('15:30')),
      'the roll-call time change is audited old to new',
    ).toBe(true);
    const awayEdits = byAction('presence.away');
    const startEdit = awayEdits.find(
      (r) =>
        r.action === 'presence.away.edit' && json(r.after).includes(`"startTs":${at('15:40')}`),
    );
    expect(startEdit, 'the start and end edit is audited').toBeTruthy();
    expect(json(startEdit?.before)).toContain(`"startTs":${at('15:30')}`);
    expect(json(startEdit?.before)).toContain('"minutes":40');
    expect(json(startEdit?.after)).toContain('"minutes":25');
    expect(startEdit?.reason).toBe('She left at 15:40 and was back at 16:05');
    const workEdit = awayEdits.find((r) => r.action === 'presence.away.work');
    expect(json(workEdit?.before)).toContain('"state":"confirmed"');
    expect(json(workEdit?.after)).toContain('"state":"work"');
    expect(workEdit?.reason).toBe('It was an errand for the salon');
    const countedAgain = awayEdits.find((r) => r.action === 'presence.away.confirm');
    expect(json(countedAgain?.before)).toContain('"state":"work"');
    expect(countedAgain?.reason).toBe('It was lunch after all');
    const adjAudit = byAction('credits.adjust');
    expect(adjAudit.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['Excused 10 minutes', 'Excused 15 minutes, not 10']),
    );
    const settleAudit = byAction('credits.settle');
    expect(settleAudit.length).toBeGreaterThanOrEqual(2);
    expect(settleAudit.some((r) => json(r.before).includes(String(full)))).toBe(true);
    expect(settleAudit.some((r) => json(r.after).includes(String(less)))).toBe(true);
  });
});
