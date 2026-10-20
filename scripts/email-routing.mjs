#!/usr/bin/env node
/**
 * Apply config/email-routing.json to Cloudflare Email Routing (idempotent).
 * The forwarding destination lives only in that file. Usage:
 *   CLOUDFLARE_ACCOUNT_ID=<id> node scripts/email-routing.mjs [--dry-run]
 * Needs a Wrangler login (or CLOUDFLARE_API_TOKEN) on the salon's account. Cloudflare emails the
 * destination a verification link the first time an address is added; forwarding starts once it is
 * clicked. Run it again after changing the destination.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const dry = process.argv.includes('--dry-run');
const cfg = JSON.parse(
  readFileSync(new URL('../config/email-routing.json', import.meta.url), 'utf8'),
);
const wr = (...args) =>
  execFileSync('npx', ['-y', 'wrangler@4.151.1', 'email', 'routing', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const addresses = wr('addresses', 'list');
if (!addresses.includes(cfg.destination)) {
  console.info(`creating destination ${cfg.destination} (Cloudflare sends a verification mail)`);
  if (!dry) wr('addresses', 'create', cfg.destination);
}

const rules = wr('rules', 'list', cfg.domain);
for (const local of cfg.addresses) {
  const addr = `${local}@${cfg.domain}`;
  const block = rules.split('\n\n').find((b) => b.includes(`to:${addr}`));
  const id = block?.match(/Rule:\s*(\w+)/)?.[1];
  const args = [
    cfg.domain,
    ...(id ? [id] : []),
    '--name',
    `feelings-staff ${local}`,
    '--match-type',
    'literal',
    '--match-field',
    'to',
    '--match-value',
    addr,
    '--action-type',
    'forward',
    '--action-value',
    cfg.destination,
  ];
  console.info(`${id ? 'updating' : 'creating'} ${addr} -> ${cfg.destination}`);
  if (!dry) wr('rules', id ? 'update' : 'create', ...args);
}
