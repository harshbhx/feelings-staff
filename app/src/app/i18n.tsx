/** i18next for the SPA (WP-1). Language comes from Me, falling back to the saved choice, then English. */
import { type AppLang, createI18n, NAMESPACES, type Namespace, STAFF_NAMESPACES } from '@fs/i18n';
import type { i18n as I18n } from 'i18next';
import { type ReactNode, useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

const LANG_KEY = 'fs.lang';

export function savedLang(): AppLang {
  try {
    return localStorage.getItem(LANG_KEY) === 'gu' ? 'gu' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLang(lang: AppLang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage unavailable (private mode): the choice lasts for this session only
  }
}

/**
 * Staff phones start with the staff catalogs only (PRD 11.10); the owner, door and payslip copy are
 * separate chunks that `WithNamespaces` loads when one of those areas opens.
 */
function startNamespaces(path: string): readonly Namespace[] {
  return /^\/(o|auth\/owner|door|v|__kit)(\/|$)/.test(path) ? NAMESPACES : STAFF_NAMESPACES;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [i18n, setI18n] = useState<I18n | null>(null);
  useEffect(() => {
    let alive = true;
    void createI18n(savedLang(), startNamespaces(window.location.pathname)).then((inst) => {
      if (alive) setI18n(inst);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!i18n) return null;
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** Renders its children once `ns` are loaded (route areas whose copy is not in the staff shell). */
export function WithNamespaces({
  ns,
  children,
}: {
  ns: readonly Namespace[];
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const ready = ns.every((n) => i18n.hasLoadedNamespace(n));
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    void i18n.loadNamespaces([...ns]).then(() => {
      if (alive) setLoaded((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [i18n, ns, ready]);
  return ready ? children : null;
}
