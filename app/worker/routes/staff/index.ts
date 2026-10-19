/**
 * Route handlers. Owner: WP-3: owner staff CRUD, invites, PIN reset, exit, rehire, and device
 * decisions (PRD 4.1.1, 4.1.5, 4.1.6, 9.4 "Owner and manager", O-07).
 */
import { MAX_ACTIVE_STAFF, normaliseIndianPhone } from '@fs/contracts';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { loadOrg } from '../../lib/settings';
import { ulid } from '../../lib/ulid';
import {
  approveDeviceStmts,
  deviceView,
  getDevice,
  rejectDeviceStmts,
  revokeDeviceStmts,
} from '../../services/device';
import { issueInvite, revokeInvitesStmt } from '../../services/invite';
import type { Ctx } from '../../services/ports';
import { revokeUserSessionsStmt } from '../../services/session';
import { listStaff, loadStaffDetail, type StaffBase, shortDate, staffBase } from './detail';

const CAP_MESSAGE = 'You can have up to 15 active staff. Mark someone as left first.';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function actorId(ctx: Ctx): string {
  const id = ctx.user?.id;
  if (!id) fail('UNAUTHENTICATED');
  return id;
}

function phoneOrFail(input: string): string {
  const phone = normaliseIndianPhone(input);
  if (!phone)
    fail('VALIDATION', 'Enter a 10-digit mobile number.', {
      issues: [{ path: 'phone', message: 'Expected an Indian mobile number', code: 'custom' }],
    });
  return phone;
}

/**
 * PRD 4.1.1: a phone used by someone on the team is a DUPLICATE naming them; with `offerRehire`,
 * a phone of someone who left is a DUPLICATE that offers to rehire them.
 */
async function assertPhoneFree(
  ctx: Ctx,
  phone: string,
  opts: { exceptId?: string; offerRehire: boolean },
): Promise<void> {
  const rows = await ctx.db.all<{
    id: string;
    name: string;
    role: string;
    status: string;
    exit_date: string | null;
  }>(
    `SELECT u.id, u.name, u.role, u.status, p.exit_date
       FROM users u LEFT JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.phone_e164 = ? AND u.id <> ?
      ORDER BY u.status = 'exited', u.exited_at DESC`,
    phone,
    opts.exceptId ?? '',
  );
  const live = rows.find((r) => r.status !== 'exited');
  if (live) {
    const n = firstName(live.name);
    fail('DUPLICATE', `This number already belongs to ${n}. Edit ${n} instead?`, {
      field: 'phone',
      existingId: live.id,
      existingName: live.name,
      exited: false,
    });
  }
  const gone = rows.find((r) => r.status === 'exited' && r.role !== 'owner');
  if (gone && opts.offerRehire) {
    const n = firstName(gone.name);
    const when = gone.exit_date ? ` on ${shortDate(gone.exit_date)}` : '';
    fail('DUPLICATE', `${n} left${when}. Rehire ${n}?`, {
      field: 'phone',
      existingId: gone.id,
      existingName: gone.name,
      exited: true,
      exitDate: gone.exit_date,
    });
  }
}

/** Harsh's cap: at most 15 active (non-exited) staff and managers. */
async function assertUnderCap(ctx: Ctx): Promise<void> {
  const row = await ctx.db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users
      WHERE org_id = ?org AND role IN ('staff', 'manager') AND status <> 'exited'`,
  );
  if ((row?.n ?? 0) >= MAX_ACTIVE_STAFF)
    fail('RULE_VIOLATION', CAP_MESSAGE, { limit: MAX_ACTIVE_STAFF });
}

async function assertTemplate(ctx: Ctx, templateId: string): Promise<void> {
  const t = await ctx.db.first<{ id: string }>(
    'SELECT id FROM shift_templates WHERE org_id = ?org AND id = ? AND active = 1',
    templateId,
  );
  if (!t)
    fail('VALIDATION', 'Pick one of your shift templates.', {
      issues: [{ path: 'defaultTemplateId', message: 'Unknown shift template', code: 'custom' }],
    });
}

async function orgNames(ctx: Ctx): Promise<{ name: string; ownerDisplayName: string }> {
  const { org } = await loadOrg(ctx);
  return { name: org.name, ownerDisplayName: org.owner_display_name };
}

function assertNotExited(base: StaffBase): void {
  if (base.status === 'exited')
    fail('RULE_VIOLATION', `${firstName(base.name)} has left. Rehire them first.`, {
      reason: 'exited',
    });
}

/** Statements that clear a PIN and its counters (PIN reset, rehire). */
function clearPinStmt(ctx: Ctx, userId: string, extra: Record<string, string | number | null>) {
  return ctx.db.update(
    'users',
    {
      pin_hash: null,
      pin_salt: null,
      pin_set_at: null,
      pin_failures: 0,
      pin_failures_24h: 0,
      pin_window_start: null,
      pin_locked_until: null,
      updated_at: ctx.now(),
      ...extra,
    },
    'id = ?',
    userId,
  );
}

export const handlers: Handlers = {
  async ownerStaffList({ query }, ctx) {
    return listStaff(ctx, { status: query.status, q: query.q });
  },

  async ownerStaffGet({ params }, ctx) {
    return loadStaffDetail(ctx, params.id);
  },

  async ownerStaffCreate({ body }, ctx) {
    const by = actorId(ctx);
    const phone = phoneOrFail(body.phone);
    await assertPhoneFree(ctx, phone, { offerRehire: true });
    await assertUnderCap(ctx);
    await assertTemplate(ctx, body.defaultTemplateId);
    const now = ctx.now();
    const id = ulid(now);
    const name = body.name.trim();
    const invite = await issueInvite(ctx, {
      user: { id, name, phone },
      purpose: 'join',
      org: await orgNames(ctx),
      createdBy: by,
    });
    const after = {
      name,
      phone,
      designation: body.designation,
      joinDate: body.joinDate,
      salaryType: body.salaryType,
      salaryAmountPaise: body.salaryAmountPaise,
      defaultTemplateId: body.defaultTemplateId,
      weekOffDow: body.weekOffDow,
      lang: body.lang,
      selfieRequired: body.selfieRequired,
      employeeCode: body.employeeCode ?? null,
      adultConfirmed: true,
    };
    const audit = ctx.services.audit;
    await ctx.db.batch([
      ctx.db.insert('users', {
        id,
        role: 'staff',
        name,
        phone_e164: phone,
        lang: body.lang,
        status: 'invited',
        created_at: now,
        updated_at: now,
      }),
      ctx.db.insert('staff_profiles', {
        user_id: id,
        employee_code: body.employeeCode?.trim() || null,
        designation: body.designation.trim(),
        join_date: body.joinDate,
        default_template_id: body.defaultTemplateId,
        week_off_dow: body.weekOffDow,
        selfie_required: body.selfieRequired === null ? null : body.selfieRequired ? 1 : 0,
        strong_mode: 0,
        created_at: now,
        updated_at: now,
      }),
      ctx.db.insert('salary_history', {
        id: ulid(now),
        user_id: id,
        effective_from: body.joinDate,
        salary_type: body.salaryType,
        amount_paise: body.salaryAmountPaise,
        created_by: by,
        created_at: now,
      }),
      ...invite.stmts,
      audit.stmt(ctx, {
        category: 'change',
        action: 'staff.create',
        entity: 'user',
        entityId: id,
        after,
      }),
      audit.stmt(ctx, {
        category: 'change',
        action: 'invite.create',
        entity: 'invite',
        entityId: invite.id,
        after: { userId: id, purpose: 'join', expiresAt: invite.view.expiresAt },
      }),
    ]);
    return { staff: await loadStaffDetail(ctx, id), invite: invite.view };
  },

  async ownerStaffPatch({ params, body }, ctx) {
    const by = actorId(ctx);
    const base = await staffBase(ctx, params.id);
    // Salary changes are effective-dated and need the owner PIN (PRD 4.1.7 step 4, O-07.2).
    if (body.salary) await ctx.services.stepUp.require(ctx);

    const now = ctx.now();
    const userSet: Record<string, string | number | null> = {};
    const profileSet: Record<string, string | number | null> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const change = (
      target: Record<string, string | number | null>,
      column: string,
      field: string,
      oldValue: unknown,
      newValue: string | number | null,
      shown: unknown = newValue,
    ) => {
      if (oldValue === newValue) return;
      target[column] = newValue;
      before[field] = oldValue;
      after[field] = shown;
    };

    if (body.name !== undefined) change(userSet, 'name', 'name', base.name, body.name.trim());
    if (body.phone !== undefined) {
      const phone = phoneOrFail(body.phone);
      if (phone !== base.phone_e164) {
        await assertPhoneFree(ctx, phone, { exceptId: base.id, offerRehire: false });
        change(userSet, 'phone_e164', 'phone', base.phone_e164, phone);
      }
    }
    if (body.lang !== undefined) change(userSet, 'lang', 'lang', base.lang, body.lang);
    if (body.designation !== undefined)
      change(profileSet, 'designation', 'designation', base.designation, body.designation.trim());
    if (
      body.defaultTemplateId !== undefined &&
      body.defaultTemplateId !== base.default_template_id
    ) {
      await assertTemplate(ctx, body.defaultTemplateId);
      change(
        profileSet,
        'default_template_id',
        'defaultTemplateId',
        base.default_template_id,
        body.defaultTemplateId,
      );
    }
    if (body.weekOffDow !== undefined)
      change(profileSet, 'week_off_dow', 'weekOffDow', base.week_off_dow, body.weekOffDow);
    if (body.selfieRequired !== undefined)
      change(
        profileSet,
        'selfie_required',
        'selfieRequired',
        base.selfie_required,
        body.selfieRequired === null ? null : body.selfieRequired ? 1 : 0,
        body.selfieRequired,
      );
    if (body.strongMode !== undefined)
      change(
        profileSet,
        'strong_mode',
        'strongMode',
        base.strong_mode,
        body.strongMode ? 1 : 0,
        body.strongMode,
      );
    if (body.divisorOverride !== undefined)
      change(
        profileSet,
        'divisor_override',
        'divisorOverride',
        base.divisor_override,
        body.divisorOverride,
      );
    if (body.otRateOverride !== undefined)
      change(
        profileSet,
        'ot_rate_override_json',
        'otRateOverride',
        base.ot_rate_override_json,
        body.otRateOverride === null ? null : JSON.stringify(body.otRateOverride),
        body.otRateOverride,
      );
    if (body.employeeCode !== undefined)
      change(
        profileSet,
        'employee_code',
        'employeeCode',
        base.employee_code,
        body.employeeCode?.trim() || null,
      );

    const audit = ctx.services.audit;
    const stmts: D1PreparedStatement[] = [];
    if (Object.keys(userSet).length > 0)
      stmts.push(ctx.db.update('users', { ...userSet, updated_at: now }, 'id = ?', base.id));
    if (Object.keys(profileSet).length > 0)
      stmts.push(
        ctx.db.update('staff_profiles', { ...profileSet, updated_at: now }, 'user_id = ?', base.id),
      );
    if (stmts.length > 0)
      stmts.push(
        audit.stmt(ctx, {
          category: 'change',
          action: 'staff.update',
          entity: 'user',
          entityId: base.id,
          before,
          after,
        }),
      );

    if (body.salary) {
      const s = body.salary;
      const month = s.effectiveFrom.slice(0, 7);
      const locked = await ctx.db.first<{ id: string }>(
        `SELECT id FROM payroll_runs WHERE org_id = ?org AND month = ? AND status = 'finalised' LIMIT 1`,
        month,
      );
      if (locked)
        fail('MONTH_LOCKED', 'That month is closed. Pick a date in an open month.', { month });
      const previous = await ctx.db.first<{
        salary_type: string;
        amount_paise: number;
        effective_from: string;
      }>(
        `SELECT salary_type, amount_paise, effective_from FROM salary_history
          WHERE org_id = ?org AND user_id = ? AND effective_from <= ?
          ORDER BY effective_from DESC LIMIT 1`,
        base.id,
        s.effectiveFrom,
      );
      const salaryId = ulid(now);
      stmts.push(
        ctx.db.stmt(
          `INSERT INTO salary_history (id, org_id, user_id, effective_from, salary_type, amount_paise, created_by, created_at)
           VALUES (?, ?org, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, effective_from) DO UPDATE SET
             salary_type = excluded.salary_type, amount_paise = excluded.amount_paise,
             created_by = excluded.created_by, created_at = excluded.created_at`,
          salaryId,
          base.id,
          s.effectiveFrom,
          s.type,
          s.amountPaise,
          by,
          now,
        ),
        audit.stmt(ctx, {
          category: 'change',
          action: 'salary.change',
          entity: 'user',
          entityId: base.id,
          before: previous
            ? {
                type: previous.salary_type,
                amountPaise: previous.amount_paise,
                effectiveFrom: previous.effective_from,
              }
            : null,
          after: { type: s.type, amountPaise: s.amountPaise, effectiveFrom: s.effectiveFrom },
        }),
      );
    }
    await ctx.db.batch(stmts);
    return loadStaffDetail(ctx, base.id);
  },

  async ownerStaffInvite({ params }, ctx) {
    const by = actorId(ctx);
    const base = await staffBase(ctx, params.id);
    assertNotExited(base);
    const invite = await issueInvite(ctx, {
      user: { id: base.id, name: base.name, phone: base.phone_e164 },
      purpose: 'join',
      org: await orgNames(ctx),
      createdBy: by,
    });
    await ctx.db.batch([
      ...invite.stmts,
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'invite.create',
        entity: 'invite',
        entityId: invite.id,
        after: {
          userId: base.id,
          purpose: 'join',
          reissue: true,
          expiresAt: invite.view.expiresAt,
        },
      }),
    ]);
    return { invite: invite.view };
  },

  async ownerStaffResetPin({ params }, ctx) {
    const by = actorId(ctx);
    const base = await staffBase(ctx, params.id);
    assertNotExited(base);
    // Someone who never joined has no PIN to reset: they get a fresh join invite.
    const purpose = base.status === 'invited' ? 'join' : 'pin_reset';
    const invite = await issueInvite(ctx, {
      user: { id: base.id, name: base.name, phone: base.phone_e164 },
      purpose,
      org: await orgNames(ctx),
      createdBy: by,
    });
    const stmts: D1PreparedStatement[] = [];
    if (purpose === 'pin_reset') {
      // The old PIN stops working and sessions end; approved phones stay approved (PRD 4.1.6).
      stmts.push(clearPinStmt(ctx, base.id, {}), revokeUserSessionsStmt(ctx, base.id));
    }
    stmts.push(
      ...invite.stmts,
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: purpose === 'pin_reset' ? 'auth.pin_reset' : 'invite.create',
        entity: 'user',
        entityId: base.id,
        after: { inviteId: invite.id, purpose, expiresAt: invite.view.expiresAt },
      }),
    );
    await ctx.db.batch(stmts);
    return { invite: invite.view };
  },

  async ownerStaffExit({ params, body }, ctx) {
    const by = actorId(ctx);
    const base = await staffBase(ctx, params.id);
    if (base.status === 'exited')
      fail('CONFLICT', `${firstName(base.name)} is already marked as left.`);
    const now = ctx.now();
    const devices = await ctx.db.all<{ id: string }>(
      `SELECT id FROM devices WHERE org_id = ?org AND user_id = ? AND status IN ('approved', 'pending')`,
      base.id,
    );
    const stmts: D1PreparedStatement[] = [
      ctx.db.update(
        'users',
        {
          status: 'exited',
          exited_at: now,
          role: 'staff',
          permissions_json: null,
          updated_at: now,
        },
        'id = ?',
        base.id,
      ),
      ctx.db.update(
        'staff_profiles',
        { exit_date: body.lastDay, exit_reason: body.reason, updated_at: now },
        'user_id = ?',
        base.id,
      ),
    ];
    for (const d of devices) stmts.push(...revokeDeviceStmts(ctx, d.id, 'exit', by));
    stmts.push(
      revokeUserSessionsStmt(ctx, base.id),
      revokeInvitesStmt(ctx, base.id),
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'staff.exit',
        entity: 'user',
        entityId: base.id,
        before: { status: base.status, role: base.role },
        after: { status: 'exited', lastDay: body.lastDay, devicesRevoked: devices.length },
        reason: body.reason,
      }),
    );
    await ctx.db.batch(stmts);
    return loadStaffDetail(ctx, base.id);
  },

  async ownerStaffRehire({ params, body }, ctx) {
    const by = actorId(ctx);
    const base = await staffBase(ctx, params.id);
    if (base.status !== 'exited') fail('CONFLICT', `${firstName(base.name)} is still on the team.`);
    if (base.phone_e164)
      await assertPhoneFree(ctx, base.phone_e164, { exceptId: base.id, offerRehire: false });
    await assertUnderCap(ctx);
    const now = ctx.now();
    const invite = await issueInvite(ctx, {
      user: { id: base.id, name: base.name, phone: base.phone_e164 },
      purpose: 'join',
      org: await orgNames(ctx),
      createdBy: by,
    });
    await ctx.db.batch([
      clearPinStmt(ctx, base.id, { status: 'invited', exited_at: null }),
      ctx.db.update(
        'staff_profiles',
        { join_date: body.joinDate, exit_date: null, exit_reason: null, updated_at: now },
        'user_id = ?',
        base.id,
      ),
      ...invite.stmts,
      ctx.services.audit.stmt(ctx, {
        category: 'change',
        action: 'staff.rehire',
        entity: 'user',
        entityId: base.id,
        before: { status: 'exited', joinDate: base.join_date, exitDate: base.exit_date },
        after: { status: 'invited', joinDate: body.joinDate, inviteId: invite.id },
      }),
    ]);
    return { staff: await loadStaffDetail(ctx, base.id), invite: invite.view };
  },

  // ---- Devices (PRD 4.1.5) ------------------------------------------------------------------------

  async ownerDeviceDecide({ params, body }, ctx) {
    const by = actorId(ctx);
    const device = await getDevice(ctx, params.id);
    if (!device) fail('NOT_FOUND');
    if (device.status !== 'pending') fail('ALREADY_DECIDED');
    const person = await ctx.db.first<{ status: string }>(
      'SELECT status FROM users WHERE org_id = ?org AND id = ?',
      device.user_id,
    );
    if (!person || person.status === 'exited')
      fail('CONFLICT', 'This person has left. Their phone cannot be approved.');
    const approve = body.decision === 'approve';
    const stmts = approve
      ? await approveDeviceStmts(ctx, device, by)
      : rejectDeviceStmts(ctx, device, by);
    stmts.push(
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: approve ? 'device.approve' : 'device.reject',
        entity: 'device',
        entityId: device.id,
        before: { status: 'pending' },
        after: { status: approve ? 'approved' : 'rejected', userId: device.user_id },
        reason: body.note ?? null,
      }),
    );
    await ctx.db.batch(stmts);
    const decided = await getDevice(ctx, device.id);
    if (!decided) fail('NOT_FOUND');
    await ctx.services.notifier.emit(ctx, {
      type: 'device_decided',
      orgId: device.org_id,
      at: ctx.now(),
      userId: device.user_id,
      deviceId: device.id,
      decision: approve ? 'approved' : 'rejected',
    });
    return deviceView(decided);
  },

  async ownerDeviceRevoke({ params, body }, ctx) {
    const by = actorId(ctx);
    const device = await getDevice(ctx, params.id);
    if (!device) fail('NOT_FOUND');
    if (device.status !== 'approved' && device.status !== 'pending')
      fail('CONFLICT', 'This phone is already removed.');
    await ctx.db.batch([
      ...revokeDeviceStmts(ctx, device.id, body.reason, by),
      ctx.services.audit.stmt(ctx, {
        category: 'security',
        action: 'device.revoke',
        entity: 'device',
        entityId: device.id,
        before: { status: device.status },
        after: { status: 'revoked', userId: device.user_id },
        reason: body.reason,
      }),
    ]);
    const revoked = await getDevice(ctx, device.id);
    if (!revoked) fail('NOT_FOUND');
    return deviceView(revoked);
  },
};
