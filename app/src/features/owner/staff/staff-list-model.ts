/**
 * Staff list filter (PRD 5.2 Staff: search, and the Active · Invited · Left · All chips). The server
 * filters too; doing it here as well keeps the list right whatever answered (the fixtures in mock
 * mode return everyone), with the same rules as `listStaff` on the server: a status chip matches
 * that status exactly, and the search matches the name, the employee code, or 3+ digits of the phone.
 */
import type { StaffRow } from '@fs/contracts';
import type { StaffStatusFilter } from '../api/keys';

export function filterStaff(
  rows: readonly StaffRow[],
  status: StaffStatusFilter,
  q: string,
): StaffRow[] {
  const text = q.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  return rows.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (!text) return true;
    return (
      r.name.toLowerCase().includes(text) ||
      (r.employeeCode?.toLowerCase().includes(text) ?? false) ||
      (digits.length >= 3 && (r.phone ?? '').includes(digits))
    );
  });
}
