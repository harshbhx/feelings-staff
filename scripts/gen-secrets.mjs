#!/usr/bin/env node
/**
 * Generates the Worker secrets (PRD 15.3).
 *
 *   node scripts/gen-secrets.mjs --dev-vars app/.dev.vars [--env local] [--e2e-token X]
 *       writes a .dev.vars file with fresh throwaway secrets (CI E2E and local runs).
 *   node scripts/gen-secrets.mjs --wrangler [--preview]
 *       prints `wrangler secret put` commands with fresh values, for Harsh to run on his machine.
 *       Values are piped through stdin; nothing is written to disk.
 *
 * generateTestSecrets() is also used by app/vitest.config.ts for the Workers API tests.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** @returns {Record<string, string>} */
export function generateTestSecrets() {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const punchJwk = {
    ...rsa.privateKey.export({ format: 'jwk' }),
    alg: 'RSA-OAEP-256',
    key_ops: ['decrypt'],
  };
  const vapid = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const vapidPrivate = vapid.privateKey.export({ format: 'jwk' });
  const vapidPublic = vapid.publicKey.export({ format: 'jwk' });
  const vapidPublicRaw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(vapidPublic.x, 'base64url'),
    Buffer.from(vapidPublic.y, 'base64url'),
  ]);
  return {
    SESSION_SECRET: b64url(randomBytes(32)),
    PIN_PEPPER: b64url(randomBytes(32)),
    TIME_SIGNING_KEY: b64url(randomBytes(32)),
    IP_HMAC_KEY: b64url(randomBytes(32)),
    QR_MASTER_KEY: b64url(randomBytes(32)),
    PUNCH_ENC_PRIVATE_JWK: JSON.stringify(punchJwk),
    VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivate),
    VAPID_PUBLIC_KEY: b64url(vapidPublicRaw),
    SETUP_TOKEN: b64url(randomBytes(24)),
    E2E_TOKEN: b64url(randomBytes(24)),
  };
}

const SECRET_NAMES = [
  'SESSION_SECRET',
  'PIN_PEPPER',
  'TIME_SIGNING_KEY',
  'IP_HMAC_KEY',
  'QR_MASTER_KEY',
  'PUNCH_ENC_PRIVATE_JWK',
  'VAPID_PRIVATE_JWK',
  'SETUP_TOKEN',
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : (process.argv[i + 1] ?? '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = generateTestSecrets();
  const devVars = arg('--dev-vars');
  if (devVars) {
    const env = arg('--env') ?? 'local';
    if (arg('--e2e-token')) s.E2E_TOKEN = arg('--e2e-token');
    const lines = [
      `ENV=${env}`,
      'EMAIL_PROVIDER=outbox',
      'APP_ORIGIN=',
      // Single quotes: dotenv keeps the value literal. Double quotes would keep the `\"` escapes
      // of the JSON values (PUNCH_ENC_PRIVATE_JWK, VAPID_PRIVATE_JWK), which then fail to parse.
      ...Object.entries(s).map(([k, v]) => `${k}='${v}'`),
    ];
    writeFileSync(devVars, `${lines.join('\n')}\n`, { mode: 0o600 });
    console.info(`Wrote ${devVars} (${Object.keys(s).length} throwaway secrets).`);
  } else if (process.argv.includes('--wrangler')) {
    const preview = process.argv.includes('--preview');
    const cmd = preview ? 'npx wrangler preview secret put' : 'npx wrangler secret put';
    console.info(
      '# Run inside app/. Each value goes through stdin; do not paste them anywhere else.',
    );
    for (const name of [...SECRET_NAMES, ...(preview ? ['E2E_TOKEN'] : [])]) {
      console.info(`printf '%s' '${s[name].replace(/'/g, "'\\''")}' | ${cmd} ${name}`);
    }
    console.info(
      `# Then set the variable VAPID_PUBLIC_KEY=${s.VAPID_PUBLIC_KEY} in wrangler.jsonc vars.`,
    );
  } else {
    console.info(
      'Usage: gen-secrets.mjs --dev-vars <path> [--env local] [--e2e-token X] | --wrangler [--preview]',
    );
  }
}
