/** i18next for the SPA (WP-1). Language comes from Me, falling back to the saved choice, then English. */
import { type AppLang, createI18n } from '@fs/i18n';
import type { i18n as I18n } from 'i18next';
import { type ReactNode, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';

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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [i18n, setI18n] = useState<I18n | null>(null);
  useEffect(() => {
    let alive = true;
    void createI18n(savedLang()).then((inst) => {
      if (alive) setI18n(inst);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!i18n) return null;
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
