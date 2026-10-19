/**
 * i18n for Feelings Staff (PRD 11.9). Keys are semantic and namespaced: `t('staff:today.checkIn')`.
 * Namespaces and owners: common, staff, errors, door (WP-7); owner (WP-6); payslip (WP-5);
 * auth (WP-3); notify (WP-8); ui (WP-2, component-level strings such as aria labels).
 * English is the source of truth; Gujarati falls back to English key by key.
 */
import i18next, { type i18n as I18n } from 'i18next';
import enAuth from '../en/auth.json';
import enCommon from '../en/common.json';
import enDoor from '../en/door.json';
import enErrors from '../en/errors.json';
import enNotify from '../en/notify.json';
import enOwner from '../en/owner.json';
import enPayslip from '../en/payslip.json';
import enStaff from '../en/staff.json';
import enUi from '../en/ui.json';
import guAuth from '../gu/auth.json';
import guCommon from '../gu/common.json';
import guDoor from '../gu/door.json';
import guErrors from '../gu/errors.json';
import guNotify from '../gu/notify.json';
import guOwner from '../gu/owner.json';
import guPayslip from '../gu/payslip.json';
import guStaff from '../gu/staff.json';
import guUi from '../gu/ui.json';

export const NAMESPACES = [
  'common',
  'staff',
  'owner',
  'errors',
  'notify',
  'payslip',
  'auth',
  'door',
  'ui',
] as const;
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
    auth: enAuth,
    door: enDoor,
    ui: enUi,
  },
  gu: {
    common: guCommon,
    staff: guStaff,
    owner: guOwner,
    errors: guErrors,
    notify: guNotify,
    payslip: guPayslip,
    auth: guAuth,
    door: guDoor,
    ui: guUi,
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
