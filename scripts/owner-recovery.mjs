#!/usr/bin/env node
/**
 * Owner recovery for an admin with Wrangler access to the database (docs/runbooks/owner-recovery.md,
 * docs/owner-access.md "Passkeys", flows 5 and 6). Dry run by default: it looks the owner up (read
 * only) and prints what it would change. Nothing is written without --yes. It never prints a PIN, a
 * hash, a salt or a token.
 *
 *   node scripts/owner-recovery.mjs (--clear-pin | --issue-code) --database <name> (--remote | --local)
 *        [--config <wrangler config>] [--env <wrangler env>] [--email <owner email>]
 *        [--reason "<text>"] [--yes]
 *
 * Actions (exactly one):
 *   --clear-pin   Clear the owner PIN, its failures and lock, and sign the owner out everywhere.
 *                 The next sign-in by email code goes through the first-PIN flow. Audit row
 *                 owner.pin_cleared_by_admin.
 *   --issue-code  Issue a one-time recovery code for an owner who lost every device: stored hashed,
 *                 valid 24 hours, single use, earlier unused codes stop working. The code is shown
 *                 once, after the write, and never in a dry run. Audit row owner.recovery_issued.
 *
 * Wrangler runs as `pnpm exec wrangler` from app/ (set WRANGLER_CMD to use another command).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  clearPinStatements,
  issueCodeStatements,
  newRecoveryCode,
  OWNER_LOOKUP_SQL,
  RECOVERY_CODE_TTL_MS,
  recoveryCodeHash,
  ulid,
} from './owner-recovery-sql.mjs';

const APP_DIR = new URL('../app/', import.meta.url).pathname;

/**
 * Each action turns the chosen owner into the lines to show and the statements to run. A later
 * action adds an entry here (and its options above); the lookup, the dry run and --yes are shared.
 * `shown` is what gets printed: an action that writes a secret (a recovery code hash) prints a
 * redacted copy and shows the secret once, after the write, from `after` (which can re-read the
 * owner row to confirm the change).
 */
const ACTIONS = {
  'clear-pin': {
    title: 'Clear the owner PIN',
    defaultReason: 'Owner forgot the PIN',
    async plan(owner, { now, reason }) {
      const auditId = ulid(now);
      const statements = clearPinStatements({
        ownerId: owner.id,
        orgId: owner.org_id,
        now,
        auditId,
        reason,
      });
      return {
        lines: [
          `PIN: ${owner.pin_set ? 'set' : 'not set'}${lockLine(owner, now)} -> cleared, failures 0, no lock`,
          'Sessions: every session of the owner is signed out',
          'Next sign-in: email code, then "Set your PIN" within 15 minutes (the first-PIN flow)',
          'The password alone cannot sign in while no PIN is set',
          `Audit: owner.pin_cleared_by_admin, row ${auditId}`,
        ],
        statements,
        shown: statements,
        after: (reread) => [
          `PIN now ${reread().pin_set ? 'set' : 'not set'}. Audit row id: ${auditId}`,
        ],
      };
    },
  },
  'issue-code': {
    title: 'Issue a recovery code',
    defaultReason: 'Owner lost every device',
    async plan(owner, { now, reason }) {
      const code = newRecoveryCode();
      const codeId = ulid(now);
      const auditId = ulid(now);
      const statements = issueCodeStatements({
        ownerId: owner.id,
        orgId: owner.org_id,
        now,
        codeId,
        codeHash: await recoveryCodeHash(code.replaceAll('-', '')),
        auditId,
        reason,
      });
      const hours = RECOVERY_CODE_TTL_MS / 3_600_000;
      return {
        lines: [
          `Code: one new code for this owner, valid ${hours} hours (until ${new Date(now + RECOVERY_CODE_TTL_MS).toISOString()}), single use`,
          'Earlier unused codes of this owner stop working',
          'Stored hashed: the code itself is shown once, after the write, never in a dry run',
          'Sessions and passkeys stay as they are until she redeems the code on the owner host',
          `Audit: owner.recovery_issued, row ${auditId}`,
        ],
        statements,
        shown: statements.map((sql) => sql.replace(/'[0-9a-f]{64}'/, "'<hash of the code>'")),
        after: () => [
          `Recovery code (shown once, give it to her by phone): ${code}`,
          `Code id ${codeId}, audit row id: ${auditId}`,
        ],
      };
    },
  },
};

const USAGE = `Usage: node scripts/owner-recovery.mjs (--clear-pin | --issue-code) --database <name> (--remote | --local)
       [--config <wrangler config>] [--env <wrangler env>] [--email <owner email>]
       [--reason "<text>"] [--yes]
Dry run unless --yes. See docs/runbooks/owner-recovery.md.`;

function lockLine(owner, now) {
  return owner.pin_locked_until && owner.pin_locked_until > now ? ' (locked)' : '';
}

function maskEmail(email) {
  if (!email) return '(no email)';
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

function die(message) {
  console.error(`owner-recovery: ${message}`);
  process.exit(1);
}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        'clear-pin': { type: 'boolean' },
        'issue-code': { type: 'boolean' },
        database: { type: 'string' },
        config: { type: 'string' },
        env: { type: 'string' },
        remote: { type: 'boolean' },
        local: { type: 'boolean' },
        email: { type: 'string' },
        reason: { type: 'string' },
        yes: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    die(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
  const v = parsed.values;
  if (v.help) {
    console.info(USAGE);
    process.exit(0);
  }
  const actions = Object.keys(ACTIONS).filter((name) => v[name]);
  if (actions.length !== 1)
    die(
      `choose exactly one action (${Object.keys(ACTIONS)
        .map((a) => `--${a}`)
        .join(', ')})\n${USAGE}`,
    );
  if (!v.database) die(`--database is required\n${USAGE}`);
  if (Boolean(v.remote) === Boolean(v.local)) die(`choose --remote or --local\n${USAGE}`);
  if (v.email !== undefined && !/^[^\s@']+@[^\s@']+$/.test(v.email))
    die('--email does not look like an email');
  return {
    action: actions[0],
    database: v.database,
    config: v.config ? resolve(process.cwd(), v.config) : null,
    env: v.env ?? null,
    target: v.remote ? '--remote' : '--local',
    email: v.email?.trim().toLowerCase() ?? null,
    reason: (v.reason ?? ACTIONS[actions[0]].defaultReason).slice(0, 200),
    yes: Boolean(v.yes),
  };
}

/** Run one `wrangler d1 execute --json --command` and return the result sets. */
function d1(opts, sql) {
  const [cmd, ...base] = (process.env.WRANGLER_CMD ?? 'pnpm exec wrangler').split(/\s+/);
  const args = [...base, 'd1', 'execute', opts.database, opts.target, '--json', '--command', sql];
  if (opts.config) args.push('--config', opts.config);
  if (opts.env) args.push('--env', opts.env);
  const res = spawnSync(cmd, args, {
    cwd: APP_DIR,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) die(`could not run wrangler: ${res.error.message}`);
  if (res.status !== 0)
    die(`wrangler failed (exit ${res.status}):\n${(res.stderr || res.stdout).trim()}`);
  const start = res.stdout.indexOf('[');
  try {
    return JSON.parse(res.stdout.slice(start));
  } catch {
    die('could not read the wrangler output as JSON');
  }
}

function findOwner(opts) {
  const owners = d1(opts, OWNER_LOOKUP_SQL)[0]?.results ?? [];
  if (owners.length === 0) die('no owner in this database');
  if (opts.email) {
    const owner = owners.find((o) => o.email?.toLowerCase() === opts.email);
    if (!owner) die('no owner with that email');
    return owner;
  }
  if (owners.length > 1) die(`${owners.length} owners in this database: pass --email`);
  return owners[0];
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const action = ACTIONS[opts.action];
  const where = `${opts.database} (${opts.target.slice(2)}${opts.env ? `, env ${opts.env}` : ''}${opts.config ? `, ${opts.config}` : ''})`;
  const owner = findOwner(opts);
  const now = Date.now();
  const plan = await action.plan(owner, { now, reason: opts.reason });

  console.info(`${action.title}: ${opts.yes ? '' : 'dry run, '}database ${where}`);
  console.info(`Owner: ${owner.name} <${maskEmail(owner.email)}>, id ${owner.id}`);
  for (const line of plan.lines) console.info(`- ${line}`);
  console.info('SQL:');
  for (const sql of plan.shown) console.info(`  ${sql};`);

  if (!opts.yes) {
    console.info('Dry run: nothing changed. Run again with --yes to do it.');
    return;
  }
  d1(opts, plan.statements.join(';\n'));
  const reread = () => findOwner({ ...opts, email: owner.email?.toLowerCase() ?? opts.email });
  for (const line of plan.after(reread)) console.info(line);
  console.info('Done. Add an entry to docs/ops-log.md (no codes, no secrets).');
}

await main();
