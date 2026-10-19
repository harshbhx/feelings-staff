import type { StaffRow } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { filterStaff } from './staff-list-model';

const row = (over: Partial<StaffRow>): StaffRow => ({
  id: over.name ?? 'x',
  name: 'Priya Solanki',
  phone: '+919825011201',
  designation: 'Stylist',
  status: 'active',
  deviceState: 'approved',
  joinDate: '2025-03-10',
  exitDate: null,
  employeeCode: 'FBC-003',
  ...over,
});

const rows = [
  row({}),
  row({ name: 'Bhumi Trivedi', deviceState: 'pending', employeeCode: 'FBC-014' }),
  row({ name: 'Kiran Shah', status: 'invited', deviceState: 'none', employeeCode: null }),
  row({ name: 'Anita Joshi', status: 'exited', exitDate: '2026-09-30', phone: '+919876500000' }),
];
const names = (r: StaffRow[]) => r.map((x) => x.name);

describe('staff list filter (O-07, PRD 5.2 Staff)', () => {
  it('Active shows working people only, including one whose new phone waits; not invited or left', () => {
    expect(names(filterStaff(rows, 'active', ''))).toEqual(['Priya Solanki', 'Bhumi Trivedi']);
  });

  it('Invited, Left and All each match the server', () => {
    expect(names(filterStaff(rows, 'invited', ''))).toEqual(['Kiran Shah']);
    expect(names(filterStaff(rows, 'exited', ''))).toEqual(['Anita Joshi']);
    expect(filterStaff(rows, 'all', '')).toHaveLength(4);
  });

  it('search matches the name, the code, or 3+ digits of the phone', () => {
    expect(names(filterStaff(rows, 'all', 'bhumi'))).toEqual(['Bhumi Trivedi']);
    expect(names(filterStaff(rows, 'all', 'fbc-014'))).toEqual(['Bhumi Trivedi']);
    expect(names(filterStaff(rows, 'all', '98765'))).toEqual(['Anita Joshi']);
    expect(filterStaff(rows, 'all', '98')).toHaveLength(0);
  });
});
