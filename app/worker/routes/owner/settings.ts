/** Owner settings, setup checklist and audit log (WP-1; PRD 4.15.1, 4.17, 10.7). */
import {
  type AuditEntryView,
  normaliseIndianPhone,
  OrgSettings,
  type OrgSettingsPatch,
  type SettingsView,
  type SetupProgress,
} from '@fs/contracts';
import { json } from '../../db';
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { loadOrg, type OrgRow } from '../../lib/settings';
import type { Ctx } from '../../services/ports';

function view(ctx: Ctx, org: OrgRow, settings: OrgSettings): SettingsView {
  return {
    org: {
      name: org.name,
      address: org.address,
      phone: org.phone_e164,
      ownerDisplayName: org.owner_display_name,
      logo: 'bindi',
    },
    settings,
    settingsVersion: org.settings_version,
    minAppVersion: ctx.env.MIN_APP_VERSION,
    updatedAt: org.updated_at,
  };
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Nested objects (minimumWage, fines) merge; discriminated unions (overtime.rate) are replaced whole. */
function mergeValue(prev: unknown, next: unknown): unknown {
  if (isPlainObject(prev) && isPlainObject(next) && !('mode' in next)) return { ...prev, ...next };
  return next;
}

/** Apply a section-level shallow patch (pay.minimumWage and pay.fines merge one level deeper). */
export function applySettingsPatch(current: OrgSettings, patch: OrgSettingsPatch): OrgSettings {
  const next = structuredClone(current) as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(patch)) {
    if (!values) continue;
    const target = next[section] ?? {};
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (v === undefined) continue;
      target[k] = mergeValue(target[k], v);
    }
    next[section] = target;
  }
  const parsed = OrgSettings.safeParse(next);
  if (!parsed.success) {
    fail('VALIDATION', 'Some settings need fixing.', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

function needsStepUp(before: OrgSettings, after: OrgSettings): boolean {
  return (
    before.attendance.strongMode !== after.attendance.strongMode ||
    before.risk.flagAt !== after.risk.flagAt ||
    before.risk.proofAt !== after.risk.proofAt ||
    before.timeCredits.enabled !== after.timeCredits.enabled ||
    before.timeCredits.legalOt2x !== after.timeCredits.legalOt2x ||
    before.presence.enabled !== after.presence.enabled
  );
}

async function saveSettings(
  ctx: Ctx,
  org: OrgRow,
  before: OrgSettings,
  after: OrgSettings,
  reason: string,
) {
  const now = ctx.now();
  await ctx.sys.batch([
    ctx.sys.stmt(
      'UPDATE orgs SET settings_json = ?1, settings_version = settings_version + 1, updated_at = ?2 WHERE id = ?3',
      JSON.stringify(after),
      now,
      org.id,
    ),
    ctx.services.audit.stmt(ctx, {
      category: 'change',
      action: 'settings.update',
      entity: 'org_settings',
      entityId: org.id,
      before,
      after,
      reason,
    }),
  ]);
}

const setupComplete = (s: SetupProgress) => Object.values(s).every((v) => v !== 'todo');

export const handlers: Handlers = {
  async ownerSettingsGet(_input, ctx) {
    const { org, settings } = await loadOrg(ctx);
    return view(ctx, org, settings);
  },

  async ownerSettingsPatch({ body }, ctx) {
    const { org, settings: before } = await loadOrg(ctx);
    const after = body.settings ? applySettingsPatch(before, body.settings) : before;
    if (needsStepUp(before, after)) await ctx.services.stepUp.require(ctx);
    if (after.risk.flagAt >= after.risk.proofAt) {
      fail('VALIDATION', 'The flag threshold must be lower than the proof threshold.');
    }
    if (body.org) {
      const o = body.org;
      let phone = org.phone_e164;
      if (o.phone !== undefined) {
        phone = o.phone === null ? null : normaliseIndianPhone(o.phone);
        if (o.phone !== null && !phone)
          fail('VALIDATION', 'Enter a 10-digit Indian mobile number.');
      }
      const beforeOrg = {
        name: org.name,
        address: org.address,
        phone: org.phone_e164,
        ownerDisplayName: org.owner_display_name,
      };
      const afterOrg = {
        name: o.name ?? org.name,
        address: o.address !== undefined ? o.address : org.address,
        phone,
        ownerDisplayName: o.ownerDisplayName ?? org.owner_display_name,
      };
      await ctx.sys.batch([
        ctx.sys.stmt(
          'UPDATE orgs SET name = ?1, address = ?2, phone_e164 = ?3, owner_display_name = ?4, updated_at = ?5 WHERE id = ?6',
          afterOrg.name,
          afterOrg.address,
          afterOrg.phone,
          afterOrg.ownerDisplayName,
          ctx.now(),
          org.id,
        ),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'org.update',
          entity: 'org',
          entityId: org.id,
          before: beforeOrg,
          after: afterOrg,
        }),
      ]);
    }
    if (body.settings) await saveSettings(ctx, org, before, after, 'owner edit');
    const fresh = await loadOrg(ctx);
    return view(ctx, fresh.org, fresh.settings);
  },

  async ownerSetupGet(_input, ctx) {
    const { settings } = await loadOrg(ctx);
    return { steps: settings.setup, complete: setupComplete(settings.setup) };
  },

  async ownerSetupStep({ params, body }, ctx) {
    const { org, settings } = await loadOrg(ctx);
    const after: OrgSettings = {
      ...settings,
      setup: { ...settings.setup, [params.step]: body.state },
    };
    await saveSettings(ctx, org, settings, after, `setup step ${params.step}`);
    return { steps: after.setup, complete: setupComplete(after.setup) };
  },

  async ownerAudit({ query }, ctx) {
    const where: string[] = ['a.org_id = ?org'];
    const args: (string | number)[] = [];
    if (query.entity) {
      where.push('a.entity = ?');
      args.push(query.entity);
    }
    if (query.entityId) {
      where.push('a.entity_id = ?');
      args.push(query.entityId);
    }
    if (query.category) {
      where.push('a.category = ?');
      args.push(query.category);
    }
    if (query.from) {
      where.push('a.created_at >= ?');
      args.push(Date.parse(`${query.from}T00:00:00+05:30`));
    }
    if (query.to) {
      where.push('a.created_at < ?');
      args.push(Date.parse(`${query.to}T00:00:00+05:30`) + 86_400_000);
    }
    if (query.cursor) {
      const [ts, id] = query.cursor.split('_');
      where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))');
      args.push(Number(ts), Number(ts), id ?? '');
    }
    const rows = await ctx.db.all<{
      id: string;
      category: AuditEntryView['category'];
      actor_type: AuditEntryView['actorType'];
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      before_json: string | null;
      after_json: string | null;
      reason: string | null;
      created_at: number;
    }>(
      `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT 51`,
      ...args,
    );
    const page = rows.slice(0, 50);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        category: r.category,
        actorType: r.actor_type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        before: json<unknown>(r.before_json, null),
        after: json<unknown>(r.after_json, null),
        reason: r.reason,
        createdAt: r.created_at,
      })),
      nextCursor: rows.length > 50 && last ? `${last.created_at}_${last.id}` : null,
    };
  },
};
