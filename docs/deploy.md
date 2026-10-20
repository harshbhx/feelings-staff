# Deploy and go-live guide

For Harsh. This takes the project from "code is merged" to "Urmi can sign in at `https://staff.feelingsbeautycare.in`", then covers rollback and the preview environment. It follows PRD 15.3 and 15.4 and matches the workflows in `.github/workflows/`.

Everything below happens on your own machine and in the Cloudflare and GitHub dashboards. Nothing heavy runs on the shared VM.

Contents: [Before you start](#before-you-start) · [1. Create the resources](#1-create-the-resources) · [2. API token and GitHub secrets](#2-api-token-and-github-secrets) · [3. Worker secrets](#3-worker-secrets) · [4. Email](#4-email) · [5. First deploy](#5-first-deploy) · [6. Custom domain](#6-custom-domain) · [7. Create the owner](#7-create-the-owner) · [8. Switch off workers.dev](#8-switch-off-workersdev) · [9. Before the salon uses it](#9-before-the-salon-uses-it) · [Deploys after that](#deploys-after-that) · [Rollback](#rollback) · [Preview environment](#preview-environment) · [Reference](#reference)

## Before you start

- **Workers Paid is already active** on the salon's Cloudflare account (PRD question Q16 is answered). The app needs it for CPU time, Email Sending and Browser Run. About $5 a month in total.
- The repo `harshbhx/feelings-staff` exists and the platform PR is merged.
- On your machine: Node 22, pnpm (`corepack enable`), the GitHub CLI signed in, and Wrangler signed in to the salon's account (`npx wrangler login` from `app/`, after `pnpm install`).
- Choose where each value comes from. Secrets are made on your machine and go straight into Wrangler. They are never pasted into chats, issues, PRs or logs.

## 1. Create the resources

Run these once (from `app/` so Wrangler is available):

```sh
npx wrangler d1 create fbc-staff --location apac
npx wrangler d1 create fbc-staff-preview --location apac
npx wrangler r2 bucket create fbc-staff-media
npx wrangler r2 bucket create fbc-staff-media-preview
```

Each `d1 create` prints a `database_id`. Put them into the config in one PR (config changes go through a PR like everything else):

| File | Field | Value |
|---|---|---|
| `app/wrangler.jsonc` | top-level `d1_databases[0].database_id` | the `fbc-staff` id |
| `app/wrangler.jsonc` | `previews.d1_databases[0].database_id` | the `fbc-staff-preview` id |
| `app/wrangler.preview-migrations.jsonc` | `d1_databases[0].database_id` | the `fbc-staff-preview` id |

The placeholders today are `00000000-0000-0000-0000-000000000000` (production; the preview ids are already set). While they are in place, deploys and previews fail on purpose.

The R2 buckets stay private. Do not add a public URL or a custom domain to them. Lifecycle rules (selfies 30 days, exports 7 days, backups 90 days) are created by `scripts/r2-lifecycle.ts`. Once the API token from step 2 exists, run `gh workflow run r2-lifecycle -f mode=apply`, then `-f mode=check`. The workflow also checks every Monday. More in the [retention runbook](runbooks/retention-purge.md).

Also set the owner's email in the same PR: `OWNER_BOOTSTRAP_EMAIL` in `vars` of `app/wrangler.jsonc` (Urmi's own email, PRD Q18). Only this address can request the first sign-in link.

## 2. API token and GitHub secrets

1. Cloudflare dashboard, My Profile, API Tokens, create a custom token on the salon's account with these account permissions:
   - Workers Scripts: Edit
   - D1: Edit
   - Workers R2 Storage: Edit
   - Account Settings: Read
   - Add any other scope Wrangler asks for on the first preview or Browser Run deploy.
   - No zone or DNS permissions. The custom domain is attached by hand in the dashboard (step 6).
2. In the GitHub repo, Settings, Secrets and variables, Actions, add repository secrets:
   - `CLOUDFLARE_API_TOKEN`: the token.
   - `CLOUDFLARE_ACCOUNT_ID`: the account id (Cloudflare dashboard, Workers and Pages, right-hand side).
3. Settings, Environments: create an environment named `production`. The `deploy` workflow runs in it. Add yourself as a required reviewer if you want a click before each production deploy.
4. After the first CI run, turn on branch protection for `main`: required checks `ci`, `e2e` and `preview`, merge commits only.

Until the two secrets exist, `preview` and `deploy` print a notice and do nothing.

## 3. Worker secrets

The Worker needs eight secrets (PRD 15.3): `SESSION_SECRET`, `PIN_PEPPER`, `TIME_SIGNING_KEY`, `IP_HMAC_KEY`, `QR_MASTER_KEY`, `PUNCH_ENC_PRIVATE_JWK`, `VAPID_PRIVATE_JWK` and `SETUP_TOKEN`. `scripts/gen-secrets.mjs --wrangler` creates fresh values and prints one `wrangler secret put` command per secret, with the value passed through stdin.

Run it from `app/`, piping the commands straight into the shell so the values never appear on screen or in a file. The `tee` keeps the one line you need to read, the public VAPID key:

```sh
cd app
node ../scripts/gen-secrets.mjs --wrangler \
  | tee >(grep '^# Then set' >&2) \
  | grep -v '^#' | bash
```

The last printed line looks like `# Then set the variable VAPID_PUBLIC_KEY=... in wrangler.jsonc vars.` Copy that value (it is public) into `vars.VAPID_PUBLIC_KEY` of `app/wrangler.jsonc`, and into `previews.vars.VAPID_PUBLIC_KEY` if you use the same key for previews, in a PR. The public key must match the private key you just stored, so do not run the generator a second time without setting both again.

For previews, run the same command with `--preview` (it uses `wrangler preview secret put` and also sets `E2E_TOKEN` for the `/__test/*` routes). Use different values from production; the script always generates fresh ones.

If Wrangler offers to create the Worker before the first secret, accept.

Check what is set, without seeing values:

```sh
npx wrangler secret list
```

Optional secrets, only if you use them: `RESEND_API_KEY` (when `EMAIL_PROVIDER=resend`) and the WhatsApp secrets (P1, not built). The variables `ENV`, `APP_ORIGIN`, `APP_VERSION`, `MIN_APP_VERSION`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `VAPID_SUBJECT` and `OWNER_BOOTSTRAP_EMAIL` live in `app/wrangler.jsonc`. Rotation of each secret: [secrets runbook](runbooks/secrets.md).

## 4. Email

Owner sign-in links and codes, and the payroll and weekly digest emails, are sent by Cloudflare Email Service in production ([ADR-09](decisions/0009-email-through-cloudflare-email-service.md)). Preview (`EMAIL_PROVIDER=outbox`) never sends: messages go to the outbox. `feelingsbeautycare.in` is already enabled for Email Sending in the DualMind Labs Cloudflare account and its DNS records are live; do the steps below only for a different account.

1. Dashboard, Compute, Email Service, Email Sending, Onboard Domain, choose `feelingsbeautycare.in`.
2. Cloudflare adds SPF, DKIM and DMARC records on the `cf-bounce` subdomain, so the existing Email Routing MX records are not touched. Wait until the domain shows as verified.
3. The sender is already set in the config: `EMAIL_FROM` is `Feelings Staff <staff@feelingsbeautycare.in>`, and the `send_email` binding allows only `staff@feelingsbeautycare.in`.

If Email Sending misbehaves while in beta, set `EMAIL_PROVIDER` to `resend` and add `RESEND_API_KEY`. The owner can also sign in with a password and PIN once set (Settings, Security).

## 5. First deploy

1. Merge the PR with the database ids, the owner email and the VAPID public key. When `e2e` finishes green on `main`, the `deploy` workflow runs. You can also start it by hand: `gh workflow run deploy`.
2. Before the custom domain exists, the smoke step of `deploy` would call `https://staff.feelingsbeautycare.in` and fail. For this first deploy, set a repository variable `PRODUCTION_URL` (Settings, Secrets and variables, Actions, Variables) to the `workers.dev` address, `https://feelings-staff.<your-subdomain>.workers.dev`. Delete the variable after step 6.
3. The workflow builds, exports the production database to an artifact (`d1-backup`, kept 30 days), applies the migrations, deploys, checks `/api/v1/health`, `/api/v1/config` and the home page, and tags the commit `vYYYY.MM.DD-N`.
4. Open the `workers.dev` address. You should see the app shell. `GET /api/v1/health` should answer `{"ok":true,...}`.

Look at the run with `gh run watch <id> --exit-status` and `gh run view <id> --log-failed`.

## 6. Custom domain

Done by hand because the CI token has no DNS rights.

1. Dashboard, Workers and Pages, `feelings-staff`, Settings, Domains and Routes, Add, Custom domain, `staff.feelingsbeautycare.in`.
2. Cloudflare creates the DNS record and the certificate. A few minutes of error 522 while the certificate is issued is normal.
3. HSTS from the apex already forces HTTPS.
4. Check `https://staff.feelingsbeautycare.in/api/v1/health`, then delete the `PRODUCTION_URL` variable so the smoke step uses the default again.

## 7. Create the owner

The first owner and the organisation are created once, with the one-time setup token. The endpoint `POST /api/v1/setup` refuses to run again after that (PRD 4.1.7). It is a protected call, so it needs the CSRF headers described in the [API reference](api.md#csrf-and-versioning).

1. Make a fresh setup token and store it as the secret, keeping a copy in your shell only:

```sh
cd app
SETUP_TOKEN=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')
printf '%s' "$SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN
```

2. Call the endpoint. Use the `APP_VERSION` from `app/wrangler.jsonc` for `X-FS-Client`, and Urmi's email (the same as `OWNER_BOOTSTRAP_EMAIL`):

```sh
curl -sS -X POST https://staff.feelingsbeautycare.in/api/v1/setup \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://staff.feelingsbeautycare.in' \
  -H 'X-FS-Client: 0.1.0' \
  -H "X-Setup-Token: $SETUP_TOKEN" \
  -d '{"orgName":"Feelings Beauty Care","ownerEmail":"<urmi email>","ownerName":"Urmi Mengar","ownerDisplayName":"Urmi"}'
```

   A good answer is `201` with `{"orgId":"..."}`. Confirm the spelling of Urmi's surname with her first (PRD header).
3. Close the shell, or `unset SETUP_TOKEN`.
4. Send Urmi the sign-in page, `https://staff.feelingsbeautycare.in/auth/owner`. She enters her email, gets a link and a 6-digit code, and signs in. Then follow the first-run checklist in the [owner guide](guides/owner.md#set-up-the-app-first-time).
5. Write one line in the [ops log](ops-log.md): date, "owner bootstrapped".

## 8. Switch off workers.dev

When the custom domain works: Settings, Domains and Routes, turn off the `workers.dev` route for production. Keep Preview URLs on. Then confirm the old address no longer answers.

## 9. Before the salon uses it

- Sign the one-page processor agreement with Urmi (salon is the data fiduciary, you are the processor; PRD Q17).
- Real-device checks (PRD 14.6), once, on the preview URL or production: a low-end Android with Chrome and an iPhone. Install, join, check in inside the salon with real GPS, scan the door code, receive a push with the app closed, check in offline in airplane mode and watch it sync, share a payslip PDF on WhatsApp. Record the result in the release PR.
- Run the first month in parallel with the paper register (PRD Q19).
- Confirm the privacy notice text and the grievance contact in Settings.

## Deploys after that

Every merge to `main` that passes `ci` and `e2e` deploys by itself. Docs-only merges do not (the workflows skip them). Each deploy first exports the production database and keeps it as an artifact for 30 days, so there is always a copy from just before the migration. To deploy a commit by hand: `gh workflow run deploy --ref main`.

Migrations are additive: never drop or rename a column in the same release as the code that stops using it. A bad migration is fixed with a new migration, not by editing an old one ([data model](data-model.md#migrations)).

## Rollback

There are two separate things to roll back: the code, and the data.

**Code.** The Worker and its assets are versioned together, so one command goes back to the previous version:

```sh
cd app
npx wrangler deployments list          # recent deployments
npx wrangler rollback                  # to the previous version
npx wrangler rollback <version-id>     # to a chosen version
```

The dashboard has the same under Workers and Pages, `feelings-staff`, Deployments. Afterwards, check `/api/v1/health`, then fix forward with a revert PR so `main` matches what is live; otherwise the next deploy puts the bad version back.

A rollback does not touch the database. Because migrations are additive, the previous code still works with the new schema.

**Data.** D1 Time Travel keeps 30 days of history:

```sh
npx wrangler d1 time-travel info fbc-staff
npx wrangler d1 time-travel restore fbc-staff --timestamp=<ISO time>
```

A restore rewinds the whole database and loses everything written after that time. Read the [backup and restore runbook](runbooks/backup-restore.md) first, take an export, and tell Urmi. Write the action in the [ops log](ops-log.md).

If something is leaking or being abused rather than just broken, use the [incident runbook](runbooks/incident.md).

## Preview environment

Every ready (non-draft) PR from a branch in this repo gets its own Worker Preview, so you can try a change on your phone before it is merged.

- The `preview` workflow builds the PR, applies migrations to `fbc-staff-preview`, runs `wrangler preview --name pr-<number> --json`, smoke-tests the URL and posts `**Preview:** <url>` on the PR. Drafts and PRs from forks are skipped, and so is everything until the Cloudflare secrets exist.
- All previews share one database (`fbc-staff-preview`) and one bucket (`fbc-staff-media-preview`). The E2E tests reset the data with `POST /api/v1/__test/reset`.
- Previews run with `ENV=preview`: emails and pushes are captured in the outbox instead of being sent, the `/__test/*` routes work with `X-E2E-Token`, and the fake clock is available. Scheduled jobs do not run on previews; tests call `/__test/cron`.
- The shared preview secrets are set with `gen-secrets.mjs --wrangler --preview` (step 3).
- Preview URL: to be added here by the lead once the first preview is live.

## Reference

Cloudflare items used and what they cost (about $5 a month in total, PRD 15.5):

| Item | Used for | Cost |
|---|---|---|
| Workers Paid | The Worker, D1, R2, crons, rate limiting | $5 a month |
| Browser Run | Payslip PDFs (10 browser hours included, about 1 minute used a month) | included |
| Email Sending | Sign-in links (3,000 a month included) | included |

Related: [setup guide](setup.md), [secrets runbook](runbooks/secrets.md), [backup runbook](runbooks/backup-restore.md), [ops log](ops-log.md).
