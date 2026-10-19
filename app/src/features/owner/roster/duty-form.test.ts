import { describe, expect, it } from 'vitest';
import {
  clampRadius,
  dutyWindow,
  emptyDutyForm,
  looksLikeMapsLink,
  parseMapsLink,
  toDutyCreate,
  validateDuty,
} from './duty-form';

const NEHA = '01K8EZTHPNQTWAVCVVCWXBXHMS';

describe('Off-site duty form (O-11)', () => {
  it('O-11.1 a duty can start before 06:00 and the end may cross midnight', () => {
    const early = dutyWindow({ workDate: '2026-11-09', start: '04:00', end: '09:00' });
    expect(early.crossesMidnight).toBe(false);
    expect(early.endTs - early.startTs).toBe(5 * 3_600_000);
    const late = dutyWindow({ workDate: '2026-11-09', start: '18:00', end: '01:00' });
    expect(late.crossesMidnight).toBe(true);
    expect(late.endTs - late.startTs).toBe(7 * 3_600_000);
  });

  it('O-11.1 reads full Google Maps links; short links are left to the server', () => {
    expect(
      parseMapsLink('https://www.google.com/maps/place/Hotel+Aram/@22.4702,70.0612,17z'),
    ).toEqual({
      lat: 22.4702,
      lng: 70.0612,
    });
    expect(
      parseMapsLink('https://www.google.com/maps/place/X/data=!3d22.4711!4d70.0603!16s'),
    ).toEqual({ lat: 22.4711, lng: 70.0603 });
    expect(parseMapsLink('https://maps.google.com/?q=22.46,70.05')).toEqual({
      lat: 22.46,
      lng: 70.05,
    });
    expect(parseMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(looksLikeMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBe(true);
    expect(looksLikeMapsLink('https://evil.example/maps?q=1,2')).toBe(false);
  });

  it('O-11.2 the overtime toggle is on by default and goes into the request', () => {
    const v = {
      ...emptyDutyForm('2026-11-09', [NEHA]),
      start: '04:00',
      end: '09:00',
      placeName: 'Hotel Aram, Jamnagar',
      location: { lat: 22.4702, lng: 70.0612, source: 'link' as const },
    };
    expect(validateDuty(v)).toEqual({});
    const body = toDutyCreate(v);
    expect(body.otPreapproved).toBe(true);
    expect(body.radiusM).toBe(200);
    expect(body.mode).toBe('geofence');
    expect(body.location).toEqual({ lat: 22.4702, lng: 70.0612 });
    expect(body).not.toHaveProperty('note');
  });

  it('needs a location unless the mode is Anywhere', () => {
    const v = { ...emptyDutyForm('2026-11-09', [NEHA]), placeName: 'Home visit' };
    expect(validateDuty(v).location).toBeDefined();
    expect(validateDuty({ ...v, mode: 'anywhere' }).location).toBeUndefined();
  });

  it('keeps the radius between 100 and 500 m in 25 m steps', () => {
    expect(clampRadius(80)).toBe(100);
    expect(clampRadius(612)).toBe(500);
    expect(clampRadius(237)).toBe(225);
  });
});
