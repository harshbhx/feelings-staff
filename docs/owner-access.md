# Owner access: own host, Cloudflare Access, passkeys

Decision: [ADR-19](decisions/0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md). This page is the design and the build plan. The owner-facing steps will move into the [owner guide](guides/owner.md) when the cutover is done. This page is for the people who build and run the app. **Staff documents never mention it.**

Contents: [What changes](#what-changes) · [The two hosts](#the-two-hosts) · [Cloudflare Access](#cloudflare-access) · [Passkeys](#passkeys) · [Data model](#data-model) · [API](#api) · [Screens](#screens) · [Build slices](#build-slices) · [Cutover and rollback](#cutover-and-rollback) · [What Harsh does in Cloudflare](#what-harsh-does-in-cloudflare) · [Risks](#risks)

## What changes

**Status:** slice 1a (Host-based routing behind `OWNER_HOST`, off by default), slice 1b (split build, below), slice 2 (Access JWT verification, `app/worker/middleware/access.ts`), slice 3 (the endpoint contract, [API](#api)) slice 4 (passkey core: migration 0004, first-device enrolment, passkey sign-in, the owner-host sign-in and enrolment screens) slice 5 (device approval: "Add this device", the approval card in Needs action, the enrolment token) and slice 6 (Settings, Security, Devices: the list, rename, Remove) are built. Nothing changes in production until `OWNER_HOST` is set: while it is unset the passkey routes answer 404, and the Access check stays off until `ACCESS_AUD` is set as well.

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
- CI: `scripts/check-staff-bundle.mjs` fails when the staff folder holds an owner marker (and, with `--expect-hits`, when the combined build does not, so the check cannot go blind); `scripts/size-budgets.mjs` measures all three builds, the staff initial JS is strict (170 KB) in the split. The e2e workflow has a second run with `OWNER_HOST=owner.localhost:8787` (`E2E_SPLIT=1`, project `split-hosts`): a `*.localhost` owner host is a secure context over the preview's plain http, so the passkey specs run with Chromium's virtual authenticator; the staff host is `staff.example.test:8787`.

## Cloudflare Access

- A self-hosted application on the owner host, policy "owners": allow `urmi@feelingsbeautycare.in` and `creharsh@gmail.com`, identity provider One-time PIN, session duration 7 days. (Google sign-in can be added as a second provider later, no code change.)
- The Worker verifies `Cf-Access-Jwt-Assertion` on every owner-host request: RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `aud` equal to the application's audience tag, `exp`, `iss`, and the e-mail claim in an allow-list variable. Variables: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_ALLOWED_EMAILS`. Until they are set the check is off (so builds and previews work); once `ACCESS_AUD` is set it is mandatory and a missing or bad token answers 403 with no detail.
- Implementation (`app/worker/middleware/access.ts`, first middleware in `index.ts`, so the owner shell, assets and API are all behind it): runs only when the request is for the owner surface and `ACCESS_AUD` is non-empty. It reads the `Cf-Access-Jwt-Assertion` header only (never the cookie), accepts RS256 only, picks the key by `kid` from the JWKS (cached one hour; an unknown `kid` forces one refetch, at most one fetch of the certs URL per minute; if a refresh fails, keys already cached keep working for up to 24 hours, an uncached `kid` is refused), and checks `aud` (string or array), `iss` (`https://<team domain>`), `exp`, `nbf` and `iat` (60 s skew) and the `email` claim against `ACCESS_ALLOWED_EMAILS` (trimmed, case-insensitive). It fails closed: `ACCESS_AUD` set with the team domain or the allow-list empty, a certs fetch failure, or any bad token answers 403 with an empty body. The reason goes to `console.warn` without the token or the e-mail. On success the e-mail is on the Hono context (`accessEmail`) and on `Ctx.accessEmail` for later slices. Tests: `app/worker/test/access.test.ts` (locally signed tokens, stubbed certs URL).
- The Access email is only a gate. Identity inside the app is the passkey. A person who passes Access but has no approved device sees only the enrolment screens.
- Zero Trust must be enabled on the account first (free plan: up to 50 users). Exact steps for Harsh are [below](#what-harsh-does-in-cloudflare).

## Passkeys

Library: `@simplewebauthn/server` (pinned) in the Worker. Relying party: id = the owner host, name "Feelings", origin = `https://<owner host>`. User verification `required` (fingerprint, Face ID or the device PIN), resident key `preferred`, attestation `none`, algorithms ES256 and RS256. Sign-in is usernameless (no allow list), so it needs a discoverable credential: the phone and laptop platform authenticators (iCloud Keychain, Google Password Manager, Windows Hello) always make one; a hardware security key that cannot store one would enrol but not sign in. On phones `preferred` and `required` behave the same; with `required` such a key would be refused at enrolment instead. Challenges are single-use, 5 minutes, stored in D1 with the session or request id.

Flows:

1. **First device (enrolment).** The owner is past the Access wall and has no passkey. The page offers "Email me a code". The existing magic link and 6-digit code are sent to the owner address (owner host link). After the code, the browser creates a passkey; the Worker stores it and marks the device approved and the owner as `passkey_enrolled`. From then on the email-code route refuses for that owner (`passkey_enrolled_at` set) except through a recovery code.
2. **Sign in.** "Use your fingerprint" runs a WebAuthn assertion; the Worker verifies it (counter must increase, origin and rpId checked) and issues the owner session (host-only, 12 hours idle, 7 days absolute, bound to the credential id). The PIN is then asked for sensitive actions as today.
3. **New device.** On the new device the owner taps "Add this device"; the Worker creates a device request with a short code shown on the new device ("Approve code 482-913 on your other phone"). The request appears as a card in Needs action on an approved device. Approving needs a passkey assertion on the approving device plus the owner PIN. The new device gets a single-use enrolment token with its request and keeps it (it is never shown); the token works only after approval, for 10 minutes, and lets the new device create its passkey. Requests expire after 15 minutes and can be declined.
4. **Device list.** Settings, Security: each approved device (name from the browser, platform, added, last used, "This device"), Remove (passkey plus PIN, audited). The last device cannot be removed. Removing a device revokes its sessions.
5. **Recovery.** If every device is lost, only an admin can help: `scripts/owner-recovery.mjs` (run with Wrangler access to the production D1) issues a one-time code (shown once, stored hashed, valid 24 hours, single use, audited as `owner.recovery_issued`). On the owner host "I lost my phone" accepts the code, then the Access wall still applies, and the owner enrols a fresh first device, which removes the old passkeys.
6. **Forgotten owner PIN.** Gap found on 21 Oct 2026: today `PUT /owner/security/pin` (`ownerSetPin`) needs the current PIN once one exists, and PRD 4.1.7 only covers a *locked* PIN (unlocked by a magic-link sign-in), so an owner who forgets the PIN has no way back except an admin editing D1. Slice 7 closes it:
   - **Self-service:** Settings, Security, "Forgot your PIN?" asks for a fresh sign-in (the email code before cutover; a passkey assertion after it) and then lets the owner set a new PIN without the old one, within 15 minutes of that sign-in, the same window as the first PIN. It resets `pin_failures` and `pin_locked_until`, revokes the owner's other sessions, sends a "Your PIN was changed" email to the owner address, and writes the audit row `owner.pin_reset`. Rate limited like every PIN route.
   - **Admin:** `scripts/owner-recovery.mjs --clear-pin` clears the owner PIN (audited as `owner.pin_cleared_by_admin`), so the next sign-in goes through the first-PIN flow. Documented in `docs/runbooks/owner-recovery.md` next to the recovery code.
   - Tests: reset refused without a fresh sign-in, refused after 15 minutes, works once inside the window, old PIN stops working, other sessions revoked, audit row and email written. The PRD 4.1.7 table gets a "Owner PIN forgotten" row and the owner guide a short section.

How slice 4 builds it: the RP id is `OWNER_HOST` without its port and the origin is `https://<OWNER_HOST>` (`http` only when `APP_ORIGIN` is `http`, as in the e2e preview). Sign-in is usernameless (no allow list), so it relies on the resident key. A passkey session is a normal `fs_session` cookie (host-only) with `sessions.passkey_id` set: 12 hours idle, 7 days at most, and it ends when its credential is removed. On the owner host an owner with a passkey has no other session: an email-code session cookie is refused there, and `ownerMagic` sends nothing (still 202), `ownerVerify` and `ownerPassword` answer `FORBIDDEN` with `details.reason: "passkey_enrolled"`. The first enrolment also ends the owner's email-code sessions and unused codes. The browser side is a few lines over `navigator.credentials` (`app/src/features/auth/lib/passkey.ts`), owner build only.

How slice 5 builds it: "Add this device" (`/auth/owner/add`, linked from the sign-in page) creates the request with a platform label as its name ("iPhone", "Computer"), the city from Cloudflare's request data (city only) and a 6-digit code, and keeps the enrolment token in memory. The new device polls every 3 seconds; the countdown runs on its own clock. A request needs an active owner with a passkey (`RULE_VIOLATION`, `details.reason: "no_device"` otherwise) and is rate limited (5 per IP and 20 per salon in 15 minutes). The approval card shows pending requests to a passkey session only, newest first, above the other Needs action cards and in the same style (Approve is an outline button with the fingerprint icon, Decline is a plain button, not red). Approve fetches a `confirm` challenge before the tap, runs the passkey on this device, then the PIN sheet when step-up is needed, and sends the same answer again; the answer must come from this session's own credential, so a removed or another credential is refused. Decline needs the PIN only. Approve and decline are single conditional updates (`ALREADY_DECIDED` for the second), an expired request answers `LINK_EXPIRED` and is marked `expired`. The approval sets the request's `user_id` (the new passkey belongs to the owner who approved it), `approved_by_credential` and `decided_at`; the token then works for 10 minutes with the enrol routes, once (`used_at`, a conditional update after the passkey verifies), and the new device's session is bound to its new passkey. Audit rows: `owner.device_requested` (actor system: the new device has no session), `owner.device_approved`, `owner.device_declined`, and `owner.passkey_enrolled` with `via: "device_request"`. Tests: `app/worker/routes/auth/owner-devices.test.ts` (DA-1 to DA-3) and `e2e/tests/split/devices.spec.ts` (SPLIT-4).

How slice 6 builds it: Settings, Security shows "Passkey devices" on the owner host only (`OWNER_ONLY`; the combined and staff builds do not change): one row per live passkey with a platform icon, its name, the platform, added and last used, and a "This device" chip for the session's own credential. Rename opens a sheet with the name (`ownerDeviceRename`, audited `owner.device_renamed`). Remove opens a confirm sheet, which closes before the fingerprint so the passkey sheet and then the PIN sheet are the only things on screen; the server checks the last-device rule before it uses the fingerprint (`RULE_VIOLATION`, `reason: "last_device"`), then `confirmOnThisDevice` (as for approve), then one conditional update that removes only while another live passkey of that owner remains, revokes every session bound to it and writes `owner.device_removed`. Removing this device itself is allowed when another remains: the response clears the cookie and the screen goes back to sign-in. With one device the Remove button is disabled and the row says "Add another device first". Tests: SD-1 in `app/worker/routes/auth/owner-devices.test.ts` and SPLIT-5 in `e2e/tests/split/security.spec.ts`.

Edge cases written down: browsers without WebAuthn (show a plain "this browser cannot use a passkey; use Chrome or Safari"), platform authenticators that sync passkeys between a person's devices (allowed; the approved-device list shows the credential, not a physical phone), clock skew, counters that stay 0 (synced passkeys; the counter check is skipped when both stored and received are 0), and a rate limit on every WebAuthn route.

## Data model

Migration [`0004_owner_access.sql`](../migrations/0004_owner_access.sql) (details in the [data model](data-model.md#owner-access-tables-0004_owner_accesssql)):

- `owner_passkeys` (`id`, `org_id`, `user_id`, `credential_id` unique, `public_key`, `sign_count`, `transports`, `device_name`, `platform`, `created_at`, `last_used_at`, `removed_at`, `removed_by`).
- `owner_device_requests` (`id`, `org_id`, `user_id`, `code`, `device_name`, `platform`, `city`, `status` pending/approved/declined/expired, `approved_by_credential`, `enrol_token_hash`, `ip_hmac`, `expires_at`, `decided_at`, `used_at`, `created_at`). `platform`, `city`, `decided_at` (start of the 10-minute enrolment window) and `used_at` were added to the plan for the approval card and the token's single use.
- `owner_recovery_codes` (`id`, `org_id`, `user_id`, `code_hash`, `issued_by`, `expires_at`, `used_at`, `created_at`).
- `owner_passkey_challenges` (single use, 5 minutes): `purpose` (`signin`, `confirm`, `enrol`), `challenge`, and for `enrol` and `confirm` the user, the session and (for `confirm`) the one credential it accepts.
- `users.passkey_enrolled_at` (nullable) and `sessions.passkey_id` (the credential an owner session signed in with).
- Audit actions: `owner.passkey_enrolled`, `owner.device_requested`, `owner.device_approved`, `owner.device_declined`, `owner.device_removed`, `owner.device_renamed`, `owner.recovery_issued`, `owner.recovery_used`, `owner.signin_passkey`. The read routes (options, status, lists) write none.

## API

The contract (slice 3) is in the endpoint table, schemas in `packages/contracts/src/api/owner-access.ts`; the rows, how they fit together and the error codes are in the [API reference](api.md#owner-access-passkeys-devices-recovery). Every route answers only on the owner host: 404 on the staff host and, since slice 4, 404 on every host while `OWNER_HOST` is unset. The challenge routes are rate limited, and every route that changes something writes an audit row (see [Data model](#data-model)).

| Endpoint | Route | Notes |
|---|---|---|
| `ownerPasskeyOptions` | `POST /auth/owner/passkey/options` | `purpose` `signin` (usernameless) or `confirm` (the session's own credential, for approve and remove); also says whether "Email me a code" is still offered |
| `ownerPasskeyVerify` | `POST /auth/owner/passkey/verify` | Starts the owner session bound to the credential |
| `ownerEnrolOptions` | `POST /auth/owner/enrol/options` | First device (owner session after the email code, no passkey yet) or an enrolment token |
| `ownerEnrolVerify` | `POST /auth/owner/enrol/verify` | Stores the passkey, sets `passkey_enrolled_at`, starts a session bound to it |
| `ownerDeviceRequestCreate` | `POST /auth/owner/device-requests` | New device: 6-digit code, 15 minutes, and an enrolment token it keeps |
| `ownerDeviceRequestStatus` | `POST /auth/owner/device-requests/:id/status` | The new device polls its request (added to the plan: the new device has no session) |
| `ownerDeviceRequestList` | `GET /owner/device-requests` | Approval cards in Needs action |
| `ownerDeviceRequestDecide` | `POST /owner/device-requests/:id/decide` | Approve (passkey assertion on this device plus PIN step-up) or decline |
| `ownerDeviceList` | `GET /owner/security/devices` | Settings, Security |
| `ownerDeviceRename` | `PATCH /owner/security/devices/:id` | The prefilled name on the enrolment success screen (added to the plan) |
| `ownerDeviceRemove` | `POST /owner/security/devices/:id/remove` | Passkey assertion plus PIN step-up; never the last device |
| `ownerRecoveryRedeem` | `POST /auth/owner/recovery` | Recovery code to an enrolment token for a fresh first device |

The old `ownerMagic`, `ownerVerify` and `ownerPassword` stay until the cutover, then answer 404 on the staff host and are restricted on the owner host to "first device" and "recovery" only.

## Screens

Owner host, mobile first, built with the redesign kit ([plan addendum](ui-redesign-plan.md#5b-owner-access-screens-addendum)): sign-in ("Use your fingerprint" primary, "Email me a code" shown only before the first device), enrolment, "Add this device" with the code, the approval card in Needs action, Settings, Security with the device list, and the recovery screen. No staff screen changes.

## Build slices

Each is one small PR into `main` with tests, `ci` and `e2e` green; production only through green `main` and the redeploy recipe in `STATUS.md`. The existing owner sign-in keeps working through slice 6.

| # | Slice | Notes |
|---|---|---|
| 1 | **Host routing and split build**: two Vite entries, Host-based routing in the Worker, `OWNER_HOST`/origin lists, staff host 404 for owner paths when `OWNER_HOST` is set (off by default), CI marker check on the staff output, e2e config for both hosts (`owner.localhost` style via a host header). | Biggest slice; no behaviour change while `OWNER_HOST` is unset. |
| 2 | **Access JWT verification**: middleware, JWKS cache, variables, unit tests with a locally signed token, off until `ACCESS_AUD` is set. | Built. |
| 3 | **Contract change PR** for the endpoints above. | `contract-change` label. |
| 4 | **Passkey core**: migration 0004, options and verify with `@simplewebauthn/server`, first-device enrolment through the email code, passkey sign-in and session, tests with a software authenticator (generated credentials). | |
| 5 | **Device approval**: request, approval card, assertion plus PIN, enrolment token, expiry and decline, tests for every state and for replays. | Built. |
| 6 | **Security screen**: device list and remove, last-device guard, session revocation. | Built. |
| 7 | **Recovery**: `scripts/owner-recovery.mjs`, redeem route and screen, audit rows, runbook `docs/runbooks/owner-recovery.md`, and the forgotten owner PIN reset (flow 6 under Passkeys). | The PIN reset does not depend on the owner host and can ship before cutover. |
| 8 | **Cutover**: add the owner host custom domain and the Access application, set the variables, verify on two devices, then close the old routes on the staff host, switch off `workers.dev`, update the owner guide, `docs/deploy.md`, the secrets runbook and the ops log. | Manual verification by Harsh and Urmi before the old path is closed. |

## Cutover and rollback

Order: ship slices 1 to 7 with everything off, create the owner host and the Access application, set `OWNER_HOST`, `ACCESS_*`, sign in on the owner host and enrol a passkey on two devices, ask Urmi to do the same, only then close the old owner routes on the staff host. Rollback is a one-line change: unset `OWNER_HOST` and the old owner routes answer again; the passkey tables stay. Recovery codes are tested once before the old path is closed. The ordered checklist is the [owner cutover runbook](runbooks/owner-cutover.md).

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
