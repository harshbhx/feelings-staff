/**
 * WP-3 staff accounts suite (PRD 4.1.1, 4.1.5, 4.1.6, O-07): add, edit, invite, re-invite, reset
 * PIN, exit, rehire, duplicates, the 15-person cap, effective-dated salary and device decisions.
 */
import type { DeviceView, Endpoints, OutputOf, StaffDetail, StaffRow } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier } from '../../test/fakes';
import {
  call,
  callJson,
  resetScenario,
  type Scenario,
  sessionFor,
  testEnv,
} from '../../test/helpers';
import {
  approve,
  auditActions,
  createStaff,
  errorCode,
  joinBody,
  joinStaff,
  makeDeviceKey,
  nextPhone,
  ownerStepUp,
  staffLogin,
  templateId,
} from '../auth/test/kit';

type StaffCreated = OutputOf<Endpoints['ownerStaffCreate']>;

let s: Scenario;
let notifier: ReturnType<typeof fakeNotifier>;

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  notifier = fakeNotifier();
  setServiceOverridesForTests({ notifier });
});

afterEach(() => {
  setServiceOverridesForTests(null);
});

describe('O-07.1 add, edit, invite, re-invite, reset PIN, exit', () => {
  it('adds a person with an invite message, wa.me link and audit rows', async () => {
    const owner = await sessionFor(s.ownerId);
    const phone = nextPhone();
    const res = await callJson<StaffCreated>('POST', '/owner/staff', {
      cookie: owner,
      body: {
        name: '  Kajal Parmar ',
        phone: `0${phone.slice(3)}`,
        designation: 'Beautician',
        joinDate: '2026-10-01',
        salaryType: 'monthly',
        salaryAmountPaise: 1200000,
        defaultTemplateId: await templateId(),
        weekOffDow: 3,
        lang: 'gu',
        selfieRequired: true,
        employeeCode: 'FBC-011',
        adultConfirmed: true,
      },
    });
    expect(res.status).toBe(201);
    const { staff, invite } = res.body;
    expect(staff).toMatchObject({
      name: 'Kajal Parmar',
      phone,
      status: 'invited',
      deviceState: 'none',
      designation: 'Beautician',
      lang: 'gu',
      selfieRequired: true,
      employeeCode: 'FBC-011',
      salary: { type: 'monthly', amountPaise: 1200000, effectiveFrom: '2026-10-01' },
      invite: { status: 'active' },
    });
    expect(invite.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(invite.url).toBe(`${testEnv.APP_ORIGIN}/join/${invite.code.replace('-', '')}`);
    expect(invite.message).toContain('Hi Kajal, this is Urmi from Feelings Beauty Care.');
    expect(invite.message).toContain(`*${invite.code}*`);
    expect(invite.message).toContain('The link works for 48 hours.');
    expect(invite.waLink).toMatch(new RegExp(`^https://wa\\.me/${phone.slice(1)}\\?text=`));
    expect(invite.expiresAt - Date.now()).toBeGreaterThan(47 * 3_600_000);
    const stored = await testEnv.DB.prepare('SELECT code_hash FROM invites WHERE user_id = ?1')
      .bind(staff.id)
      .first<{ code_hash: string }>();
    expect(stored?.code_hash).not.toContain(invite.code.replace('-', ''));
    expect(await auditActions(staff.id)).toContain('staff.create');

    const list = await callJson<StaffRow[]>('GET', '/owner/staff?q=kajal', { cookie: owner });
    expect(list.body.map((r) => r.id)).toEqual([staff.id]);
    const byPhone = await callJson<StaffRow[]>('GET', `/owner/staff?q=${phone.slice(-6)}`, {
      cookie: owner,
    });
    expect(byPhone.body).toHaveLength(1);
  });

  it('edits profile fields with a before/after audit row', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const res = await callJson<StaffDetail>('PATCH', `/owner/staff/${staff.id}`, {
      cookie: owner,
      body: {
        designation: 'Makeup artist',
        weekOffDow: 1,
        strongMode: true,
        divisorOverride: 'fixed26',
        otRateOverride: { mode: 'flat', paisePerHour: 15000 },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      designation: 'Makeup artist',
      weekOffDow: 1,
      strongMode: true,
      divisorOverride: 'fixed26',
      otRateOverride: { mode: 'flat', paisePerHour: 15000 },
    });
    const row = await testEnv.DB.prepare(
      "SELECT before_json, after_json FROM audit_log WHERE action = 'staff.update' AND entity_id = ?1",
    )
      .bind(staff.id)
      .first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(row?.before_json ?? '{}')).toMatchObject({
      designation: 'Stylist',
      weekOffDow: 2,
    });
    expect(JSON.parse(row?.after_json ?? '{}')).toMatchObject({ designation: 'Makeup artist' });
  });

  it('re-sending an invite makes the old code stop working', async () => {
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner);
    const re = await callJson<{ invite: { code: string; url: string } }>(
      'POST',
      `/owner/staff/${staff.id}/invite`,
      { cookie: owner },
    );
    expect(re.status).toBe(200);
    expect(re.body.invite.code).not.toBe(staff.invite.code);
    const old = await call('POST', '/join/verify', {
      body: { phone: staff.phone, code: staff.rawCode },
    });
    expect(await errorCode(old)).toMatchObject({
      code: 'INVITE_EXPIRED',
      details: { state: 'expired' },
    });
    const fresh = await call('POST', '/join/verify', {
      body: { phone: staff.phone, code: re.body.invite.code },
    });
    expect(fresh.status).toBe(200);
  });

  it('reset PIN: the old PIN stops working, the phone stays approved, the new code sets a PIN', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';
    await approve(owner, deviceId);

    const reset = await callJson<{ invite: { code: string; purpose: string; message: string } }>(
      'POST',
      `/owner/staff/${staff.id}/reset-pin`,
      { cookie: owner },
    );
    expect(reset.body.invite.purpose).toBe('pin_reset');
    expect(reset.body.invite.message).toContain('reset your staff app PIN');
    expect((await call('GET', '/me', { cookie: joined.cookie })).status).toBe(401);
    const oldPin = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(await errorCode(oldPin)).toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      details: { reason: 'pin_not_set' },
    });

    // Same phone, same key: the device stays approved and the new PIN works.
    const redo = await call('POST', '/join/complete', {
      body: joinBody({
        phone: staff.phone,
        code: reset.body.invite.code,
        pin: '3691',
        key: joined.key,
      }),
    });
    expect(redo.status).toBe(200);
    const device = await testEnv.DB.prepare('SELECT status FROM devices WHERE id = ?1')
      .bind(deviceId)
      .first<{ status: string }>();
    expect(device?.status).toBe('approved');
    expect(notifier.events.filter((e) => e.type === 'new_device')).toHaveLength(1);
    const ok = await staffLogin({ phone: staff.phone, pin: '3691', deviceId, key: joined.key });
    expect(ok.status).toBe(200);
    expect(await auditActions(staff.id)).toContain('auth.pin_reset');
  });

  it('exit revokes phones, sessions and invites and records the last day', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';
    await approve(owner, deviceId);
    const res = await callJson<StaffDetail>('POST', `/owner/staff/${staff.id}/exit`, {
      cookie: owner,
      body: { lastDay: '2026-10-18', reason: 'Moved to Rajkot' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'exited',
      exitDate: '2026-10-18',
      exitReason: 'Moved to Rajkot',
      deviceState: 'none',
    });
    expect(res.body.devices[0]?.status).toBe('revoked');
    expect((await call('GET', '/me', { cookie: joined.cookie })).status).toBe(401);
    const login = await staffLogin({
      phone: staff.phone,
      pin: joined.pin,
      deviceId,
      key: joined.key,
    });
    expect(login.status).toBe(401);
    const again = await call('POST', `/owner/staff/${staff.id}/exit`, {
      cookie: owner,
      body: { lastDay: '2026-10-18', reason: 'Again' },
    });
    expect((await errorCode(again)).code).toBe('CONFLICT');
    const invite = await call('POST', `/owner/staff/${staff.id}/invite`, { cookie: owner });
    expect((await errorCode(invite)).code).toBe('RULE_VIOLATION');
    const active = await callJson<StaffRow[]>('GET', '/owner/staff', { cookie: owner });
    expect(active.body.map((r) => r.id)).not.toContain(staff.id);
    const exited = await callJson<StaffRow[]>('GET', '/owner/staff?status=exited', {
      cookie: owner,
    });
    expect(exited.body.map((r) => r.id)).toEqual([staff.id]);
  });
});

describe('O-07.2 salary changes', () => {
  it('are effective-dated rows and need step-up', async () => {
    const plain = await sessionFor(s.ownerId);
    const staff = await createStaff(plain);
    const body = { salary: { type: 'monthly', amountPaise: 1650000, effectiveFrom: '2099-11-01' } };
    const denied = await call('PATCH', `/owner/staff/${staff.id}`, { cookie: plain, body });
    expect((await errorCode(denied)).code).toBe('STEP_UP_REQUIRED');

    const owner = await ownerStepUp(s.ownerId);
    const res = await callJson<StaffDetail>('PATCH', `/owner/staff/${staff.id}`, {
      cookie: owner,
      body,
    });
    expect(res.status).toBe(200);
    // Today still pays the joining salary; the new row waits for its date.
    expect(res.body.salary).toMatchObject({ amountPaise: 1500000, effectiveFrom: '2026-10-01' });
    expect(res.body.salaryHistory.map((h) => [h.effectiveFrom, h.amountPaise])).toEqual([
      ['2026-10-01', 1500000],
      ['2099-11-01', 1650000],
    ]);
    // The same effective date again replaces that row instead of adding one.
    await call('PATCH', `/owner/staff/${staff.id}`, {
      cookie: owner,
      body: { salary: { type: 'monthly', amountPaise: 1700000, effectiveFrom: '2099-11-01' } },
    });
    const n = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM salary_history WHERE user_id = ?1',
    )
      .bind(staff.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(2);
    const audit = await testEnv.DB.prepare(
      "SELECT before_json, after_json FROM audit_log WHERE action = 'salary.change' AND entity_id = ?1 ORDER BY created_at LIMIT 1",
    )
      .bind(staff.id)
      .first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(audit?.before_json ?? '{}')).toMatchObject({ amountPaise: 1500000 });
    expect(JSON.parse(audit?.after_json ?? '{}')).toMatchObject({ amountPaise: 1650000 });
  });

  it('are refused in a finalised month', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    await testEnv.DB.prepare(
      `INSERT INTO payroll_runs (id, org_id, month, revision, status, settings_snapshot_json, engine_version, created_by, created_at)
       VALUES ('01JBPAYRUN0000000000000000', ?1, '2026-09', 1, 'finalised', '{}', 'test', ?2, ?3)`,
    )
      .bind(s.orgId, s.ownerId, Date.now())
      .run();
    const res = await call('PATCH', `/owner/staff/${staff.id}`, {
      cookie: owner,
      body: { salary: { type: 'monthly', amountPaise: 1650000, effectiveFrom: '2026-09-15' } },
    });
    expect(res.status).toBe(409);
    expect((await errorCode(res)).code).toBe('MONTH_LOCKED');
  });

  it('warn below the minimum wage but still save', async () => {
    await testEnv.DB.prepare(
      "UPDATE orgs SET settings_json = json_set(settings_json, '$.pay.minimumWage.amountPaise', 1332500)",
    ).run();
    const owner = await sessionFor(s.ownerId);
    const staff = await createStaff(owner, { salaryAmountPaise: 1100000 });
    const got = await callJson<StaffDetail>('GET', `/owner/staff/${staff.id}`, { cookie: owner });
    expect(got.body.minimumWageWarning).toBe(
      '₹11,000 is below the minimum wage you set (₹13,325 a month). You can still save.',
    );
  });
});

describe('O-07.3 duplicates and rehire', () => {
  it('a phone on the team is a DUPLICATE naming that person', async () => {
    const owner = await sessionFor(s.ownerId);
    const first = await createStaff(owner, { name: 'Priya Solanki' });
    const res = await call('POST', '/owner/staff', {
      cookie: owner,
      body: {
        name: 'Someone Else',
        phone: first.phone,
        designation: 'Helper',
        joinDate: '2026-10-01',
        salaryType: 'daily',
        salaryAmountPaise: 50000,
        defaultTemplateId: await templateId(),
        weekOffDow: null,
        lang: 'en',
        selfieRequired: null,
        adultConfirmed: true,
      },
    });
    expect(res.status).toBe(409);
    const err = await errorCode(res);
    expect(err).toMatchObject({
      code: 'DUPLICATE',
      message: 'This number already belongs to Priya. Edit Priya instead?',
      details: { existingId: first.id, exited: false },
    });
    const other = await createStaff(owner);
    const patch = await call('PATCH', `/owner/staff/${other.id}`, {
      cookie: owner,
      body: { phone: first.phone },
    });
    expect((await errorCode(patch)).code).toBe('DUPLICATE');
  });

  it("an exited person's phone offers a rehire, which keeps history and issues a new invite", async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    await call('POST', `/owner/staff/${staff.id}/exit`, {
      cookie: owner,
      body: { lastDay: '2026-08-03', reason: 'Wedding' },
    });
    const dup = await call('POST', '/owner/staff', {
      cookie: owner,
      body: {
        name: 'Priya S',
        phone: staff.phone,
        designation: 'Stylist',
        joinDate: '2026-10-19',
        salaryType: 'monthly',
        salaryAmountPaise: 1500000,
        defaultTemplateId: await templateId(),
        weekOffDow: 2,
        lang: 'en',
        selfieRequired: null,
        adultConfirmed: true,
      },
    });
    expect(await errorCode(dup)).toMatchObject({
      code: 'DUPLICATE',
      message: 'Priya left on 3 Aug. Rehire Priya?',
      details: { existingId: staff.id, exited: true, exitDate: '2026-08-03' },
    });
    const rehire = await callJson<StaffCreated>('POST', `/owner/staff/${staff.id}/rehire`, {
      cookie: owner,
      body: { joinDate: '2026-10-19' },
    });
    expect(rehire.status).toBe(200);
    expect(rehire.body.staff).toMatchObject({
      id: staff.id,
      status: 'invited',
      joinDate: '2026-10-19',
      exitDate: null,
    });
    expect(rehire.body.staff.salaryHistory).toHaveLength(1);
    const join = await call('POST', '/join/verify', {
      body: { phone: staff.phone, code: rehire.body.invite.code },
    });
    expect(join.status).toBe(200);
    const twice = await call('POST', `/owner/staff/${staff.id}/rehire`, {
      cookie: owner,
      body: { joinDate: '2026-10-19' },
    });
    expect((await errorCode(twice)).code).toBe('CONFLICT');
  });
});

describe('15 active staff cap (Harsh, 19 Oct)', () => {
  it('refuses the 16th person and a rehire over the cap', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const made = [];
    for (let i = 0; i < 15; i++) made.push(await createStaff(owner, { name: `Staff ${i + 1}` }));
    const res = await call('POST', '/owner/staff', {
      cookie: owner,
      body: {
        name: 'One Too Many',
        phone: nextPhone(),
        designation: 'Helper',
        joinDate: '2026-10-19',
        salaryType: 'monthly',
        salaryAmountPaise: 900000,
        defaultTemplateId: await templateId(),
        weekOffDow: null,
        lang: 'en',
        selfieRequired: null,
        adultConfirmed: true,
      },
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toMatchObject({
      code: 'RULE_VIOLATION',
      message: 'You can have up to 15 active staff. Mark someone as left first.',
      details: { limit: 15 },
    });

    const leaver = made[0];
    if (!leaver) throw new Error('no staff');
    await call('POST', `/owner/staff/${leaver.id}/exit`, {
      cookie: owner,
      body: { lastDay: '2026-10-18', reason: 'Left' },
    });
    const sixteenth = await createStaff(owner, { name: 'New Joiner' });
    expect(sixteenth.id).toBeTruthy();
    const rehire = await call('POST', `/owner/staff/${leaver.id}/rehire`, {
      cookie: owner,
      body: { joinDate: '2026-10-19' },
    });
    expect(await errorCode(rehire)).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { limit: 15 },
    });
  });
});

describe('PRD 4.1.5 device decisions', () => {
  it('approve once; a second decision is ALREADY_DECIDED; idempotent replays return the first answer', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';
    const headers = { 'Idempotency-Key': 'decide-device-0001' };
    const first = await callJson<DeviceView>('POST', `/owner/devices/${deviceId}/decide`, {
      cookie: owner,
      headers,
      body: { decision: 'approve' },
    });
    expect(first.body.status).toBe('approved');
    const replay = await call('POST', `/owner/devices/${deviceId}/decide`, {
      cookie: owner,
      headers,
      body: { decision: 'approve' },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replay')).toBe('true');
    const second = await call('POST', `/owner/devices/${deviceId}/decide`, {
      cookie: owner,
      body: { decision: 'reject' },
    });
    expect((await errorCode(second)).code).toBe('ALREADY_DECIDED');
    expect(notifier.events.filter((e) => e.type === 'device_decided')).toEqual([
      expect.objectContaining({ userId: staff.id, deviceId, decision: 'approved' }),
    ]);
    expect(await auditActions(deviceId)).toEqual(['device.enrol', 'device.approve']);
  });

  it('reject ends the join session on that phone and N20 says so', async () => {
    const owner = await ownerStepUp(s.ownerId);
    const staff = await createStaff(owner);
    const joined = await joinStaff(staff);
    const deviceId = joined.me.device?.id ?? '';
    const res = await callJson<DeviceView>('POST', `/owner/devices/${deviceId}/decide`, {
      cookie: owner,
      body: { decision: 'reject', note: 'Not her phone' },
    });
    expect(res.body.status).toBe('rejected');
    expect((await call('GET', '/me', { cookie: joined.cookie })).status).toBe(401);
    expect(notifier.events.find((e) => e.type === 'device_decided')).toMatchObject({
      decision: 'rejected',
    });
    // A rejected key can never come back: joining again needs a new key.
    const re = await callJson<{ invite: { code: string } }>(
      'POST',
      `/owner/staff/${staff.id}/invite`,
      { cookie: owner },
    );
    const reuse = await call('POST', '/join/complete', {
      body: joinBody({ phone: staff.phone, code: re.body.invite.code, key: joined.key }),
    });
    expect(await errorCode(reuse)).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'device_key_used' },
    });
    const freshKey = await makeDeviceKey();
    const ok = await call('POST', '/join/complete', {
      body: joinBody({ phone: staff.phone, code: re.body.invite.code, key: freshKey }),
    });
    expect(ok.status).toBe(200);
  });

  it("another org's device or person is a 404", async () => {
    const owner = await ownerStepUp(s.ownerId);
    const missing = await call('POST', '/owner/devices/01JBZZZZZZZZZZZZZZZZZZZZZZ/decide', {
      cookie: owner,
      body: { decision: 'approve' },
    });
    expect(missing.status).toBe(404);
    const person = await call('GET', '/owner/staff/01JBZZZZZZZZZZZZZZZZZZZZZZ', { cookie: owner });
    expect((await errorCode(person)).code).toBe('NOT_FOUND');
  });
});
