# Production setup guide

A step-by-step path from "nothing exists" to "Urmi's team is checking in". It is written for whoever deploys the app (today that is Harsh) and it names the points where Urmi must do something herself.

This page is the short, ordered path. The full reasons, options and fixes are in the [deploy guide](../deploy.md). Every command here comes from the repo's scripts and workflows, and each step says where to read more.

Contents: [What you need](#what-you-need) · [Step 1. Cloudflare account](#step-1-cloudflare-account) · [Step 2. Database and file storage](#step-2-database-and-file-storage) · [Step 3. Put the ids in the config](#step-3-put-the-ids-in-the-config) · [Step 4. GitHub access to Cloudflare](#step-4-github-access-to-cloudflare) · [Step 5. Secrets](#step-5-secrets) · [Step 6. Email](#step-6-email) · [Step 7. First deploy](#step-7-first-deploy) · [Step 8. Domain](#step-8-domain) · [Step 9. Create the owner](#step-9-create-the-owner) · [Step 10. First owner sign-in](#step-10-first-owner-sign-in) · [Step 11. The setup wizard](#step-11-the-setup-wizard) · [Step 12. Add staff](#step-12-add-staff) · [Step 13. Put the app on phones](#step-13-put-the-app-on-phones) · [Step 14. The door code](#step-14-the-door-code) · [Step 15. Check before the salon relies on it](#step-15-check-before-the-salon-relies-on-it) · [If a step fails](#if-a-step-fails)

## What you need

- The salon's Cloudflare account, with **Workers Paid** on (about $5 a month). The app needs it for CPU time, Email Sending and Browser Run (payslip PDFs).
- The domain `feelingsbeautycare.in` on that Cloudflare account.
- Admin rights on the GitHub repo `harshbhx/feelings-staff`.
- On your own machine (never on a shared server): Node 22, pnpm (`corepack enable`), the GitHub CLI signed in (`gh auth login`), and a clone of the repo with `pnpm install` done.
- Urmi's own email address. It is the key to the owner account, so it must be one she controls and reads.

Two rules for the whole guide:

- Secrets are made on your machine and go straight into Wrangler. Do not paste them into chats, issues, pull requests or logs.
- Changes to `app/wrangler.jsonc` go through a pull request like all other changes. Only docs-only changes skip the deploy.

## Step 1. Cloudflare account

1. Sign in at the Cloudflare dashboard with the salon's account. If the salon has none, create one with an email Urmi owns, and give yourself access under Manage Account, Members.
2. Add the domain if it is not there yet (Websites, Add a domain) and move the nameservers at the registrar as Cloudflare says.
3. Turn on **Workers Paid** (Compute, Workers and Pages, Plans).
4. Sign Wrangler in to this account from the repo:

```sh
cd app
npx wrangler login
npx wrangler whoami
```

`whoami` must show the salon's account. If it shows another one, stop and sign in again.

## Step 2. Database and file storage

Run once, from `app/`:

```sh
npx wrangler d1 create fbc-staff --location apac
npx wrangler d1 create fbc-staff-preview --location apac
npx wrangler r2 bucket create fbc-staff-media
npx wrangler r2 bucket create fbc-staff-media-preview
```

Each `d1 create` prints a `database_id`. Write both down. The R2 buckets stay private: do not add a public address to them.

Then set the storage clean-up rules (selfies 30 days, exports 7 days, backups 90 days). They need the API token from step 4, so come back to this after step 4:

```sh
gh workflow run r2-lifecycle -f mode=apply
gh workflow run r2-lifecycle -f mode=check
```

The `check` run must pass. It also runs by itself every Monday and fails if a rule is missing.

## Step 3. Put the ids in the config

Open one pull request that changes:

| File | Field | Value |
|---|---|---|
| `app/wrangler.jsonc` | top-level `d1_databases[0].database_id` | the `fbc-staff` id |
| `app/wrangler.jsonc` | `previews.d1_databases[0].database_id` | the `fbc-staff-preview` id |
| `app/wrangler.preview-migrations.jsonc` | `d1_databases[0].database_id` | the `fbc-staff-preview` id |
| `app/wrangler.jsonc` | `vars.OWNER_BOOTSTRAP_EMAIL` | Urmi's email |
| `app/wrangler.jsonc` | `vars.VAPID_PUBLIC_KEY` | filled in at step 5 |

The production id is `00000000-0000-0000-0000-000000000000` until you replace it. The preview ids in the repo are already filled in; replace them with the new ones if the previews should live on the salon's account. While it is in place, deploys fail on purpose, so nothing goes live half set up. Only the address in `OWNER_BOOTSTRAP_EMAIL` can ask for the first sign-in link.

Do not merge this pull request until step 5 is done, so you can add the VAPID public key to the same change.

## Step 4. GitHub access to Cloudflare

1. Cloudflare dashboard, My Profile, API Tokens, create a custom token on the salon's account with these permissions: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read. Give it no zone or DNS permission.
2. In the GitHub repo, Settings, Secrets and variables, Actions, add two repository secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (the account id, shown on the Workers and Pages page).
3. Settings, Environments, create an environment called `production`. Add yourself as a required reviewer if you want a click before each production deploy.
4. After the first CI run, switch on branch protection for `main`: required checks `ci`, `e2e` and `preview`, merge commits only.

Until the two secrets exist, the `preview` and `deploy` workflows print a notice and do nothing. That is safe.

## Step 5. Secrets

The Worker needs eight secrets. `scripts/gen-secrets.mjs` makes fresh values and passes each one straight to Wrangler, so you never see or store them. From `app/`:

```sh
cd app
node ../scripts/gen-secrets.mjs --wrangler \
  | tee >(grep '^# Then set' >&2) \
  | grep -v '^#' | bash
```

The last line printed starts with `# Then set the variable VAPID_PUBLIC_KEY=`. That value is public. Put it into `vars.VAPID_PUBLIC_KEY` of `app/wrangler.jsonc` (in the pull request from step 3), and into `previews.vars.VAPID_PUBLIC_KEY` if you use the same key for previews.

Do not run the generator a second time without setting the public key again. The public and private keys must match.

For the shared preview environment, run the same command with `--preview` added after `--wrangler`. It makes different values.

Check the names are set (it shows names only, never values):

```sh
npx wrangler secret list
```

You should see `SESSION_SECRET`, `PIN_PEPPER`, `TIME_SIGNING_KEY`, `IP_HMAC_KEY`, `QR_MASTER_KEY`, `PUNCH_ENC_PRIVATE_JWK`, `VAPID_PRIVATE_JWK` and `SETUP_TOKEN`. If Wrangler offers to create the Worker before the first secret, accept.

Now merge the pull request from step 3.

## Step 6. Email

Owner sign-in links and codes, the payroll and weekly digest emails are sent by Cloudflare Email Service in production. Previews never send real email: they put each message in the outbox, which the tests read.

1. Verify the sending domain. Dashboard, Compute, Email Service, Email Sending, Onboard Domain, pick `feelingsbeautycare.in`, and wait until it shows as verified. Cloudflare adds its records on a separate sub-domain, so existing email routing is not touched. Status today: `feelingsbeautycare.in` is already enabled for Email Sending in the DualMind Labs Cloudflare account and its DNS records are live, so for that account this step is done. Check that the dashboard still shows it as verified.
2. Send a test sign-in email to the owner. After the first deploy (step 7) ask Urmi to request a link on the sign-in page, or request it for her address yourself, and confirm that it arrives with a link and a 6-digit code.
3. Check spam. Look in Urmi's spam or junk folder if it is not in the inbox, and mark it as not spam. If it landed there, check that SPF, DKIM and DMARC show as valid for the sending domain before you go on.

The sender is already set in the config as `staff@feelingsbeautycare.in`. Email problems and the fallback are in the [deploy guide](../deploy.md#4-email).

**Known limitation: English only.** Gujarati and Hindi are not shipped. The staff app and the owner app are in English only. The language switch in the staff app's **Me** tab exists, but the Gujarati texts are not written yet, so every screen stays in English. Plan the first weeks with that in mind (a short demo in Gujarati from Urmi helps).

## Step 7. First deploy

Without the custom domain, the deploy's last check would call an address that does not exist yet. So for this one deploy:

1. In GitHub, Settings, Secrets and variables, Actions, Variables, add `PRODUCTION_URL` with the Workers address: `https://feelings-staff.<your-subdomain>.workers.dev`.
2. Start the deploy. It also starts by itself when `e2e` passes on `main`.

```sh
gh workflow run deploy
gh run list --workflow deploy --limit 1
gh run watch <run-id> --exit-status
```

The deploy builds, saves a copy of the database as a `d1-backup` file, applies the migrations, publishes the app, checks `/api/v1/health`, `/api/v1/config` and the home page, and tags the commit `vYYYY.MM.DD-N`.

3. Open the Workers address. You should see the app. `/api/v1/health` should answer `{"ok":true,...}`.

## Step 8. Domain

Done by hand, because the GitHub token has no DNS rights.

1. Dashboard, Workers and Pages, `feelings-staff`, Settings, Domains and Routes, Add, Custom domain, `staff.feelingsbeautycare.in`.
2. Wait a few minutes. Error 522 while the certificate is being issued is normal.
3. Open `https://staff.feelingsbeautycare.in/api/v1/health`. It must answer `ok`.
4. Delete the `PRODUCTION_URL` variable in GitHub.
5. Turn off the `workers.dev` route for production (same page). Keep Preview URLs on.

## Step 9. Create the owner

The organisation and the owner are created once, with a one-time setup token. The call refuses to run a second time. It is a protected call, so it needs the two headers shown below.

```sh
cd app
SETUP_TOKEN=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')
printf '%s' "$SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN

curl -sS -X POST https://staff.feelingsbeautycare.in/api/v1/setup \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://staff.feelingsbeautycare.in' \
  -H 'X-FS-Client: 0.1.0' \
  -H "X-Setup-Token: $SETUP_TOKEN" \
  -d '{"orgName":"Feelings Beauty Care","ownerEmail":"<urmi email>","ownerName":"Urmi Mengar","ownerDisplayName":"Urmi"}'
unset SETUP_TOKEN
```

- `X-FS-Client` must be the `APP_VERSION` in `app/wrangler.jsonc` (it is `0.1.0` today). Check it before you run the call.
- The email must be exactly the one in `OWNER_BOOTSTRAP_EMAIL`, or the call answers status `422`.
- Confirm the spelling of Urmi's surname with her first.
- A good answer is status `201` with `{"orgId":"..."}`. Status `409` means the salon is already set up.

The call creates the salon with the default settings, the salon place, five shifts, the holidays and the leave types. Write one line in the [ops log](../ops-log.md): date and "owner bootstrapped".

## Step 10. First owner sign-in

Do this with Urmi, on her laptop first.

1. She opens `https://staff.feelingsbeautycare.in/auth/owner` and types her email.
2. She taps **Send me a sign-in link**. An email arrives with a link and a 6-digit code. Both work once and for 15 minutes.
3. On a laptop she clicks the link. On an iPhone with the app already on the home screen she types the code instead.
4. In **Settings, Security** she sets her **owner PIN** (6 digits) within 15 minutes of signing in, and a password if she wants one (at least 10 characters). The PIN is what the app asks for before important actions.

Help her keep her email account safe. Whoever controls it can sign in as the owner.

## Step 11. The setup wizard

The first sign-in opens **Setup**: "A few quick things, then you're ready." Each step can be skipped and finished later in Settings. Sit with Urmi and go through them:

1. **Salon.** Name, address and phone.
2. **Location.** The salon on a map with a 100 m circle. She taps **Looks right**, or **Calibrate** to measure it (see the [owner guide](owner.md#calibrate-the-salon-location-two-or-three-days)). Plan two or three days of calibration with two different phones.
3. **Opening hours and shifts.** Five shifts are ready. Change or remove them.
4. **Holidays.** Check the list and add no-leave days (for example wedding season).
5. **Pay rules.** Each rule has one line that says what it does. Go through them with her and her accountant before the first payroll.
6. **Selfie on check-in.** Off to begin with.
7. **Add your first staff member.**
8. **Install and notifications** on her own phone.

Show her **Time credits**, **Roll-call** and **Step out** too (see the [owner guide](owner.md#time-credits)).

## Step 12. Add staff

Up to 15 active staff can be added.

1. **Staff**, **Add staff**. Fill in name, mobile number, role, joining date, salary, shift, weekly off, language (English; Gujarati is not ready) and selfie. Tick that the person is 18 or older.
2. **Save and invite.** The share sheet opens with a ready WhatsApp message that holds a link and a join code. The link works for 48 hours.
3. When each person joins, a card **New phone for Priya** shows in **Needs action**. Urmi checks the phone name and taps **Approve** (it asks for her PIN). Nobody can check in before that.

Details: [owner guide, Add staff and approve phones](owner.md#add-staff-and-approve-phones).

## Step 13. Put the app on phones

The app must be on the home screen. It does not work inside the browser. Each person does this from the link in Urmi's message. The steps for staff are in the [staff guide](staff.md#put-the-app-on-your-phone). In short:

- **Android:** open the link in Chrome, tap **Install the app**, then open **Feelings** from the home screen. On Xiaomi, Oppo, Vivo, Realme and Samsung phones, set Chrome's battery use to **No restrictions**, or alerts arrive late.
- **iPhone:** the link must be opened in **Safari**. Tap Share, **Add to Home Screen**, **Add**. Pings only work for an iPhone app on the home screen.
- **Urmi's own phone:** the same way, then turn on notifications.

Then each person types their number and join code, reads the privacy notice, chooses a PIN and turns on notifications. After Urmi approves the phone, they can check in.

## Step 14. The door code

The door code is a QR that changes every 30 seconds. It is extra proof of presence, and it cannot be printed, because a printed copy would stop working in half a minute. Pick one of two ways:

- **Urmi's phone.** In **More**, tap **Show door code**. It shows a full-screen QR with a countdown and needs internet.
- **A screen at the door.** Use an old phone or tablet that stays plugged in. In **Settings, Door code**, tap **Pair a door device** (PIN). It shows a pairing code for 10 minutes. On the old phone, open `https://staff.feelingsbeautycare.in/door` and type the code. The screen then shows the QR, the countdown and the last check-in.

Staff scan it with **Scan door code** in the app. Nothing happens if someone opens the QR with the normal camera: they only see "Open Feelings and tap Scan door code". Door code for everyone ("strong mode") is in Settings, and is best switched on later, when the team is used to the app.

## Step 15. Check before the salon relies on it

- Run the first month next to the paper register.
- On a low-end Android with Chrome and on an iPhone, do each of these once: install, join, check in inside the salon, scan the door code, receive a ping with the app closed, check in with the phone in airplane mode and watch it send later, share a payslip PDF on WhatsApp.
- Confirm the privacy notice text and the grievance contact (Urmi's name and number) in **Settings, Data and privacy**.
- Sign the one-page agreement between the salon and Harsh as the one who runs the system.
- Do one backup check: [backup and restore, verify](../runbooks/backup-restore.md#verify-a-backup).
- Read [Daily and monthly operations](../runbooks/operations.md) together.

## If a step fails

| What you see | Likely cause | Fix |
|---|---|---|
| Deploy fails at the migration or publish step | The production `database_id` is still the placeholder | Step 3 |
| `preview` or `deploy` print "skipped" | The two GitHub secrets are missing | Step 4 |
| The setup call answers `403` | Wrong or missing `X-Setup-Token`, or the token secret is not set | Redo the first part of step 9 |
| The setup call answers `403` and the error code is `CSRF` | `Origin` or `X-FS-Client` header missing or wrong | Check both headers in step 9 |
| The setup call answers `409` | The salon already exists | Nothing to do. Sign in. |
| The sign-in email never arrives | Email domain not verified, or wrong address | Step 6. The address must equal `OWNER_BOOTSTRAP_EMAIL`. |
| Error 522 on the domain | Certificate still being issued | Wait a few minutes |

For problems after go-live, see [troubleshooting](../runbooks/troubleshooting.md).
