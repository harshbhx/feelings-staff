# Secrets runbook

Rotation procedure for every secret the app uses (PRD 10.3 and 15.3). The names are the same in production and in previews; previews use their own, different values.

Contents: [Rules](#rules) · [Inventory](#inventory) · [How to rotate](#how-to-rotate) · [Per secret](#per-secret) · [After any rotation](#after-any-rotation)

## Rules

- Secrets are made on Harsh's machine and go straight into Wrangler or GitHub. They are never pasted into chats, issues, PRs, commits or logs.
- Rotate when a secret may have leaked ([incident runbook](incident.md)), when a person who knew it leaves, or on the routine schedule below. Several rotations have side effects on people, so each section says what breaks and when to do it.
- Write every rotation in the [ops log](../ops-log.md): date, which secret, why. Never write the value.
- `wrangler secret put` creates a new Worker version at once. There is no separate deploy step, and the old value stops working for new requests within seconds.
- `.dev.vars` and the throwaway secrets that CI generates for every run are unrelated to production; they need no rotation.

## Inventory

| Secret | Where it lives | What it protects | Side effect of rotating | Routine |
|---|---|---|---|---|
| `SESSION_SECRET` | Worker | HMAC of join codes, magic codes and door pairing codes stored in D1 | Open invites, sign-in links and pairing codes stop working; issue new ones | Not needed |
| `PIN_PEPPER` | Worker | PIN and owner password hashes | **Every PIN and the owner password stop working**; all must be reset | Only on compromise |
| `TIME_SIGNING_KEY` | Worker | Server-signed time used to bound offline punches | Queued offline punches that carry an old time anchor go to approval | Not needed |
| `IP_HMAC_KEY` | Worker | Hashes of IP addresses (rate limits, salon network, audit) | Salon network recognition restarts from zero; old hashes no longer match | Not needed |
| `QR_MASTER_KEY` | Worker | Encrypts door secrets at rest | Stored door secrets can no longer be read; door devices must be paired again | Only on compromise |
| `PUNCH_ENC_PRIVATE_JWK` | Worker | Opens the sealed PIN of offline punches | Offline punches sealed with the old public key cannot be opened | Only on compromise |
| `VAPID_PRIVATE_JWK` and var `VAPID_PUBLIC_KEY` | Worker, `app/wrangler.jsonc` | Signs Web Push | **Every push subscription stops working**; each phone must subscribe again | Only on compromise |
| `SETUP_TOKEN` | Worker | One-time creation of the organisation and owner | None once the owner exists | After use, optional |
| `RESEND_API_KEY` | Worker (only if `EMAIL_PROVIDER=resend`) | Sending email through Resend | None | Yearly, or on compromise |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Worker (P1, not built) | WhatsApp Cloud API | None | Per Meta's expiry |
| `E2E_TOKEN` | Worker (preview only) | `/__test/*` routes on previews | Test runs against the preview need the new value | Yearly, or on compromise |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Deploys, previews, D1 and R2 operations from CI | CI cannot deploy until the new token is stored | Yearly, or on compromise |

The owner's password, owner PIN and every staff PIN are not secrets of the system. They are people's credentials and are reset in the app ([staff profile, Reset PIN](../guides/owner.md#add-staff-and-approve-phones), [owner security](../guides/owner.md#your-own-sign-in-and-security)).

## How to rotate

Run on your own machine, in `app/`, signed in to the salon's Cloudflare account (`npx wrangler login`).

### Generate and set one secret

`scripts/gen-secrets.mjs --wrangler` prints one `wrangler secret put <NAME>` command for every secret, each with a fresh value passed through stdin. To rotate one secret, keep only its line and run that, so the value never shows on screen:

```sh
cd app
node ../scripts/gen-secrets.mjs --wrangler | grep ' put PIN_PEPPER$' | bash
```

Replace `PIN_PEPPER` with the name. For previews use `--preview`, which prints `wrangler preview secret put` commands:

```sh
node ../scripts/gen-secrets.mjs --wrangler --preview | grep ' put E2E_TOKEN$' | bash
```

Check that it is set (names only, never values):

```sh
npx wrangler secret list
```

### VAPID keys come as a pair

The private key is a secret and the public key is a variable in `app/wrangler.jsonc`. Set them together:

```sh
node ../scripts/gen-secrets.mjs --wrangler \
  | tee >(grep '^# Then set' >&2) \
  | grep ' put VAPID_PRIVATE_JWK$' | bash
```

The printed line `# Then set the variable VAPID_PUBLIC_KEY=...` holds the new public key. Put it into `vars.VAPID_PUBLIC_KEY` (and `previews.vars` if you use the same pair) in a PR and deploy. Until that deploy is live, `GET /config` serves the old public key, so do both quickly.

### Secrets you create elsewhere

- `RESEND_API_KEY`: create a new key in Resend, `printf '%s' '<key>' | npx wrangler secret put RESEND_API_KEY` typed into your own terminal, then delete the old key in Resend.
- `CLOUDFLARE_API_TOKEN`: create a new token with the same scopes ([deploy guide](../deploy.md#2-api-token-and-github-secrets)), update the GitHub secret (`gh secret set CLOUDFLARE_API_TOKEN`), run a harmless workflow (`gh workflow run deploy` only if you mean to deploy; otherwise open a draft PR and let `preview` run), then revoke the old token in the Cloudflare dashboard.

## Per secret

### SESSION_SECRET

1. Rotate it (command above).
2. Anything that was waiting on a code now fails: invites not yet used, magic links and door pairing codes. Ask Urmi to re-send open invites (staff profile, Re-send invite).
3. Existing sessions are not affected, because the database stores a SHA-256 of the session token, not a keyed hash.

### PIN_PEPPER

Rotate only when it may have leaked. Everyone's PIN stops working at once.

1. Pick a quiet time (before opening, or after closing) and tell Urmi first.
2. Rotate the secret.
3. Owner: request a sign-in link (the magic link does not need a PIN), then set a new owner PIN and, if used, the password again (Settings, Security).
4. Staff: Urmi opens each staff profile and taps Reset PIN, then sends the invite. Each person types their new code and sets a new PIN. Their devices stay approved.
5. Until a person has done that, they cannot check in; tell them they can use "Send to Urmi" or ask Urmi to fix the day afterwards.

### TIME_SIGNING_KEY

1. Rotate outside working hours, when nobody has queued offline check-ins.
2. Phones fetch a new signed time the next time they are online. A punch queued before the change carries an old anchor; the server cannot verify it and sends it to Urmi's Needs action queue instead of accepting it silently.

### IP_HMAC_KEY

1. Rotate it.
2. The salon network signal (which lowers the risk score for check-ins from the salon's own network) is learned again from the owner's and the door device's sessions within about 72 hours. Until then a few more check-ins may be flagged.
3. Old hashes in `audit_log.ip_hmac` and `sessions.ip_hmac` no longer match new ones; note the date in the ops log for anyone reading old rows.

### QR_MASTER_KEY

Rotate only on compromise. Stored door secrets are encrypted with it and cannot be read after the change.

1. Rotate the secret.
2. Owner: Settings, Door code. Unpair the old door device and pair it again with a new code (needs the step-up PIN). Pairing creates a new secret.
3. Check "Show door code" on the owner's phone. If it fails, pair a door device again, which creates a fresh site secret.
4. Until then the door code does not validate, so strong mode would block check-ins. If strong mode is on, turn it off for the gap (Settings, Location and door) and back on afterwards.

### PUNCH_ENC_PRIVATE_JWK

Rotate only on compromise. It is an RSA-OAEP private key; the public half is served by `GET /config`.

1. Rotate outside working hours.
2. Phones read the new public key the next time they load `/config`. A punch sealed before the change cannot be opened by the server; it goes to the owner's queue with a reason, and the person can send it again.

### VAPID_PRIVATE_JWK and VAPID_PUBLIC_KEY

Rotate only on compromise. Push subscriptions are tied to the public key, so they all stop working.

1. Set the key pair and deploy the new public key (see above).
2. Every phone has to subscribe again. In the app this is the notifications switch in Me and the prompt after sign-in; ask each person to open the app and check it shows notifications on. Until then they get the in-app inbox only. Urmi should do this first on her own phone.

### SETUP_TOKEN

Used once to create the organisation and owner ([deploy guide, step 7](../deploy.md#7-create-the-owner)). After that it has no use. Replace it with a new random value or leave it; the endpoint refuses to run once an owner exists.

### E2E_TOKEN (preview)

The `e2e` and `snapshots` workflows create their own token on every run, so only the shared preview needs this value. Rotate with `--preview` as above. Do not set `E2E_TOKEN` in production: the test routes answer 404 there whatever the token.

## After any rotation

1. `curl -fsS https://staff.feelingsbeautycare.in/api/v1/health` answers `ok`.
2. Sign in as the owner (link and code) to prove sign-in still works.
3. Add the line to the [ops log](../ops-log.md).
4. If the rotation followed a leak, go back to the [incident runbook](incident.md) and finish "Assess" and "Tell Urmi".
