#!/usr/bin/env node
/**
 * Seeds the preview with the demo salon (WP-1 integration). Light: only HTTP calls.
 *
 *   E2E_TOKEN=... node scripts/seed-demo.mjs --url https://<preview-host>
 *
 * 1. POST /__test/reset {scenario: 'demo'}: salon, owner, ~12 staff, ~7 weeks of raw punches, leave,
 *    duties, advances, a pending device and fix.
 * 2. The owner signs in and moves the Time credits start date (default 1 Nov 2026, still in the future)
 *    to the first seeded day, so day recomputes write credit entries. Nothing is settled.
 *    POST /__test/cron {job: 'recompute-day', date} for every day: attendance through DayService.
 * 3. Owner signs in (password + PIN), steps up, approves overtime older than 3 days (so Needs action
 *    looks like a salon where the owner keeps up), runs last month's payroll, finalises it and marks
 *    it paid, so payslips exist. Steps whose endpoints are not built yet are skipped with a warning.
 * Prints the demo logins (test data only).
 */
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? undefined : process.argv[i + 1];
};
const base = (arg('--url') ?? process.env.PREVIEW_URL ?? '').replace(/\/$/, '');
const token = process.env.E2E_TOKEN ?? '';
const days = Number(arg('--days') ?? 49);
if (!base || !token) {
  console.error('Usage: E2E_TOKEN=... node scripts/seed-demo.mjs --url https://<preview-host>');
  process.exit(1);
}
const origin = new URL(base).origin;
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: origin,
      'X-FS-Client': '0.1.0',
      'X-E2E-Token': token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function istToday() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const reset = await call('POST', '/__test/reset', { scenario: 'demo' });
if (reset.status !== 200) {
  console.error('reset failed', reset.status, JSON.stringify(reset.json));
  process.exit(1);
}
console.info(`Seeded ${reset.json.staff.length} staff.`);

const today = istToday();
const rangeStart = addDays(today, -(days - 1));
const { email, password, pin } = reset.json.owner;
const signIn = await call('POST', '/auth/owner/password', { email, password, pin });
if (signIn.status === 200) {
  // Time credits count from startDate (default 1 Nov 2026), so move it to the first seeded day
  // before any day is recomputed. Otherwise no entries are written and the balances stay empty.
  const cred = await call('PATCH', '/owner/settings', {
    settings: { timeCredits: { startDate: rangeStart } },
  });
  if (cred.status !== 200) {
    console.error(`credits start date: ${cred.status} ${cred.json?.error?.code ?? ''}`);
    process.exit(1);
  } else {
    console.info(`Time credits start on ${rangeStart}.`);
  }
} else {
  console.warn(`owner sign-in: ${signIn.status} (auth not ready?); credits start date not set`);
}

let recomputed = 0;
for (let d = rangeStart; d <= today; d = addDays(d, 1)) {
  const r = await call('POST', '/__test/cron', { job: 'recompute-day', date: d });
  if (r.status !== 200) {
    console.warn(
      `recompute ${d}: ${r.status} ${r.json?.error?.code ?? ''} (DayService not ready?)`,
    );
    if (r.status === 501 || r.json?.error?.code === 'NOT_IMPLEMENTED') break;
    continue;
  }
  recomputed++;
}
console.info(`Recomputed ${recomputed} day(s).`);

if (signIn.status !== 200) {
  console.warn(`owner sign-in: ${signIn.status} (auth not ready?); payroll skipped`);
} else {
  await call('POST', '/auth/step-up', { pin });

  // Urmi decides overtime as the days go by, so only the last few days still wait in Needs action.
  const actions = await call('GET', '/owner/actions');
  if (actions.status === 200) {
    const cutoff = addDays(today, -3);
    const old = (actions.json.items ?? [])
      .filter((i) => i.type === 'overtime' && i.workDate < cutoff)
      .map((i) => i.id);
    let decided = 0;
    for (let i = 0; i < old.length; i += 100) {
      const r = await call('POST', '/owner/actions/bulk', {
        type: 'overtime',
        ids: old.slice(i, i + 100),
        decision: 'approve',
      });
      if (r.status === 200) decided += old.slice(i, i + 100).length;
      else console.warn(`overtime bulk: ${r.status} ${r.json?.error?.code ?? ''}`);
    }
    console.info(`Approved overtime on ${decided} older day(s).`);
  } else {
    console.warn(`owner actions: ${actions.status} (attendance API not ready?)`);
  }
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const run = await call('POST', '/owner/payroll-runs', { month: lastMonth });
  if (run.status !== 201 && run.status !== 200) {
    console.warn(`payroll draft: ${run.status} ${run.json?.error?.code ?? ''}`);
  } else {
    const id = run.json.run.id;
    const fin = await call('POST', `/owner/payroll-runs/${id}/finalise`, { acceptDefaults: true });
    console.info(`payroll ${lastMonth}: finalise ${fin.status}`);
    const paid = await call('POST', `/owner/payroll-runs/${id}/mark-all-paid`, {
      paidOn: `${today.slice(0, 7)}-03`,
      mode: 'upi',
    });
    console.info(`payroll ${lastMonth}: mark all paid ${paid.status}`);
  }
}

if (signIn.status === 200) {
  const credits = await call('GET', '/owner/credits');
  if (credits.status === 200) {
    const rows = credits.json.staff ?? [];
    const plus = rows.filter((r) => r.balanceMin > 0).length;
    const minus = rows.filter((r) => r.balanceMin < 0).length;
    console.info(
      `Credits check: ${plus + minus} of ${rows.length} people have a non-zero balance (${plus} plus, ${minus} minus).`,
    );
    if (plus + minus === 0)
      console.warn('Credits check: every balance is zero, check the start date.');
  } else {
    console.warn(`credits check: ${credits.status} ${credits.json?.error?.code ?? ''}`);
  }
}

console.info('\nDemo logins (test data):');
console.info(`  Owner: ${base}/auth/owner  email ${email}  password ${password}  owner PIN ${pin}`);
const priya = reset.json.staff.find((s) => s.name.startsWith('Priya'));
if (priya) {
  console.info(
    `  Staff: ${base}/signin  phone ${priya.phone.replace('+91', '')}  PIN ${priya.pin} (on a new phone: "I have a new phone", then approve it as the owner)`,
  );
}
