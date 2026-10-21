/**
 * Distance from the salon in plain units: under 100 m to the nearest 5 m, 100 m to under 1 km to
 * the nearest 10 m, 1 km and over in km with one decimal. Digits stay Latin, grouping follows the
 * language. Pure, no React: the check-in sheet formats the distance the server measured.
 */
import type { AppLang } from '@fs/i18n';

const cache = new Map<string, Intl.NumberFormat>();

function nf(lang: AppLang, unit: 'meter' | 'kilometer'): Intl.NumberFormat {
  const key = `${lang}:${unit}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'gu' ? 'gu-IN' : 'en-IN', {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      numberingSystem: 'latn',
      minimumFractionDigits: unit === 'kilometer' ? 1 : 0,
      maximumFractionDigits: unit === 'kilometer' ? 1 : 0,
    });
    cache.set(key, f);
  }
  return f;
}

/** `45 m`, `340 m`, `1.2 km`. Returns null for a missing, negative or non-finite distance. */
export function formatDistance(
  meters: number | null | undefined,
  lang: AppLang = 'en',
): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null;
  const rounded = meters < 100 ? Math.round(meters / 5) * 5 : Math.round(meters / 10) * 10;
  // 995-999 m round to 1000 m: show it as 1.0 km, not "1000 m".
  if (rounded >= 1000) return nf(lang, 'kilometer').format(Math.round(meters / 100) / 10);
  return nf(lang, 'meter').format(rounded);
}
