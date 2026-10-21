# Owner access: own host, Cloudflare Access, passkeys

Decision: [ADR-19](decisions/0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md). This page is the design and the build plan. The owner-facing steps will move into the [owner guide](guides/owner.md) when the cutover is done. This page is for the people who build and run the app. **Staff documents never mention it.**

Contents: [What changes](#what-changes) · [The two hosts](#the-two-hosts) · [Cloudflare Access](#cloudflare-access) · [Passkeys](#passkeys) · [Data model](#data-model) · [API](#api) · [Screens](#screens) · [Build slices](#build-slices) · [Cutover and rollback](#cutover-and-rollback) · [What Harsh does in Cloudflare](#what-harsh-does-in-cloudflare) · [Risks](#risks)

## What changes

**Status:** slice 1a (Host-based routing behind `OWNER_HOST`, off by default) and slice 1b (split build, below) are built. Nothing changes in production until `OWNER_HOST` is set.

| Today | After |
|---|---|
| Owner and staff share `staff.feelingsbeautycare.in`; `/auth/owner` is public | The owner app lives on a random first-level subdomain (the "owner host"). The staff host answers 404 on every owner route and its build has no owner code. |
| Owner signs in with an email link and code, then a PIN | An Access wall (email one-time code, 7-day session) in front of the owner host, then a passkey (fingerprint or Face ID) on an approved device, plus the PIN for sensitive actions. No email-code login after the first device is enrolled. |
| One cookie, one service worker | Host-only cookies per host, a service worker and manifest per host |

Keep working throughout: the current owner sign-in stays on until the cutover step, so Urmi is never locked out.

## The two hosts

- Both hostnames are custom domains of the **same** Worker (one deploy, one D1). Requests are routed by the `Host` header:
  - staff host: staff entry, staff API groups, `/api/v1/auth/staff/*`, door and public pages. Owner paths: 404.
  - owner host: owner entry (its own `index` page, manifest, service worker scope `/`), owner API groups, owner auth. Staff paths: 404, except the shared read-only `health`.
- `APP_ORIGIN` becomes `APP_ORIGIN_STAFF` and `APP_ORIGIN_OWNER`; the Origin/CSRF check and the CSP use the list for the host that answers. Magic links, payslip links and the owner's emails use the owner host; invite and join links use the staff host.
- Vite builds two entries (`staff`, `owner`) into separate asset folders with separate `index` pages; the Worker serves only the folder for the host. The shared UI kit is a normal dependency of both. A CI step greps the staff folder for owner markers (route names, `owner` namespaces, the owner host) and fails on a hit.
- The owner host name is random, not guessable, and not committed: it is a Worker variable `OWNER_HOST` (and the Access application), recorded in the secrets runbook. It never appears in the repo, the staff bundle, staff docs, email footers to staff or logs shown to staff. The production Worker's `workers.dev` route is switched off at cutover.

### Build layout

`pnpm build` runs three client builds from one source tree:

| Build | Command | Output | Used when |
|---|---|---|---|
| combined | `vite build` (with the Worker) | `app/dist/client` | `OWNER_HOST` unset: one host serves everything, exactly as before |
| staff | `FS_SURFACE=staff vite build` | `app/dist/client/_s` | `OWNER_HOST` set: every host except the owner host |
| owner | `FS_SURFACE=owner vite build` | `app/dist/client/_o` | `OWNER_HOST` set: the owner host |

- Entries: `src/main.tsx` + `router.tsx` (combined), `main.staff.tsx` + `router.staff.tsx` (no `/o`, no `/auth/owner`, no owner shell, no lazy owner route table, no kit page, no mock mode, owner catalogs left out), `main.owner.tsx` + `router.owner.tsx` (owner sign-in and the owner panel). `__FS_SURFACE__` (see `src/lib/surface.ts`) folds owner links and paths out of the staff output.
- Each split folder has its own `index.html`, hashed `assets/`, `sw.js` (scope `/`) and `manifest.webmanifest` (derived from `public/manifest.webmanifest` by `app/build/split.ts`: staff without the owner shortcut and screenshot; owner "Feelings Owner", starts at `/o/today`).
- The Worker (`worker/lib/split-assets.ts`) serves the folder of the answering host as the site root: any path with a file extension must exist in the folder (a miss is a real 404), every other path gets the folder's shell. `/_s/*` and `/_o/*` answer 404 under their own names on every host. `/`, `/index.html`, `/sw.js` and `/manifest.webmanifest` are in `run_worker_first` for this; while `OWNER_HOST` is unset the Worker hands them to the assets unchanged.
- CI: `scripts/check-staff-bundle.mjs` fails when the staff folder holds an owner marker (and, with `--expect-hits`, when the combined build does not, so the check cannot go blind); `scripts/size-budgets.mjs` measures all three builds, the staff initial JS is strict (170 KB) in the split. The e2e workflow has a second run with `OWNER_HOST=owner.example.test:8787` (`E2E_SPLIT=1`, project `split-hosts`).

## Cloudflare Access

- A self-hosted application on the owner host, policy "owners": allow `urmi@feelingsbeautycare.in` and `creharsh@gmail.com`, identity provider One-time PIN, session duration 7 days. (Google sign-in can be added as a second provider later, no code change.)
- The Worker verifies `Cf-Access-Jwt-Assertion` on every owner-host request: RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `aud` equal to the application's audience tag, `exp`, `iss`, and the e-mail claim in an allow-list variable. Variables: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_ALLOWED_EMAILS`. Until they are set the check is off (so builds and previews work); once `ACCESS_AUD` is set it is mandatory and a missing or bad token answers 403 with no detail.
- The Access email is only a gate. Identity inside the app is the passkey. A person who passes Access but has no approved device sees only the enrolment screens.
- Zero Trust must be enabled on the account first (free plan: up to 50 users). Exact steps for Harsh are [below](#what-harsh-does-in-cloudflare).

## Passkeys

Library: `@simplewebauthn/server` (pinned) in the Worker. Relying party: id = the owner host, name "Feelings", origin = `https://<owner host>`. User verification `required` (fingerprint, Face ID or the device PIN), resident key `preferred`, attestation `none`, algorithms ES256 and RS256. Challenges are single-use, 5 minutes, stored in D1 with the session or request id.

Flows:

1. **First device (enrolment).** The owner is past the Access wall and has no passkey. The page offers "Email me a code". The existing magic link and 6-digit code are sent to the owner address (owner host link). After the code, the browser creates a passkey; the Worker stores it and marks the device approved and the owner as `passkey_enrolled`. From then on the email-code route refuses for that owner (`passkey_enrolled_at` set) except through a recovery code.
2. **Sign in.** "Use your fingerprint" runs a WebAuthn assertion; the Worker verifies it (counter must increase, origin and rpId checked) and issues the owner session (host-only, 12 hours idle, 7 days absolute, bound to the credential id). The PIN is then asked for sensitive actions as today.
3. **New device.** On the new device the owner taps "Add this device"; the Worker creates a device request with a short code shown on the new device ("Approve code 482-913 on your other phone"). The request appears as a card in Needs action on an approved device. Approving needs a passkey assertion on the approving device plus the owner PIN. On approval the Worker issues a single-use enrolment token (10 minutes) that lets the new device create its passkey. Requests expire after 15 minutes and can be declined.
4. **Device list.** Settings, Security: each approved device (name from the browser, platform, added, last used, "This device"), Remove (passkey plus PIN, audited). The last device cannot be removed. Removing a device revokes its sessions.
5. **Recovery.** If every device is lost, only an admin can help: `scripts/owner-recovery.mjs` (run with Wrangler access to the production D1) issues a one-time code (shown once, stored hashed, valid 24 hours, single use, audited as `owner.recovery_issued`). On the owner host "I lost my phone" accepts the code, then the Access wall still applies, and the owner enrols a fresh first device, which removes the old passkeys.

Edge cases written down: browsers without WebAuthn (show a plain "this browser cannot use a passkey; use Chrome or Safari"), platform authenticators that sync passkeys between a person's devices (allowed; the approved-device list shows the credential, not a physical phone), clock skew, counters that stay 0 (synced passkeys; the counter check is skipped when both stored and received are 0), and a rate limit on every WebAuthn route.

## Data model

New migration `0004_owner_access.sql`:

- `owner_passkeys` (`id`, `org_id`, `user_id`, `credential_id` unique, `public_key`, `sign_count`, `transports`, `device_name`, `platform`, `created_at`, `last_used_at`, `removed_at`, `removed_by`).
- `owner_device_requests` (`id`, `org_id`, `user_id`, `code`, `device_name`, `status` pending/approved/declined/expired, `approved_by_credential`, `enrol_token_hash`, `expires_at`, `created_at`).
- `owner_recovery_codes` (`id`, `org_id`, `user_id`, `code_hash`, `issued_by`, `expires_at`, `used_at`).
- `users.passkey_enrolled_at` (nullable).
- Audit actions: `owner.passkey_enrolled`, `owner.device_requested`, `owner.device_approved`, `owner.device_declined`, `owner.device_removed`, `owner.recovery_issued`, `owner.recovery_used`, `owner.signin_passkey`.

## API

Contract change (separate `contract-change` PR before the feature PRs): owner-host endpoints `ownerPasskeyOptions`, `ownerPasskeyVerify`, `ownerEnrolOptions`, `ownerEnrolVerify`, `ownerDeviceRequestCreate`, `ownerDeviceRequestList`, `ownerDeviceRequestDecide` (passkey assertion plus PIN step-up), `ownerDeviceList`, `ownerDeviceRemove`, `ownerRecoveryRedeem`, each with a zod schema, a rate limit and an audit row. The old `ownerMagic`, `ownerVerify` and `ownerPassword` stay until the cutover, then answer 404 on the staff host and are restricted on the owner host to "first device" and "recovery" only.

## Screens

Owner host, mobile first, built with the redesign kit ([plan addendum](ui-redesign-plan.md#5b-owner-access-screens-addendum)): sign-in ("Use your fingerprint" primary, "Email me a code" shown only before the first device), enrolment, "Add this device" with the code, the approval card in Needs action, Settings, Security with the device list, and the recovery screen. No staff screen changes.

## Build slices

Each is one small PR into `main` with tests, `ci` and `e2e` green; production only through green `main` and the redeploy recipe in `STATUS.md`. The existing owner sign-in keeps working through slice 6.

| # | Slice | Notes |
|---|---|---|
| 1 | **Host routing and split build**: two Vite entries, Host-based routing in the Worker, `OWNER_HOST`/origin lists, staff host 404 for owner paths when `OWNER_HOST` is set (off by default), CI marker check on the staff output, e2e config for both hosts (`owner.localhost` style via a host header). | Biggest slice; no behaviour change while `OWNER_HOST` is unset. |
| 2 | **Access JWT verification**: middleware, JWKS cache, variables, unit tests with a locally signed token, off until `ACCESS_AUD` is set. | |
| 3 | **Contract change PR** for the endpoints above. | `contract-change` label. |
| 4 | **Passkey core**: migration 0004, options and verify with `@simplewebauthn/server`, first-device enrolment through the email code, passkey sign-in and session, tests with a software authenticator (generated credentials). | |
| 5 | **Device approval**: request, approval card, assertion plus PIN, enrolment token, expiry and decline, tests for every state and for replays. | |
| 6 | **Security screen**: device list and remove, last-device guard, session revocation. | |
| 7 | **Recovery**: `scripts/owner-recovery.mjs`, redeem route and screen, audit rows, runbook `docs/runbooks/owner-recovery.md`. | |
| 8 | **Cutover**: add the owner host custom domain and the Access application, set the variables, verify on two devices, then close the old routes on the staff host, switch off `workers.dev`, update the owner guide, `docs/deploy.md`, the secrets runbook and the ops log. | Manual verification by Harsh and Urmi before the old path is closed. |

## Cutover and rollback

Order: ship slices 1 to 7 with everything off, create the owner host and the Access application, set `OWNER_HOST`, `ACCESS_*`, sign in on the owner host and enrol a passkey on two devices, ask Urmi to do the same, only then close the old owner routes on the staff host. Rollback is a one-line change: unset `OWNER_HOST` and the old owner routes answer again; the passkey tables stay. Recovery codes are tested once before the old path is closed.

## What Harsh does in Cloudflare

The VM's Wrangler login cannot create Access applications (its token has no Access scope, and it must not be widened). Two ways; the dashboard is the short one.

**Dashboard (about 10 minutes):**
1. Cloudflare dashboard, DualMind Labs account, Zero Trust. If it asks to set up Zero Trust, pick the **Free** plan (up to 50 users). If it asks for a card, stop and tell the lead; no money is spent without a yes. Choose a team name (this becomes `<team>.cloudflareaccess.com`).
2. Zero Trust, Settings, Authentication: make sure **One-time PIN** is enabled.
3. Access, Applications, Add an application, Self-hosted. Application name "Owner". Session duration **7 days**. Public hostname: the owner host once it exists (the lead will tell you the exact name; the custom domain is created at slice 8).
4. Policy: name "Owners", action Allow, include Emails: `urmi@feelingsbeautycare.in` and `creharsh@gmail.com`. Identity providers: One-time PIN only. Save.
5. Open the application's overview and copy the **Application Audit Tag** (AUD) and tell the lead the **team domain**. These two values are not secret.

**API alternative:** create an API token (My Profile, API Tokens, Create custom token) with Account, Access: Apps and Policies, Edit; Account, Zero Trust, Read; Zone, DNS, Edit for `feelingsbeautycare.in`; and put it on the VM as `CLOUDFLARE_API_TOKEN` for one session only. Revoke it afterwards.

Also needed from Harsh: confirm the two allowed emails, and confirm that Urmi's phone and her laptop can be used for enrolment (she needs a fingerprint or Face ID capable device and a screen lock).

## Risks

- **Lock-out:** the old path stays until two devices are verified; the recovery code is tested before closing; Harsh's own address is in the Access policy so he can always reach the owner host.
- **Passkey sync:** a synced passkey can appear on a new Apple or Google device without our approval flow; the owner session still needs the Access wall and the device must be in our list (a synced credential is the same credential id, so it passes). Document it; the Security screen lists credentials, and Remove revokes it.
- **Build split size:** two entries share the kit; check the staff entry stays under the 170 KB budget (it should shrink).
- **Preview and tests:** previews run both hosts through a host header; e2e keeps a test-only owner session helper so the many owner specs do not need real WebAuthn (a virtual authenticator via Playwright's CDP covers the passkey specs).
- **Access outage or misconfiguration:** a wrong policy blocks the owner; the rollback and Harsh's allow-list entry cover it.
