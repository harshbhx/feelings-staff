/**
 * Who is scheduled when (PRD 7.3), as much as notifications need: the shift segments of every
 * active person for one date, plus approved leave and off-site duties. The pay engine (WP-5) owns
 * the authoritative schedule; this reads the same tables for reminders and the 5-minute rules.
 * Owner: WP-8.
 */
import { istToEpoch, weekday } from '@fs/contracts';
import { json } from '../db';
import type { Ctx } from './ports';

export interface Segment {
  start: string;
  end: string;
  startTs: number;
  endTs: number;
}

export interface Duty {
  id: string;
  startTs: number;
  endTs: number;
  placeName: string;
  createdAt: number;
}

export interface PersonDay {
  userId: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
  lang: 'en' | 'gu';
  date: string;
  /** `work` has segments; the others explain why not. */
  kind: 'work' | 'week_off' | 'holiday' | 'leave' | 'none';
  segments: Segment[];
  duties: Duty[];
}

interface PersonRow {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'staff';
  lang: 'en' | 'gu';
  default_template_id: string;
  week_off_dow: number | null;
}

interface TemplateRow {
  id: string;
  segments_json: string;
}

/** Turn `[{start, end}]` into instants; an end at or before the start means past midnight. */
export function toSegments(date: string, raw: { start: string; end: string }[]): Segment[] {
  return raw.map((s) => ({
    start: s.start,
    end: s.end,
    startTs: istToEpoch(date, s.start),
    endTs: istToEpoch(date, s.end, s.end <= s.start ? 1 : 0),
  }));
}

/** Everyone who is employed on `date`, with the shifts they are expected to work. */
export async function loadPersonDays(
  ctx: Ctx,
  date: string,
  only?: readonly string[],
): Promise<PersonDay[]> {
  const people = await ctx.db.all<PersonRow>(
    `SELECT u.id, u.name, u.role, u.lang, p.default_template_id, p.week_off_dow
       FROM users u JOIN staff_profiles p ON p.user_id = u.id
      WHERE u.org_id = ?org AND u.status = 'active' AND p.join_date <= ?
        AND (p.exit_date IS NULL OR p.exit_date >= ?)`,
    date,
    date,
  );
  const wanted = only ? people.filter((p) => only.includes(p.id)) : people;
  if (wanted.length === 0) return [];

  const [templates, overrides, holiday, leaves, duties] = await Promise.all([
    ctx.db.all<TemplateRow>('SELECT id, segments_json FROM shift_templates WHERE org_id = ?org'),
    ctx.db.all<{ user_id: string; kind: string; template_id: string | null }>(
      'SELECT user_id, kind, template_id FROM roster_overrides WHERE org_id = ?org AND work_date = ?',
      date,
    ),
    ctx.db.first<{ id: string }>('SELECT id FROM holidays WHERE org_id = ?org AND date = ?', date),
    ctx.db.all<{ user_id: string }>(
      `SELECT user_id FROM leave_requests
        WHERE org_id = ?org AND status = 'approved' AND from_date <= ? AND to_date >= ?`,
      date,
      date,
    ),
    ctx.db.all<{
      id: string;
      user_id: string;
      start_ts: number;
      end_ts: number;
      place_name: string;
      created_at: number;
    }>(
      `SELECT d.id, s.user_id, d.start_ts, d.end_ts, d.place_name, d.created_at
         FROM offsite_duties d JOIN offsite_duty_staff s ON s.duty_id = d.id
        WHERE d.org_id = ?org AND d.work_date = ? AND d.cancelled_at IS NULL`,
      date,
    ),
  ]);
  const tpl = new Map(templates.map((t) => [t.id, t]));
  const override = new Map(overrides.map((o) => [o.user_id, o]));
  const onLeave = new Set(leaves.map((l) => l.user_id));
  const dow = weekday(date);

  return wanted.map((p): PersonDay => {
    const base = {
      userId: p.id,
      name: p.name,
      role: p.role,
      lang: p.lang,
      date,
      duties: duties
        .filter((d) => d.user_id === p.id)
        .map((d) => ({
          id: d.id,
          startTs: d.start_ts,
          endTs: d.end_ts,
          placeName: d.place_name,
          createdAt: d.created_at,
        })),
    };
    const o = override.get(p.id);
    let kind: PersonDay['kind'] = 'work';
    let templateId: string | null = o?.kind === 'template' ? o.template_id : p.default_template_id;
    if (o?.kind === 'week_off') kind = 'week_off';
    else if (o?.kind === 'no_shift') kind = 'none';
    else if (o?.kind !== 'template') {
      if (holiday) kind = 'holiday';
      else if (p.week_off_dow === dow) kind = 'week_off';
    }
    if (kind === 'work' && onLeave.has(p.id)) kind = 'leave';
    templateId = kind === 'work' ? templateId : null;
    const raw = templateId
      ? json<{ start: string; end: string }[]>(tpl.get(templateId)?.segments_json, [])
      : [];
    return { ...base, kind, segments: kind === 'work' ? toSegments(date, raw) : [] };
  });
}

/** Shift +/- 2 h, plus any duty the person has that day (PRD 6: staff reminders). */
export function inReminderWindow(day: PersonDay, at: number): boolean {
  const pad = 2 * 3_600_000;
  return [...day.segments, ...day.duties].some((s) => at >= s.startTs - pad && at <= s.endTs + pad);
}

export const firstStart = (d: PersonDay): Segment | undefined => d.segments[0];
export const lastEnd = (d: PersonDay): Segment | undefined => d.segments[d.segments.length - 1];
