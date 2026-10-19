/**
 * Tenant isolation framework (PRD 10.8). Seeds a second org and checks that no owner route returns
 * the other org's data: GET routes must answer 404 (or 501 while unbuilt), never 200 with data.
 * Packages add rows for their tables to `seedOtherOrg` when they add routes that read them.
 */
import { ENDPOINT_KEYS, type EndpointShape, endpoints } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { ulid } from '../lib/ulid';
import { call, resetScenario, sessionFor, testEnv } from './helpers';

async function seedOtherOrg(): Promise<Record<string, string>> {
  const now = Date.now();
  const orgId = ulid(now);
  const ownerId = ulid(now);
  const staffId = ulid(now);
  const siteId = ulid(now);
  const templateId = ulid(now);
  const db = testEnv.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO orgs (id, name, slug, timezone, owner_display_name, settings_json, created_at, updated_at)
         VALUES (?1, 'Other Salon', 'other', 'Asia/Kolkata', 'Asha', '{}', ?2, ?2)`,
      )
      .bind(orgId, now),
    db
      .prepare(
        `INSERT INTO users (id, org_id, role, name, email, status, created_at, updated_at)
         VALUES (?1, ?2, 'owner', 'Asha Owner', 'asha@other.test', 'active', ?3, ?3)`,
      )
      .bind(ownerId, orgId, now),
    db
      .prepare(
        `INSERT INTO users (id, org_id, role, name, phone_e164, status, created_at, updated_at)
         VALUES (?1, ?2, 'staff', 'Rina Other', '+919900000001', 'active', ?3, ?3)`,
      )
      .bind(staffId, orgId, now),
    db
      .prepare(
        `INSERT INTO shift_templates (id, org_id, name, segments_json, break_min, created_at, updated_at)
         VALUES (?1, ?2, 'Full day', '[{"start":"10:00","end":"20:00"}]', 60, ?3, ?3)`,
      )
      .bind(templateId, orgId, now),
    db
      .prepare(
        `INSERT INTO sites (id, org_id, kind, name, lat, lng, radius_m, max_accuracy_m, created_by, created_at, updated_at)
         VALUES (?1, ?2, 'salon', 'Other Salon', 22.3, 70.7, 100, 50, ?3, ?4, ?4)`,
      )
      .bind(siteId, orgId, ownerId, now),
  ]);
  return { orgId, ownerId, staffId, siteId, templateId };
}

describe('tenant isolation (PRD 10.8)', () => {
  it("never returns another org's records from owner GET routes", async () => {
    const s = await resetScenario('basic-salon');
    const other = await seedOtherOrg();
    const owner = await sessionFor(s.ownerId, { stepUp: true });
    const failures: string[] = [];
    for (const key of ENDPOINT_KEYS) {
      const def = endpoints[key] as EndpointShape;
      if (def.method !== 'GET' || !/:(id|userId)\b/.test(def.path)) continue;
      const path = def.path
        .replace(':userId', other.staffId as string)
        .replace(':id', other.staffId as string)
        .replace(':date', '2026-10-19');
      const res = await call('GET', path, { cookie: owner });
      if (![400, 403, 404, 501].includes(res.status)) failures.push(`${key} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
