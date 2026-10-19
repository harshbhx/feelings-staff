import type { Me } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { activeItem, activeTab, allowed, MORE, TABS } from './nav';

const owner = variants.me?.owner as Me;
const staff = fixtures.me as Me;

describe('owner navigation (PRD 5.2)', () => {
  it('phone tabs are Today, Needs action, Register, Staff (+ More)', () => {
    expect(TABS.map((t) => t.key)).toEqual(['today', 'actions', 'register', 'staff']);
    expect(MORE.map((t) => t.key)).toEqual([
      'payroll',
      'advances',
      'reports',
      'roster',
      'rollcall',
      'inbox',
      'door',
      'settings',
    ]);
  });

  it('the owner sees everything; a manager only what the permissions allow', () => {
    for (const item of [...TABS, ...MORE]) expect(allowed(item, owner)).toBe(true);
    const manager: Me = {
      ...owner,
      user: { ...owner.user, role: 'manager' },
      permissions: ['approve_attendance', 'roster'],
    };
    const shown = [...TABS, ...MORE].filter((i) => allowed(i, manager)).map((i) => i.key);
    expect(shown).toEqual(['today', 'actions', 'register', 'roster', 'inbox']);
    const caller: Me = { ...manager, permissions: ['rollcall'] };
    expect([...TABS, ...MORE].filter((i) => allowed(i, caller)).map((i) => i.key)).toEqual([
      'today',
      'actions',
      'register',
      'rollcall',
      'inbox',
    ]);
    expect(allowed(TABS[0] as (typeof TABS)[number], null)).toBe(false);
    expect(staff.user.role).toBe('staff');
  });

  it('marks the active tab and rail item from the path', () => {
    expect(activeTab('/o/register/01K8EZTHPNQTWAVCVVCWXBXHMS/2026-10-19')).toBe('register');
    expect(activeTab('/o/payroll/01K8QTKPY00JBH9HC76Z45ZRR1')).toBe('more');
    expect(activeItem('/o/payroll/01K8QTKPY00JBH9HC76Z45ZRR1')).toBe('payroll');
    expect(activeItem('/o/duties/new')).toBe('roster');
  });
});
