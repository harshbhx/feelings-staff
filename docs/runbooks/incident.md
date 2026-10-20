# Incident runbook

For Harsh, when something is wrong in production: a secret or data may have leaked, someone may be using an account that is not theirs, or the app is down or misbehaving. This is PRD 10.10 expanded. Keep it short in your head: **contain, assess, tell Urmi, fix and record.**

Contents: [Ground rules](#ground-rules) · [First 15 minutes](#first-15-minutes) · [1. Contain](#1-contain) · [2. Assess](#2-assess) · [3. Tell Urmi and the Board](#3-tell-urmi-and-the-board) · [4. Fix and record](#4-fix-and-record) · [Scenarios](#scenarios) · [Useful commands](#useful-commands)

## Ground rules

- Harsh operates the system only through Cloudflare (Wrangler and the dashboard) with his own account. There is no hidden admin or support login in the app (PRD 10.11).
- Any direct change to production data is done only at the owner's request or to contain an incident, is written to the [ops log](../ops-log.md) with the date, reason and SQL, and is mirrored as an `audit_log` row (`actor_type = system`, `action = ops.manual`).
- Never paste a secret, a PIN, a join code or a session token into a chat, issue, PR or log. If one has been pasted somewhere, treat it as leaked.
- Do not delete evidence. Export the relevant audit rows before you clean anything up.

## First 15 minutes

1. Write down the time you noticed it and what you saw. Start a new section in the [ops log](../ops-log.md) now, even a one-liner.
2. Decide the type:

| What it looks like | Go to |
|---|---|
| A secret, token or key may be exposed (pasted, committed, logged) | [A secret leaked](#a-secret-leaked) |
| Someone may be signed in as the owner or as a staff member | [An account is being used by someone else](#an-account-is-being-used-by-someone-else) |
| A staff phone is lost, stolen or replaced | [A staff phone is lost](#a-staff-phone-is-lost) |
| Another person's data was shown, or a file link is public | [Data was exposed](#data-was-exposed) |
| The door code or door device may be copied | [Door secrets leaked](#door-secrets-leaked) |
| The app is down or wrong after a deploy | [A bad deploy](#a-bad-deploy-or-the-app-is-down) |

3. If you are not sure, contain first (it is cheap to undo), then assess.

## 1. Contain

Contain means stop it from continuing. Pick what fits; none of these deletes data.

| Action | How | Effect |
|---|---|---|
| Rotate the affected secret | [secrets runbook](secrets.md), one section per secret | The old value stops working. Some rotations sign people out or force PIN resets; the runbook says which. |
| Sign everyone out | `UPDATE sessions SET revoked_at = <now ms> WHERE revoked_at IS NULL` (see commands below) | Every person signs in again. Devices stay approved. |
| Sign one person out | Owner: staff profile, Devices, Revoke; or `UPDATE sessions SET revoked_at = ... WHERE user_id = '<id>'` | That person's sessions end. |
| Remove a phone | Owner: Needs action or staff profile, Devices, Revoke. The API call is `POST /owner/devices/:id/revoke` | The device and its sessions are revoked. The person must join again. |
| Switch off door devices | Owner: Settings, Door code, Unpair; or `UPDATE door_devices SET status = 'revoked'` | Door QR tokens stop validating. |
| Take the app offline | Roll back, or in the dashboard remove the custom domain route from the Worker | Last resort. Staff can still work: check-ins queue on the phone. |

## 2. Assess

Answer: what data, which people, which period, and who could have seen it.

- **Audit log.** The owner can filter it in Settings, Audit log. For a deeper look, query it:
  `npx wrangler d1 execute fbc-staff --remote --command "SELECT created_at, category, actor_type, actor_id, action, entity, entity_id FROM audit_log WHERE created_at BETWEEN <from> AND <to> ORDER BY created_at"`
  The `security` rows cover sign-ins, failed PINs, lockouts, device changes and step-ups. The `access` rows show owner views of selfies. The `export` rows show exports and payslip downloads.
- **Worker logs.** Observability is on. In the dashboard: Workers and Pages, `feelings-staff`, Logs. Live: `npx wrangler tail`. Every response has an `X-Request-Id`, and the error body and logs carry the same id.
- **R2 access.** Objects are private and served only through session-checked routes, so look in the Worker logs for the routes `GET /owner/punches/:id/selfie`, `GET /owner/staff/:id/photo`, `GET /payslips/:id/pdf` and `GET /owner/exports/:id/file`.
- **Which people.** List the staff in the affected period from `punches` or `attendance_days`, and note which fields were involved (name, phone, location results, selfies, wage records).
- Write the findings into the ops log as you go: what you know, what you do not know yet.

## 3. Tell Urmi and the Board

- **Urmi first, the same day.** She is the data fiduciary under the DPDP Act. Tell her in plain words: what happened, what data, which people, what you have done, what you do next. Do not wait for a perfect picture.
- **Affected staff.** Urmi tells them, in plain language (the app is English only for now). Offer to help write the message. Say what was involved, what it means for them, what they should do (for example "change your PIN") and who to ask.
- **Data Protection Board.** If personal data was breached, the DPDP Rules ask for an intimation to the Board without delay and a detailed report within 72 hours. Help Urmi draft both: nature and extent of the breach, when it happened, the likely consequences, what was done to contain it, and the contact for questions. Keep a copy in the ops log folder you use (not in the repo if it names people).
- Most DPDP obligations apply from 13 May 2027; the app is built to them already, so follow this process now.

## 4. Fix and record

1. Fix the cause: a code fix through a PR, a configuration change, a rotated secret.
2. Add a test that would have caught it (a Workers API test for an access bug, a `check:*` script for a pattern).
3. Update the docs that were wrong or missing (this runbook, the threat model in PRD 10.1, the [secrets runbook](secrets.md)).
4. Close the entry in the [ops log](../ops-log.md): timeline, root cause, what changed, the PR link, who was told and when.
5. If you wrote SQL against production, make sure the `ops.manual` audit row exists.

## Scenarios

### A secret leaked

1. Open [secrets.md](secrets.md) and rotate that secret now. If the leaked item is the Cloudflare API token, revoke it first in the Cloudflare dashboard and create a new one, then update `CLOUDFLARE_API_TOKEN` in GitHub.
2. If the secret protects stored data (`PIN_PEPPER`, `QR_MASTER_KEY`, `PUNCH_ENC_PRIVATE_JWK`, `IP_HMAC_KEY`), read the "what breaks" line first. Some rotations invalidate stored data on purpose.
3. If it was committed to git, rotating is what fixes it; removing it from the history is only tidiness.
4. Assess whether anyone could have used it while it was exposed (Worker logs, audit log).

### An account is being used by someone else

1. Owner account: sign out all sessions (Settings, Security, Sign out others, or revoke all sessions in SQL), change the fallback password and PIN, and check the audit log for changes made while the other session was active: salaries, settings, device approvals, exports.
2. Staff account: revoke the person's devices and sessions, issue a PIN reset invite (staff profile, Reset PIN), and check their punches in the period.
3. The owner's email is the root of owner access. If the mailbox may be compromised, tell Urmi to secure it first.

### A staff phone is lost

Owner: staff profile, Devices, Revoke. The person joins again on the new phone with a reset invite, or taps "I have a new phone" with their PIN, which creates a pending device for the owner to approve. Nothing about the old phone can be used once its device is revoked: every check-in needs the device key and the PIN.

### Data was exposed

1. Stop the exposure: roll back or fix the route, remove any public access on the R2 bucket (it must never have a public URL or custom domain).
2. Assess with the audit log and Worker logs (section 2). Cross-organisation reads must answer 404; a leak here means the tenant tests missed something. Add the test.
3. Go to [section 3](#3-tell-urmi-and-the-board).

### Door secrets leaked

Rotate the door device (Settings, Door code, the device, Rotate; needs the step-up PIN) so old tokens stop working, or unpair and pair again. If `QR_MASTER_KEY` leaked, rotate it as described in [secrets.md](secrets.md). Remember that a door token alone never checks anyone in: the person still needs the device key and the PIN.

### A bad deploy or the app is down

1. Check `https://www.cloudflarestatus.com/` and `GET /api/v1/health`.
2. If it started with a deploy, roll back: `npx wrangler rollback` from `app/` ([deploy guide](../deploy.md#rollback)). The database is not rolled back, and additive migrations keep the older code working.
3. Staff can keep checking in while the server is down: punches queue on the phone and send when it is back (with a signed time anchor, see PRD 4.3.6).
4. Restore data only if the data itself is damaged: [backup and restore runbook](backup-restore.md).
5. Fix forward with a revert PR so `main` matches what is live.

## Useful commands

Run from `app/` on your own machine, signed in to the salon's Cloudflare account. Times are epoch milliseconds (`date +%s%3N`).

```sh
npx wrangler tail                                   # live logs
npx wrangler deployments list                       # versions
npx wrangler rollback                               # back one version
npx wrangler d1 export fbc-staff --remote --output=../d1-export-$(date +%Y%m%d-%H%M).sql   # take a copy first
npx wrangler d1 execute fbc-staff --remote --command "UPDATE sessions SET revoked_at = $(date +%s%3N) WHERE revoked_at IS NULL"
```

After any `d1 execute` that changes data, add the `ops.manual` audit row. Replace the placeholders; the id can be any new ULID or a short unique string if you have no generator at hand:

```sql
INSERT INTO audit_log (id, org_id, category, actor_type, actor_id, action, entity, entity_id, reason, created_at)
VALUES ('<new id>', '<org id>', 'change', 'system', NULL, 'ops.manual', '<table>', NULL, '<why, one line>', <now ms>);
```
