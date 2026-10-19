/**
 * R2 lifecycle rules (PRD 8.4, 10.9): selfies 30 days, exports 7 days, backups 90 days.
 *
 *   node scripts/r2-lifecycle.ts check   # list the bucket's rules, fail if one is missing or wrong
 *   node scripts/r2-lifecycle.ts apply   # create or replace the three rules
 *
 * Needs CLOUDFLARE_API_TOKEN (R2 edit) and CLOUDFLARE_ACCOUNT_ID; without them it prints a notice
 * and exits 0, so CI can run it before the secrets exist. The bucket is R2_BUCKET (default
 * fbc-staff-media). Owner: WP-8. Runs on Node 24 as is (type stripping), no dependencies.
 */

const DAY = 86_400;
const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

export interface Rule {
  id: string;
  enabled: boolean;
  conditions: { prefix: string };
  deleteObjectsTransition: { condition: { type: 'Age'; maxAge: number } };
}

const rule = (id: string, prefix: string, days: number): Rule => ({
  id,
  enabled: true,
  conditions: { prefix },
  deleteObjectsTransition: { condition: { type: 'Age', maxAge: days * DAY } },
});

/** The rules PRD 8.4 asks for. `hold/`, `photos/` and `payslips/` have none (nightly and purge jobs). */
export const DESIRED_RULES: readonly Rule[] = [
  rule('selfies-30d', 'selfies/', 30),
  rule('exports-7d', 'exports/', 7),
  rule('backups-90d', 'backups/', 90),
];

/** What is missing or different in `actual` compared with `DESIRED_RULES`. */
export function problems(actual: readonly Partial<Rule>[]): string[] {
  const out: string[] = [];
  for (const want of DESIRED_RULES) {
    const got = actual.find((r) => r.conditions?.prefix === want.conditions.prefix);
    if (!got) {
      out.push(`missing rule for ${want.conditions.prefix}`);
      continue;
    }
    if (got.enabled === false) out.push(`rule for ${want.conditions.prefix} is disabled`);
    const age = got.deleteObjectsTransition?.condition?.maxAge;
    if (age !== want.deleteObjectsTransition.condition.maxAge)
      out.push(
        `rule for ${want.conditions.prefix} deletes after ${age === undefined ? '?' : age / DAY} days, want ${want.deleteObjectsTransition.condition.maxAge / DAY}`,
      );
  }
  return out;
}

function endpoint(account: string, bucket: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/lifecycle`;
}

async function list(account: string, bucket: string, token: string): Promise<Partial<Rule>[]> {
  const res = await fetch(endpoint(account, bucket), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { success?: boolean; result?: { rules?: Partial<Rule>[] } };
  if (!res.ok || json.success === false)
    throw new Error(`listing rules failed (HTTP ${res.status})`);
  return json.result?.rules ?? [];
}

async function apply(account: string, bucket: string, token: string): Promise<void> {
  const res = await fetch(endpoint(account, bucket), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: DESIRED_RULES }),
  });
  if (!res.ok) throw new Error(`setting rules failed (HTTP ${res.status})`);
}

async function main(): Promise<number> {
  const mode = process.argv[2] ?? 'check';
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET ?? 'fbc-staff-media';
  if (!token || !account) {
    out(
      '::notice::CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set; R2 lifecycle skipped.',
    );
    return 0;
  }
  if (mode === 'apply') {
    await apply(account, bucket, token);
    out(`Applied ${DESIRED_RULES.length} lifecycle rules to ${bucket}.`);
  } else if (mode !== 'check') {
    err(`Unknown mode "${mode}". Use check or apply.`);
    return 2;
  }
  const actual = await list(account, bucket, token);
  for (const r of actual)
    out(
      `${r.id ?? '(no id)'}: ${r.conditions?.prefix ?? '*'} -> delete after ${(r.deleteObjectsTransition?.condition?.maxAge ?? 0) / DAY} days${r.enabled === false ? ' (disabled)' : ''}`,
    );
  const bad = problems(actual);
  for (const p of bad) err(`::error::${p}`);
  return bad.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      err(`::error::${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
