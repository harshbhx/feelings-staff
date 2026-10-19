/**
 * i18n for Feelings Staff (PRD 11.9). Keys are semantic and namespaced: `t('staff:today.checkIn')`.
 * Namespaces and owners: common, staff, errors, notify (WP-7); owner (WP-6); payslip (WP-5).
 * English is the source of truth; Gujarati falls back to English key by key.
 */
import i18next, { type i18n as I18n } from 'i18next';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enNotify from '../en/notify.json';
import enOwner from '../en/owner.json';
import enPayslip from '../en/payslip.json';
import enStaff from '../en/staff.json';
import guCommon from '../gu/common.json';
import guErrors from '../gu/errors.json';
import guNotify from '../gu/notify.json';
import guOwner from '../gu/owner.json';
import guPayslip from '../gu/payslip.json';
import guStaff from '../gu/staff.json';

export const NAMESPACES = ['common', 'staff', 'owner', 'errors', 'notify', 'payslip'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export type AppLang = 'en' | 'gu';

export const resources = {
  en: {
    common: enCommon,
    staff: enStaff,
    owner: enOwner,
    errors: enErrors,
    notify: enNotify,
    payslip: enPayslip,
  },
  gu: {
    common: guCommon,
    staff: guStaff,
    owner: guOwner,
    errors: guErrors,
    notify: guNotify,
    payslip: guPayslip,
  },
} as const;

/** Create an i18next instance (one per app, or per request on the server for push copy). */
export async function createI18n(lang: AppLang = 'en'): Promise<I18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: lang,
    fallbackLng: 'en',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    resources,
    interpolation: { escapeValue: false },
  });
  return instance;
}

export * from './format';
