import type { TodayBoard } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  inRowMatches,
  inRowStatus,
  ROW_CHIP,
  ROW_STATUS_PRIORITY,
  type RowStatus,
  rowStatus,
} from './status';

const board = fixtures.ownerToday as TodayBoard;
const byName = (name: string) => {
  const row = board.in.find((r) => r.user.name === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};
const plain = { pending: false, flagged: false, lateMin: 0, place: 'inside' as const };

describe('one status per row (redesign Fix 2)', () => {
  it('ranks owner action, then absent and half day, then late, present, then away', () => {
    expect(ROW_STATUS_PRIORITY).toEqual([
      'pending',
      'flag',
      'absent',
      'half',
      'late',
      'venue',
      'present',
      'leave',
      'holiday',
      'off',
      'unscheduled',
    ]);
  });

  // Every pair, both ways round: the higher status wins whatever order the matches come in.
  const pairs: [RowStatus, RowStatus][] = [];
  ROW_STATUS_PRIORITY.forEach((high, i) => {
    for (const low of ROW_STATUS_PRIORITY.slice(i + 1)) pairs.push([high, low]);
  });

  it('covers all 55 pairs of the 11 statuses', () => {
    expect(pairs).toHaveLength(55);
  });

  it.each(pairs)('%s wins over %s', (high, low) => {
    expect(rowStatus([high, low])).toBe(high);
    expect(rowStatus([low, high])).toBe(high);
  });

  it('a single status is itself, and no status is null', () => {
    for (const s of ROW_STATUS_PRIORITY) expect(rowStatus([s])).toBe(s);
    expect(rowStatus([])).toBeNull();
  });

  it('a status matched twice still yields one chip', () => {
    expect(rowStatus(['late', 'late', 'present'])).toBe('late');
  });

  it('every row status draws a kit chip', () => {
    for (const s of ROW_STATUS_PRIORITY) expect(ROW_CHIP[s]).toBeTruthy();
    expect(ROW_CHIP.pending).toBe('waiting');
    expect(ROW_CHIP.unscheduled).toBe('off');
  });
});

describe('Today rows (O-03, Fix 2)', () => {
  it('waiting for you beats late and the edge (Sejal: +21 m, pending, edge)', () => {
    const sejal = byName('Sejal Makwana');
    expect(inRowMatches(sejal)).toEqual(['present', 'pending', 'late']);
    expect(inRowStatus(sejal)).toBe('pending');
  });

  it('needs a look beats late (Jinal: +15 m, flagged, edge)', () => {
    expect(inRowStatus(byName('Jinal Kotak'))).toBe('flag');
  });

  it('late shows as the chip when nothing needs the owner (Neha: +28 m, inside)', () => {
    expect(inRowStatus(byName('Neha Parmar'))).toBe('late');
  });

  it('on time and inside is present (Pooja)', () => {
    expect(inRowStatus(byName('Pooja Bhatt'))).toBe('present');
  });

  it('at a venue beats present, late beats the venue', () => {
    expect(inRowStatus({ ...plain, place: 'venue' })).toBe('venue');
    expect(inRowStatus({ ...plain, place: 'venue', lateMin: 12 })).toBe('late');
    expect(inRowStatus({ ...plain, place: 'venue', pending: true })).toBe('pending');
  });

  it('waiting beats needs a look when a check-in is both', () => {
    expect(inRowStatus({ ...plain, pending: true, flagged: true, lateMin: 40 })).toBe('pending');
  });

  it('the edge, offline and owner-added places never make a chip of their own', () => {
    for (const place of ['edge', 'offline', 'owner'] as const)
      expect(inRowStatus({ ...plain, place })).toBe('present');
  });
});
