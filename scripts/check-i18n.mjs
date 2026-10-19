#!/usr/bin/env node
/**
 * i18n key check (PRD 11.9), run in CI:
 * - every `ns:key.path` string used in app/src, packages/ui, packages/templates must exist in the
 *   English catalog packages/i18n/en/<ns>.json (error);
 * - keys missing in Gujarati are reported (warning in P0; set I18N_STRICT_GU=1 to fail).
 */
import { read, report, walk } from './lib.mjs';

const NS = ['common', 'staff', 'owner', 'errors', 'notify', 'payslip', 'auth', 'door', 'ui'];
const KEY = new RegExp(`['"\`](${NS.join('|')}):([A-Za-z0-9_.]+)['"\`]`, 'g');

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') for (const x of flatten(v, key)) out.add(x);
    else {
      out.add(key);
      // i18next plural forms: key_one, key_other -> key
      const base = key.replace(/_(zero|one|two|few|many|other)$/, '');
      out.add(base);
    }
  }
  return out;
}

const catalogs = {};
for (const lang of ['en', 'gu']) {
  catalogs[lang] = {};
  for (const ns of NS) {
    try {
      catalogs[lang][ns] = flatten(JSON.parse(read(`packages/i18n/${lang}/${ns}.json`)));
    } catch (e) {
      catalogs[lang][ns] = new Set();
      if (lang === 'en')
        report('check-i18n', [`packages/i18n/en/${ns}.json unreadable: ${e.message}`]);
    }
  }
}

const problems = [];
const missingGu = new Set();
const files = [
  ...walk('app/src', ['.ts', '.tsx']),
  ...walk('packages/ui/src', ['.ts', '.tsx']),
  ...walk('packages/templates/src', ['.ts', '.tsx']),
];
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(KEY)) {
    const [, ns, key] = m;
    if (!catalogs.en[ns].has(key)) problems.push(`${f}: missing en key ${ns}:${key}`);
    if (!catalogs.gu[ns].has(key)) missingGu.add(`${ns}:${key}`);
  }
}
if (missingGu.size > 0) {
  const msg = `${missingGu.size} key(s) not yet in Gujarati (falls back to English)`;
  if (process.env.I18N_STRICT_GU === '1') problems.push(msg);
  else console.warn(`check-i18n: warning: ${msg}`);
}
report('check-i18n', problems);
