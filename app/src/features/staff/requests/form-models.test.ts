import { describe, expect, it } from 'vitest';
import {
  type FixDraft,
  fixBody,
  fixDateBounds,
  fixIssues,
  leaveBody,
  leaveIssues,
  leaveRangeReady,
} from './form-models';

const leave = {
  typeCode: 'CL' as const,
  fromDate: '2026-11-03',
  toDate: '2026-11-04',
  reason: '',
  acceptSplit: false,
};
const preview = { countedDays: 2, excluded: [], daysPaid: 1, daysUnpaid: 1, warnings: [] };

describe('leave form rules', () => {
  it('previews only a complete range in order', () => {
    expect(leaveRangeReady(leave)).toBe(true);
    expect(leaveRangeReady({ ...leave, toDate: '2026-11-02' })).toBe(false);
    expect(leaveRangeReady({ ...leave, fromDate: '' })).toBe(false);
    expect(leaveRangeReady({ ...leave, typeCode: '' })).toBe(false);
  });

  it('needs the split confirmed before sending', () => {
    expect(leaveIssues(leave, preview)).toEqual(['splitUnconfirmed']);
    expect(leaveIssues({ ...leave, acceptSplit: true }, preview)).toEqual([]);
    expect(leaveIssues(leave, { ...preview, daysUnpaid: 0 })).toEqual([]);
  });

  it('wants a reason for unpaid leave and ordered dates', () => {
    expect(leaveIssues({ ...leave, typeCode: 'LOP' }, preview)).toEqual(['reasonRequired']);
    expect(leaveIssues({ ...leave, toDate: '2026-11-01' }, undefined)).toEqual(['toBeforeFrom']);
    expect(leaveIssues({ ...leave, fromDate: '' }, undefined)).toEqual(['pickDates']);
  });

  it('builds bodies; only a confirmed split is accepted', () => {
    expect(leaveBody(leave)).toEqual({
      typeCode: 'CL',
      fromDate: '2026-11-03',
      toDate: '2026-11-04',
      acceptUnpaidSplit: false,
    });
    expect(leaveBody({ ...leave, reason: ' fever ', acceptSplit: true }, preview)).toMatchObject({
      reason: 'fever',
      acceptUnpaidSplit: true,
    });
    expect(leaveBody(leave, preview).acceptUnpaidSplit).toBe(false);
  });
});

const fix: FixDraft = {
  kind: 'missed_in',
  workDate: '2026-10-19',
  targetPunchId: '',
  targetKind: '',
  arrived: '10:05',
  left: '',
  rightTime: '',
  place: '',
  reason: 'Phone died',
};

describe('fix form rules', () => {
  it('allows today and the six days before', () => {
    expect(fixDateBounds('2026-10-19')).toEqual({ min: '2026-10-13', max: '2026-10-19' });
    expect(fixIssues({ ...fix, workDate: '2026-10-12' }, '2026-10-19')).toContain('dateRange');
    expect(fixIssues(fix, '2026-10-19')).toEqual([]);
  });

  it('keeps times between 04:00 and 23:59', () => {
    expect(fixIssues({ ...fix, arrived: '03:59' }, '2026-10-19')).toEqual(['timeRange']);
    expect(fixIssues({ ...fix, arrived: '' }, '2026-10-19')).toEqual(['needTime']);
    expect(fixIssues({ ...fix, arrived: '04:00' }, '2026-10-19')).toEqual([]);
  });

  it('checks each kind', () => {
    const t = '2026-10-19';
    expect(fixIssues({ ...fix, kind: 'wrong_time', rightTime: '10:00' }, t)).toEqual(['needPunch']);
    const venue = { ...fix, kind: 'offsite_unplanned' as const, arrived: '10:00', left: '09:00' };
    expect(fixIssues(venue, t)).toEqual(['needPlace', 'order']);
    expect(fixIssues({ ...fix, reason: ' ' }, t)).toEqual(['needReason']);
  });

  it('builds IST timestamps', () => {
    const body = fixBody(fix);
    expect(body).toMatchObject({ kind: 'missed_in', reason: 'Phone died' });
    // 10:05 IST = 04:35 UTC
    expect(body.proposedInTs).toBe(Date.UTC(2026, 9, 19, 4, 35));
    const wrong = fixBody({
      ...fix,
      kind: 'wrong_time',
      targetPunchId: 'p1',
      targetKind: 'out',
      rightTime: '20:00',
    });
    expect(wrong.proposedOutTs).toBe(Date.UTC(2026, 9, 19, 14, 30));
    expect(wrong.proposedInTs).toBeUndefined();
  });
});
