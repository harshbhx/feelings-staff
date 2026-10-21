# Owner cutover runbook

The ordered checklist for moving the owner onto its own host behind Cloudflare Access (slice 8 of [owner access](../owner-access.md), [ADR-19](../decisions/0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md)). Rollback is one line and is at the [end](#rollback).

Placeholders used below: `<OWNER_HOST>` is the owner host name (random, never written in the repo, the staff bundle, staff docs or chats the staff can read), `<TEAM>` the Zero Trust team name, `<AUD>` the Access application audience tag. Keep the real values in the secrets runbook's private notes and the ops log only.

Contents: [Before you start](#before-you-start) · [1. Create the Access application](#1-create-the-access-application) · [2. Add the owner host to the Worker](#2-add-the-owner-host-to-the-worker) · [3. Set the variables](#3-set-the-variables) · [4. Verify on two devices](#4-verify-on-two-devices) · [5. Close the old owner routes](#5-close-the-old-owner-routes-on-the-staff-host) · [6. Switch off workers.dev](#6-switch-off-workersdev) · [7. After the cutover](#7-after-the-cutover) · [Rollback](#rollback)

## Before you start

- Slices 1 to 7 are merged and deployed with everything off: `OWNER_HOST` and `ACCESS_AUD` unset, so production behaves as before.
- `ci` and `e2e` are green on `main`, and the [update and rollback runbook](update-rollback.md) is to hand.
- Harsh and Urmi are both available, each with a phone and a laptop that has a screen lock and fingerprint or Face ID.
- Recovery codes exist and the recovery path has been tested once (`docs/runbooks/owner-recovery.md`, slice 7). Do not go past step 4 without this.
- Pick a quiet time (not during the morning check-in window).

## 1. Create the Access application

Harsh does this in the dashboard; the VM token has no Access scope. Full steps: [What Harsh does in Cloudflare](../owner-access.md#what-harsh-does-in-cloudflare).

1. Zero Trust on the Free plan, One-time PIN enabled, team domain `<TEAM>.cloudflareaccess.com`.
2. Self-hosted application "Owner", session 7 days, public hostname `<OWNER_HOST>`, policy "Owners" (Allow) with the two owner e-mails, One-time PIN only.
3. Copy the Application Audit Tag: this is `<AUD>`. Neither it nor the team domain is secret.

## 2. Add the owner host to the Worker

1. Dashboard, Workers and Pages, `feelings-staff`, Settings, Domains and Routes, Add, Custom domain, `<OWNER_HOST>` (the same Worker as the staff host; Cloudflare creates the DNS record and certificate, a few minutes of error 522 is normal).
2. Nothing changes for staff: until step 3 the Worker still treats every host the same way.
3. Check `https://<OWNER_HOST>/api/v1/health` answers `{"ok":true,...}`. At this point the owner host is still open (no Access check yet), so do not share the name.

## 3. Set the variables

Four plain Worker variables, none secret ([deploy reference](../deploy.md#3-worker-secrets)). Set them together, `OWNER_HOST` first:

| Variable | Value |
|---|---|
| `OWNER_HOST` | `<OWNER_HOST>` (name only, no scheme) |
| `ACCESS_TEAM_DOMAIN` | `<TEAM>.cloudflareaccess.com` |
| `ACCESS_AUD` | `<AUD>` |
| `ACCESS_ALLOWED_EMAILS` | the two owner e-mails, comma-separated |

Where they live: a variable typed in the dashboard is replaced by the next `wrangler deploy` unless the config keeps dashboard variables, and the real host must not be committed. The slice 8 PR must settle this before this step (for example `"keep_vars": true` in `app/wrangler.jsonc`, or passing the values from GitHub repository variables in the deploy step) and say which in its description. Check after the first deploy that all four are still set.

Effect, immediately: the staff host answers 404 for owner paths, the owner host is served from its own build folder and every request to it needs a valid Access token (403 with an empty body otherwise). The old owner routes on the staff host are closed by this too if the slice 8 PR makes that the behaviour; if it keeps a switch, step 5 is where it flips.

Then check, in this order:

1. `https://<OWNER_HOST>/` in a private window shows the Access one-time PIN page; after the PIN, the owner sign-in.
2. `https://<OWNER_HOST>/api/v1/health` without a token answers 403 with an empty body (curl it).
3. `https://staff.feelingsbeautycare.in/api/v1/health` still answers, a staff check-in works, and `https://staff.feelingsbeautycare.in/o` answers 404.

## 4. Verify on two devices

Both people, before anything is closed:

1. Harsh: open `https://<OWNER_HOST>/`, pass Access, sign in, enrol a passkey on the phone, then on the laptop (second device approved from the first).
2. Urmi does the same on her phone and her laptop.
3. Each person signs out and back in with the passkey on each device, and opens Today, Staff and Payroll.
4. The Security screen lists both devices for each person; remove a test device and add it again.
5. Test the recovery code once on a spare device, then generate a fresh set.
6. Record the date and who verified in the [ops log](../ops-log.md) (no host name, no tokens).

Do not continue until both owners have two working devices.

## 5. Close the old owner routes on the staff host

1. Confirm `https://staff.feelingsbeautycare.in/o` and `/api/v1/owner/today` answer 404 and `/api/v1/auth/owner/*` is gone from the staff host.
2. Run the staff smoke (`deploy` smoke step, or check-in on a real phone), then ask one staff member to sign in.
3. Remove the old owner sign-in link and code flow from the owner guide and point it at the owner host (kept out of the staff guide).

## 6. Switch off workers.dev

Dashboard, `feelings-staff`, Settings, Domains and Routes: turn off the `workers.dev` route for production (keep Preview URLs on). Confirm the old `workers.dev` address no longer answers. This closes the one route that bypasses the Access application ([deploy step 8](../deploy.md#8-switch-off-workersdev)).

## 7. After the cutover

- Update the owner guide, [deploy](../deploy.md), the [secrets runbook](secrets.md) and the [ops log](../ops-log.md) (date, what changed; never the host name).
- Watch the Worker logs for `access: denied` lines for a day: a steady stream from the owners means a policy or allow-list mistake.

## Rollback

One line: unset `OWNER_HOST`. The Worker goes back to one host serving everything, the old owner routes answer again on the staff host, and the Access check is off (it needs `OWNER_HOST`). The passkey tables stay. To switch off only the Access wall, unset `ACCESS_AUD`. If the owner is locked out by a wrong Access policy, Harsh's own e-mail in the policy still lets him in; failing that, unset `OWNER_HOST` and sign in the old way. Record any rollback in the [ops log](../ops-log.md).
