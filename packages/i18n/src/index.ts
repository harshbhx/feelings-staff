/**
 * i18n for Feelings Staff (PRD 11.9). Keys are semantic and namespaced: `t('staff:today.checkIn')`.
 * Namespaces and owners: common, staff, errors (WP-7); owner (WP-6); payslip (WP-5); auth (WP-3);
 * door (WP-4); notify (WP-8); ui (WP-2, component-level strings such as aria labels).
 * English is the source of truth; Gujarati falls back to English key by key.
 *
 * Bundling (PRD 11.10, staff initial JS): only the English catalogs a staff phone needs before its
 * first paint are in the app shell (`STAFF_NAMESPACES`). The owner, door and payslip copy and every
 * Gujarati catalog are separate chunks, loaded through a small i18next backend when an instance
 * asks for them (at creation, on `changeLanguage('gu')`, or with `i18n.loadNamespaces`).
 */
import i18next, { type BackendModule, type i18n as I18n, type ResourceKey } from 'i18next';
import enAuth from '../en/auth.json';
import enCommon from '../en/common.json';
import enErrors from '../en/errors.json';
import enNotify from '../en/notify.json';
import enStaff from '../en/staff.json';
import enUi from '../en/ui.json';

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

/** What the staff app needs from the start: shell, screens, errors, sign-in, inbox, kit labels. */
export const STAFF_NAMESPACES = [
  'common',
  'staff',
  'errors',
  'ui',
  'auth',
  'notify',
] as const satisfies readonly Namespace[];

type Catalog = Exclude<ResourceKey, string>;
type Loader = () => Promise<{ default: Catalog }>;

/** In the app shell. */
const bundledEn: Record<(typeof STAFF_NAMESPACES)[number], Catalog> = {
  common: enCommon,
  staff: enStaff,
  errors: enErrors,
  ui: enUi,
  auth: enAuth,
  notify: enNotify,
};

/** Separate chunks, fetched on demand. */
const lazyCatalogs: Record<AppLang, Partial<Record<Namespace, Loader>>> = {
  en: {
    owner: () => import('../en/owner.json'),
    door: () => import('../en/door.json'),
    payslip: () => import('../en/payslip.json'),
  },
  gu: {
    common: () => import('../gu/common.json'),
    staff: () => import('../gu/staff.json'),
    owner: () => import('../gu/owner.json'),
    errors: () => import('../gu/errors.json'),
    notify: () => import('../gu/notify.json'),
    payslip: () => import('../gu/payslip.json'),
    auth: () => import('../gu/auth.json'),
    door: () => import('../gu/door.json'),
    ui: () => import('../gu/ui.json'),
  },
};

function isBundled(ns: string): ns is keyof typeof bundledEn {
  return Object.hasOwn(bundledEn, ns);
}

/** One catalog, from the bundle or its chunk. Unknown language or namespace: an empty catalog. */
export async function loadCatalog(lang: string, ns: string): Promise<Catalog> {
  if (lang === 'en' && isBundled(ns)) return bundledEn[ns];
  const load = lazyCatalogs[lang as AppLang]?.[ns as Namespace];
  return load ? (await load()).default : {};
}

const chunkBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(lang, ns, callback) {
    loadCatalog(lang, ns).then(
      (data) => callback(null, data),
      (e: unknown) => callback(e instanceof Error ? e : String(e), null),
    );
  },
};

/**
 * Create an i18next instance (one per app, or per request on the server for push copy). Resolves
 * once `namespaces` (default: all) are loaded in `lang` and in English. The staff app may pass
 * `STAFF_NAMESPACES` so the owner copy never loads on a staff phone.
 */
export async function createI18n(
  lang: AppLang = 'en',
  namespaces: readonly Namespace[] = NAMESPACES,
): Promise<I18n> {
  const instance = i18next.createInstance();
  await instance.use(chunkBackend).init({
    lng: lang,
    fallbackLng: 'en',
    ns: [...namespaces],
    defaultNS: 'common',
    resources: { en: { ...bundledEn } },
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
  });
  return instance;
}

export * from './format';
