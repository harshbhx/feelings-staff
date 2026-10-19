import type {
  AbsSegment,
  DaySchedule,
  DayType,
  HolidayRule,
  OrgCalendar,
  PersonPolicy,
  TemplateRule,
} from '@fs/contracts';
import { hhmmToMin, istStartOfDay, MINUTE_MS, weekday } from '@fs/contracts';

const DAY_MIN = 1440;
/** Night hours (PRD 7.11): a segment that starts before 06:00 or ends after 21:00. */
const NIGHT_BEFORE = 6 * 60;
const NIGHT_AFTER = 21 * 60;

/**
 * Segment offsets in minutes from IST midnight of the work date. Segments are sequential: an end
 * at or before its start is past midnight, and a start before the previous end rolls to the next day
 * (so 22:00-23:00 + 00:30-02:00 is one night).
 */
export function segmentOffsets(template: Pick<TemplateRule, 'segments'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let floor = 0;
  for (const seg of template.segments) {
    let start = hhmmToMin(seg.start);
    while (start < floor) start += DAY_MIN;
    let end = hhmmToMin(seg.end);
    while (end <= start) end += DAY_MIN;
    out.push([start, end]);
    floor = end;
  }
  return out;
}

/** S_day of a template: sum of segment minutes minus the unpaid break, never below 0 (PRD 7.3). */
export function templateMinutes(template: Pick<TemplateRule, 'segments' | 'breakMin'>): number {
  const span = segmentOffsets(template).reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.max(0, span - template.breakMin);
}

/** True when any segment starts before 06:00 or ends after 21:00 (PRD 7.11). */
export function hasNightHours(template: Pick<TemplateRule, 'segments'>): boolean {
  return segmentOffsets(template).some(([s, e]) => s % DAY_MIN < NIGHT_BEFORE || e > NIGHT_AFTER);
}

interface Base {
  userId: string;
  workDate: string;
  stdMin: number;
}

function workDay(base: Base, template: TemplateRule): DaySchedule {
  const midnight = istStartOfDay(base.workDate);
  const segments: AbsSegment[] = segmentOffsets(template).map(([s, e]) => ({
    startTs: midnight + s * MINUTE_MS,
    endTs: midnight + e * MINUTE_MS,
  }));
  return {
    ...base,
    dayType: 'work',
    templateId: template.id,
    templateName: template.name,
    segments,
    breakMin: template.breakMin,
    scheduledMin: templateMinutes(template),
    holiday: null,
    nightHours: hasNightHours(template),
  };
}

/**
 * WO, HO or NE. Off days keep the default template's break allowance so presence on them gets the
 * automatic break rule (PRD 7.7); NE days carry nothing.
 */
function offDay(
  base: Base,
  dayType: Exclude<DayType, 'work'>,
  breakMin: number,
  holiday: HolidayRule | null,
): DaySchedule {
  return {
    ...base,
    dayType,
    templateId: null,
    templateName: null,
    segments: [],
    breakMin,
    scheduledMin: 0,
    holiday,
    nightHours: false,
  };
}

/**
 * Schedule for a person-day (PRD 7.3). First match wins: NE, roster override, holiday, weekly off,
 * default template. A roster "no shift" is an off day like a week-off (paid for monthly staff,
 * unpaid for daily-wage staff unless the setting says so).
 */
export function resolveSchedule(person: PersonPolicy, date: string, ctx: OrgCalendar): DaySchedule {
  const base: Base = {
    userId: person.userId,
    workDate: date,
    stdMin: templateMinutes(person.defaultTemplate),
  };
  if (date < person.joinDate || (person.exitDate !== null && date > person.exitDate)) {
    return offDay(base, 'NE', 0, null);
  }
  const offBreak = person.defaultTemplate.breakMin;
  const roster = ctx.rosterOverrides.find((o) => o.date === date);
  if (roster !== undefined) {
    if (roster.kind === 'template') return workDay(base, roster.template ?? person.defaultTemplate);
    return offDay(base, 'WO', offBreak, null);
  }
  const holiday = ctx.holidays.find((h) => h.date === date);
  if (holiday !== undefined) return offDay(base, 'HO', offBreak, holiday);
  if (person.weekOffDow !== null && weekday(date) === person.weekOffDow) {
    return offDay(base, 'WO', offBreak, null);
  }
  return workDay(base, person.defaultTemplate);
}
