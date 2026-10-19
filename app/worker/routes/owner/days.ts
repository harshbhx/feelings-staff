/** Owner day detail, override and the evidence behind it: selfies and enrolled photos (PRD 4.12, 10.4). */
import type { Handlers } from '../../lib/api';
import { fail } from '../../lib/errors';
import { overrideDay, ownerDayDetail } from '../../services/owner-days';
import type { Ctx } from '../../services/ports';
import { punchById } from '../../services/punch';

async function image(ctx: Ctx, key: string, entity: 'punch' | 'staff', id: string) {
  const object = await ctx.env.MEDIA.get(key);
  if (!object) return fail('NOT_FOUND');
  await ctx.services.audit.log(ctx, {
    category: 'access',
    action: entity === 'punch' ? 'selfie.view' : 'enrolled_photo.view',
    entity,
    entityId: id,
  });
  return new Response(object.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
  });
}

export const handlers: Handlers = {
  async ownerDay({ params }, ctx) {
    return ownerDayDetail(ctx, params.userId, params.date);
  },

  async ownerDayOverride({ params, body }, ctx) {
    return overrideDay(ctx, params.userId, params.date, body);
  },

  async ownerPunchSelfie({ params }, ctx) {
    const p = await punchById(ctx, params.id);
    if (!p?.selfie_key || p.selfie_deleted_at !== null) return fail('NOT_FOUND');
    return image(ctx, p.selfie_key, 'punch', p.id);
  },

  async ownerStaffPhoto({ params }, ctx) {
    const row = await ctx.db.first<{ enrolled_photo_key: string | null }>(
      'SELECT enrolled_photo_key FROM staff_profiles WHERE org_id = ?org AND user_id = ?',
      params.id,
    );
    if (!row?.enrolled_photo_key) return fail('NOT_FOUND');
    return image(ctx, row.enrolled_photo_key, 'staff', params.id);
  },
};
