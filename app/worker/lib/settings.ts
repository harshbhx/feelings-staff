/** Org settings loader (WP-1). Every package reads rules through this, never by parsing JSON itself. */
import { DEFAULT_ORG_SETTINGS, OrgSettings } from '@fs/contracts';
import type { Ctx } from '../services/ports';

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  owner_display_name: string;
  address: string | null;
  phone_e164: string | null;
  settings_json: string;
  settings_version: number;
  created_at: number;
  updated_at: number;
}

/** Fill sections missing from stored JSON with defaults, then validate. */
export function normaliseSettings(stored: unknown): OrgSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const [section, defaults] of Object.entries(DEFAULT_ORG_SETTINGS)) {
    const value = s[section];
    merged[section] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(defaults as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : defaults;
  }
  const parsed = OrgSettings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_ORG_SETTINGS;
}

export async function loadOrg(ctx: Ctx): Promise<{ org: OrgRow; settings: OrgSettings }> {
  if (!ctx.orgId) throw new Error('loadOrg without an org');
  const org = await ctx.sys.first<OrgRow>('SELECT * FROM orgs WHERE id = ?1', ctx.orgId);
  if (!org) throw new Error('Org not found');
  let raw: unknown = {};
  try {
    raw = JSON.parse(org.settings_json);
  } catch {
    raw = {};
  }
  return { org, settings: normaliseSettings(raw) };
}

export async function loadSettings(ctx: Ctx): Promise<OrgSettings> {
  return (await loadOrg(ctx)).settings;
}
