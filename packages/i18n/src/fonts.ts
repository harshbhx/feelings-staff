/**
 * Script fonts and the document language (PRD 11.9). Client-only: imported by the SPA through
 * `@fs/i18n/fonts`, never by the Worker.
 *
 * Gujarati uses Noto Sans Gujarati (400, 600, 700), loaded only when the language is `gu`. Its
 * faces carry `unicode-range`, and the font stack keeps Plus Jakarta Sans first, so Latin text and
 * numbers keep the brand face and only Gujarati glyphs come from Noto.
 */
import type { AppLang } from './index';

let gujarati: Promise<void> | null = null;

/** Load the Gujarati faces once (dynamic CSS chunks, so English users never download them). */
export function loadGujaratiFont(): Promise<void> {
  gujarati ??= Promise.all([
    import('@fontsource/noto-sans-gujarati/400.css'),
    import('@fontsource/noto-sans-gujarati/600.css'),
    import('@fontsource/noto-sans-gujarati/700.css'),
    import('./gujarati.css'),
  ]).then(
    () => undefined,
    () => {
      gujarati = null; // offline on first switch: try again next time
    },
  );
  return gujarati;
}

/** `<html lang>` for screen readers and hyphenation, plus the script font. */
export function applyDocumentLang(lang: AppLang): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'gu' ? 'gu-IN' : 'en-IN';
  if (lang === 'gu') void loadGujaratiFont();
}
