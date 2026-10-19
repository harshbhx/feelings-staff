/**
 * Formatters bound to the current language (PRD 5 copy tone: `10:02`, `9 h 05 m`, `₹15,000`,
 * Indian grouping, Latin digits, IST).
 */
import {
  type AppLang,
  formatClock,
  formatDate,
  formatDuration,
  formatMonth,
  formatRupees,
} from '@fs/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface Fmt {
  lang: AppLang;
  clock(ts: number): string;
  /** `19 Oct` */
  date(d: string | number): string;
  /** `Mon, 19 Oct` */
  weekday(d: string | number): string;
  /** `19 October 2026` */
  long(d: string | number): string;
  /** `October 2026` */
  month(m: string): string;
  duration(min: number): string;
  rupees(paise: number): string;
}

export function makeFmt(lang: AppLang): Fmt {
  return {
    lang,
    clock: (ts) => formatClock(ts),
    date: (d) => formatDate(d, lang, 'short'),
    weekday: (d) => formatDate(d, lang, 'weekday'),
    long: (d) => formatDate(d, lang, 'long'),
    month: (m) => formatMonth(m, lang),
    duration: (min) => formatDuration(min),
    rupees: (paise) => formatRupees(paise, { whole: true }),
  };
}

export function useFmt(): Fmt {
  const { i18n } = useTranslation();
  const lang: AppLang = i18n.language === 'gu' ? 'gu' : 'en';
  return useMemo(() => makeFmt(lang), [lang]);
}
