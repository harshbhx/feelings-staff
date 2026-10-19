import type { DaySchedule, OrgCalendar, PersonPolicy, TemplateRule } from '@fs/contracts';
import { DaySchedule as DayScheduleSchema } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { hasNightHours, resolveSchedule, segmentOffsets, templateMinutes } from '../src/schedule';
import { at, NO_CAL, person, SUN, TPL, TUE, WED } from './fixtures';

const GANDHI = '2026-10-02'; // a Friday
const holiday = (date: string): OrgCalendar['holidays'][number] => ({
  date,
  name: 'Gandhi Jayanti',
  paid: true,
  workedComp: 'extra_pay',
});
const roster = (
  date: string,
  kind: 'template' | 'week_off' | 'no_shift',
  template: TemplateRule | null = null,
): OrgCalendar['rosterOverrides'][number] => ({ date, kind, template });

interface Row {
  name: string;
  date: string;
  person?: Partial<PersonPolicy>;
  cal?: OrgCalendar;
  expect: Partial<DaySchedule>;
}

const rows: Row[] = [
  {
    name: 'NE before joining',
    date: '2026-10-11',
    person: { joinDate: '2026-10-12' },
    expect: { dayType: 'NE', segments: [], scheduledMin: 0, stdMin: 540, breakMin: 0 },
  },
  {
    name: 'NE after the exit date',
    date: '2026-10-21',
    person: { exitDate: '2026-10-20' },
    expect: { dayType: 'NE', templateId: null, holiday: null },
  },
  {
    name: 'employed on the joining day',
    date: '2026-10-12',
    person: { joinDate: '2026-10-12' },
    expect: { dayType: 'work', scheduledMin: 540 },
  },
  {
    name: 'employed on the exit day',
    date: '2026-10-19',
    person: { exitDate: '2026-10-19' },
    expect: { dayType: 'work' },
  },
  {
    name: 'roster override beats holiday',
    date: GANDHI,
    cal: {
      holidays: [holiday(GANDHI)],
      rosterOverrides: [roster(GANDHI, 'template', TPL.morning)],
    },
    expect: { dayType: 'work', templateId: TPL.morning.id, scheduledMin: 300, holiday: null },
  },
  {
    name: 'roster week-off on a working day',
    date: WED,
    cal: { holidays: [], rosterOverrides: [roster(WED, 'week_off')] },
    expect: { dayType: 'WO', segments: [], scheduledMin: 0, breakMin: 60 },
  },
  {
    name: 'roster "no shift" is an off day',
    date: WED,
    cal: { holidays: [], rosterOverrides: [roster(WED, 'no_shift')] },
    expect: { dayType: 'WO', templateName: null },
  },
  {
    name: 'roster working day on the weekly off without a template uses the default',
    date: TUE,
    cal: { holidays: [], rosterOverrides: [roster(TUE, 'template')] },
    expect: { dayType: 'work', templateId: TPL.full.id, scheduledMin: 540 },
  },
  {
    name: 'holiday beats week-off',
    date: GANDHI,
    person: { weekOffDow: 5 },
    cal: { holidays: [holiday(GANDHI)], rosterOverrides: [] },
    expect: { dayType: 'HO', holiday: holiday(GANDHI), breakMin: 60, scheduledMin: 0 },
  },
  {
    name: 'week-off',
    date: TUE,
    expect: { dayType: 'WO', templateId: null, stdMin: 540 },
  },
  {
    name: 'default template',
    date: WED,
    expect: {
      dayType: 'work',
      templateId: TPL.full.id,
      templateName: 'Full day',
      segments: [{ startTs: at(WED, '10:00'), endTs: at(WED, '20:00') }],
      breakMin: 60,
      scheduledMin: 540,
      stdMin: 540,
      nightHours: false,
    },
  },
  {
    name: 'no weekly off set',
    date: TUE,
    person: { weekOffDow: null },
    expect: { dayType: 'work' },
  },
  {
    name: 'split template',
    date: WED,
    person: { defaultTemplate: TPL.split },
    expect: {
      dayType: 'work',
      segments: [
        { startTs: at(WED, '10:00'), endTs: at(WED, '14:00') },
        { startTs: at(WED, '17:00'), endTs: at(WED, '21:00') },
      ],
      scheduledMin: 480,
      stdMin: 480,
      nightHours: false,
    },
  },
  {
    name: 'template crossing midnight',
    date: WED,
    cal: { holidays: [], rosterOverrides: [roster(WED, 'template', TPL.night)] },
    expect: {
      segments: [{ startTs: at(WED, '22:00'), endTs: at(WED, '02:00', 1) }],
      scheduledMin: 240,
      stdMin: 540,
      nightHours: true,
    },
  },
  {
    name: 'Sunday template keeps S_std of the default template',
    date: SUN,
    cal: { holidays: [], rosterOverrides: [roster(SUN, 'template', TPL.sunday)] },
    expect: { scheduledMin: 180, stdMin: 540, breakMin: 0 },
  },
];

describe('resolveSchedule (PRD 7.3, 14.2 schedule resolution)', () => {
  it.each(rows)('$name', (row) => {
    const s = resolveSchedule(person(row.person), row.date, row.cal ?? NO_CAL);
    expect(s).toMatchObject({ userId: person().userId, workDate: row.date, ...row.expect });
    expect(() => DayScheduleSchema.parse(s)).not.toThrow();
  });
});

describe('template helpers', () => {
  const tpl = (segments: Array<[string, string]>, breakMin = 0) => ({
    segments: segments.map(([start, end]) => ({ start, end })),
    breakMin,
  });

  it.each([
    { name: 'one day segment', t: tpl([['10:00', '20:00']]), offsets: [[600, 1200]] },
    { name: 'end past midnight', t: tpl([['22:00', '02:00']]), offsets: [[1320, 1560]] },
    {
      name: 'second segment after midnight',
      t: tpl([
        ['20:00', '23:00'],
        ['00:30', '02:00'],
      ]),
      offsets: [
        [1200, 1380],
        [1470, 1560],
      ],
    },
    {
      name: 'end equal to start is a full day',
      t: tpl([['10:00', '10:00']]),
      offsets: [[600, 2040]],
    },
  ])('segmentOffsets: $name', ({ t, offsets }) => {
    expect(segmentOffsets(t)).toEqual(offsets);
  });

  it.each([
    { t: tpl([['10:00', '20:00']], 60), min: 540 },
    { t: tpl([['10:00', '13:00']]), min: 180 },
    {
      t: tpl([
        ['20:00', '23:00'],
        ['00:30', '02:00'],
      ]),
      min: 270,
    },
    { t: tpl([['10:00', '10:30']], 60), min: 0 },
  ])('templateMinutes is S_day = segments - break, never negative ($min)', ({ t, min }) => {
    expect(templateMinutes(t)).toBe(min);
  });

  it.each([
    { name: 'day shift', t: tpl([['10:00', '20:00']]), night: false },
    { name: 'ends exactly 21:00', t: tpl([['17:00', '21:00']]), night: false },
    { name: 'ends after 21:00', t: tpl([['17:00', '21:30']]), night: true },
    { name: 'starts before 06:00', t: tpl([['05:00', '10:00']]), night: true },
    { name: 'starts exactly 06:00', t: tpl([['06:00', '12:00']]), night: false },
    { name: 'after midnight', t: tpl([['22:00', '02:00']]), night: true },
  ])('night hours (PRD 7.11): $name', ({ t, night }) => {
    expect(hasNightHours(t)).toBe(night);
  });
});
