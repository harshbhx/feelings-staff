/**
 * Off-site duty form (PRD 4.6 A, O-11): staff, date, start and end (may cross midnight), place,
 * location by current position, map pick or a pasted Google Maps link, radius 100-500 m, mode and
 * the overtime toggle. Produces the DutyCreate body.
 */
import type { DutyCreate, OffsiteMode } from '@fs/contracts';
import { hhmmToMin, istToEpoch } from '@fs/contracts';

export const RADIUS_MIN = 100;
export const RADIUS_MAX = 500;
export const RADIUS_STEP = 25;
export const RADIUS_DEFAULT = 200;

export type LocationSource = 'current' | 'map' | 'link';

export interface DutyFormValues {
  staffIds: string[];
  workDate: string;
  start: string;
  end: string;
  placeName: string;
  location: { lat: number; lng: number; source: LocationSource; accuracyM?: number } | null;
  radiusM: number;
  mode: OffsiteMode;
  otPreapproved: boolean;
  note: string;
}

export type DutyField = 'staffIds' | 'workDate' | 'times' | 'placeName' | 'location';

export function emptyDutyForm(date: string, staffIds: string[] = []): DutyFormValues {
  return {
    staffIds,
    workDate: date,
    start: '10:00',
    end: '20:00',
    placeName: '',
    location: null,
    radiusM: RADIUS_DEFAULT,
    mode: 'geofence',
    otPreapproved: true,
    note: '',
  };
}

/** Start and end as instants; an end at or before the start means the next day (04:00 -> 01:00). */
export function dutyWindow(v: Pick<DutyFormValues, 'workDate' | 'start' | 'end'>) {
  const startTs = istToEpoch(v.workDate, v.start);
  const crosses = hhmmToMin(v.end) <= hhmmToMin(v.start);
  const endTs = istToEpoch(v.workDate, v.end, crosses ? 1 : 0);
  return { startTs, endTs, crossesMidnight: crosses };
}

export function clampRadius(m: number): number {
  const snapped = Math.round(m / RADIUS_STEP) * RADIUS_STEP;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, snapped));
}

export function validateDuty(v: DutyFormValues): Partial<Record<DutyField, string>> {
  const errors: Partial<Record<DutyField, string>> = {};
  if (v.staffIds.length === 0) errors.staffIds = 'owner:duty.errors.staff';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.workDate)) errors.workDate = 'owner:duty.errors.date';
  if (!/^\d{2}:\d{2}$/.test(v.start) || !/^\d{2}:\d{2}$/.test(v.end) || v.start === v.end)
    errors.times = 'owner:duty.errors.times';
  if (!v.placeName.trim()) errors.placeName = 'owner:duty.errors.place';
  // "Anywhere" records the location but has no fence, so a location is optional there.
  if (v.mode !== 'anywhere' && !v.location) errors.location = 'owner:duty.errors.location';
  return errors;
}

export function toDutyCreate(v: DutyFormValues): DutyCreate {
  const { startTs, endTs } = dutyWindow(v);
  const note = v.note.trim();
  return {
    userIds: v.staffIds,
    workDate: v.workDate,
    startTs,
    endTs,
    placeName: v.placeName.trim(),
    location: v.location ? { lat: v.location.lat, lng: v.location.lng } : null,
    radiusM: clampRadius(v.radiusM),
    mode: v.mode,
    otPreapproved: v.otPreapproved,
    ...(note ? { note } : {}),
  };
}

/** Quick client-side read of full Google Maps URLs (`@lat,lng`, `!3d..!4d..`, `q=` / `ll=`);
 * short links (`maps.app.goo.gl`) go to the server, which follows the redirect (PRD 4.6). */
export function parseMapsLink(url: string): { lat: number; lng: number } | null {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  ];
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep the raw link
  }
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m?.[1] && m[2]) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** Whether a pasted text looks like a Google Maps link at all (only Google hosts, PRD 4.6). */
export function looksLikeMapsLink(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return /(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/.test(u.hostname);
  } catch {
    return false;
  }
}
