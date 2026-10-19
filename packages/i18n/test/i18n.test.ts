import { describe, expect, it } from 'vitest';
import {
  createI18n,
  formatClock,
  formatDate,
  formatMonth,
  loadCatalog,
  NAMESPACES,
  STAFF_NAMESPACES,
} from '../src/index';

describe('i18n setup (PRD 11.9, AC S-17)', () => {
  it('S-17.3 a key missing in Gujarati falls back to English', async () => {
    const i18n = await createI18n('gu');
    expect(i18n.t('staff:today.checkIn')).toBe('Check in');
    expect(i18n.t('common:language.gu')).toBe('ગુજરાતી');
  });

  it('S-17.2 switching language needs no new instance', async () => {
    const i18n = await createI18n('en');
    await i18n.changeLanguage('gu');
    expect(i18n.language).toBe('gu');
    await i18n.changeLanguage('en');
    expect(i18n.t('staff:nav.today')).toBe('Today');
  });

  it('plural forms pick one and other', async () => {
    const i18n = await createI18n('en');
    expect(i18n.t('staff:shell.queued', { count: 1 })).toBe('1 check-in waiting to send');
    expect(i18n.t('staff:shell.queued', { count: 2 })).toBe('2 check-ins waiting to send');
    expect(i18n.t('staff:punch.pin.wrong', { count: 3 })).toBe('Wrong PIN. 3 tries left.');
  });

  it('interpolates the owner name from settings, never a fixed name', async () => {
    const i18n = await createI18n('en');
    expect(i18n.t('staff:today.sendToOwner', { owner: 'Urmi' })).toBe('Send to Urmi');
    const staff = JSON.stringify(await loadCatalog('en', 'staff'));
    expect(staff).not.toMatch(/\bUrmi\b/);
  });

  it('loads the owner copy from its own chunk by default, and only when asked for', async () => {
    const all = await createI18n('en');
    expect(all.hasResourceBundle('en', 'owner')).toBe(true);
    const staffOnly = await createI18n('en', STAFF_NAMESPACES);
    expect(staffOnly.hasResourceBundle('en', 'owner')).toBe(false);
    await staffOnly.loadNamespaces('owner');
    expect(staffOnly.hasResourceBundle('en', 'owner')).toBe(true);
  });

  it('every namespace has an English and a Gujarati catalog', async () => {
    for (const ns of NAMESPACES) {
      expect(typeof (await loadCatalog('en', ns))).toBe('object');
      expect(typeof (await loadCatalog('gu', ns))).toBe('object');
    }
    expect(await loadCatalog('fr', 'staff')).toEqual({});
  });

  it('formats IST clock, dates and months with Latin digits', () => {
    const ts = Date.parse('2026-10-19T10:02:17+05:30');
    expect(formatClock(ts)).toBe('10:02');
    expect(formatDate('2026-10-19', 'en', 'weekday')).toMatch(/Mon,? 19 Oct/);
    expect(formatMonth('2026-10', 'en')).toBe('October 2026');
    expect(formatDate('2026-10-19', 'gu')).toMatch(/19/);
  });
});
