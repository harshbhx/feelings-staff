# Data model

One D1 (SQLite) database per environment, plus one private R2 bucket. This page says what each table is for, the rules every table follows, how long data is kept and where files live. The schema itself is in [`migrations/0001_init.sql`](../migrations/0001_init.sql) (copied from PRD 8.2), [`migrations/0002_platform.sql`](../migrations/0002_platform.sql) [`migrations/0003_time_credits_presence.sql`](../migrations/0003_time_credits_presence.sql) (WP-9) and [`migrations/0005_session_pin_reset.sql`](../migrations/0005_session_pin_reset.sql) (forgotten owner PIN). When this page and a migration disagree, the migration wins; fix the page.

Contents: [Conventions](#conventions) · [Tables](#tables) · [Platform tables (0002)](#platform-tables-0002_platformsql) · [Time credits and presence (0003)](#time-credits-and-presence-tables-0003_time_credits_presencesql) · [Retention](#retention) · [R2 layout](#r2-layout) · [Migrations](#migrations)

## Conventions

- **Databases.** `fbc-staff` (production, location hint `apac`) and `fbc-staff-preview` (previews and the CI smoke run). Bound to the Worker as `DB`.
- **Ids** are ULIDs: 26 characters of `TEXT`, sortable by time, generated in the Worker (`app/worker/lib/ulid.ts`).
- **Instants** are `INTEGER` UTC epoch milliseconds (`*_at`, `*_ts`). **Local dates** are `TEXT` `YYYY-MM-DD` (`*_date`). **Months** are `TEXT` `YYYY-MM`. A *work date* is the IST calendar date a punch belongs to.
- **Money** is `INTEGER` paise (`*_paise`). Day counts that can be halves are `REAL`, restricted to multiples of 0.5 by a `CHECK`.
- **Booleans** are `INTEGER` 0 or 1. **JSON** is `TEXT` with `CHECK (json_valid(col))`.
- **Tenancy.** Every table except `orgs` and `app_meta` has `org_id`, and every query goes through the data layer in `app/worker/db/`, which adds `org_id = ?` ([ADR-04](decisions/0004-d1-with-application-level-tenancy.md)). Foreign keys are enforced.
- **Append-only audit.** The data layer exposes only insert and select for `audit_log`. The only deletes are retention purges.
- **No raw secrets.** PINs, codes and session tokens are stored as hashes, IP addresses as an HMAC, door secrets encrypted. See [SECURITY.md](../SECURITY.md).
- **Changes** are new migration files, never edits to a released one. Migrations are additive: do not drop or rename a column in the same release as the code that stops using it.

## Tables

Grouped as in PRD 8.2.

### Tenancy and people

| Table | What it is for |
|---|---|
| `orgs` | The salon: name, slug, time zone, owner display name ("Urmi" in staff copy), address, phone, and `settings_json` with its `settings_version`. One row today. |
| `users` | Everyone who signs in: owner, manager, staff. Role, status (`invited`, `active`, `suspended`, `exited`), phone (E.164), email (owner), language, PIN hash and lockout counters, owner password hash, manager `permissions_json`. |
| `shift_templates` | Named working windows (Full day, Sunday, Morning, Evening, Split) with segments and the unpaid break. |
| `staff_profiles` | Per-person work facts: employee code, designation, joining and exit dates, default shift template, week-off weekday, selfie requirement (empty means the organisation default), strong mode, divisor and overtime-rate overrides, enrolled photo key. One per staff user. |
| `salary_history` | Effective-dated pay, so an old month is always computed with the salary of that time. |

### Auth

| Table | What it is for |
|---|---|
| `invites` | Join codes and PIN-reset codes. Only an HMAC of the code is stored. Single use, expires in 48 hours, counts failed tries. |
| `devices` | A phone's public key (JWK and RFC 7638 thumbprint), label, platform and status (`pending`, `approved`, `rejected`, `revoked`). One approved device per person. |
| `sessions` | Server side of the `fs_session` cookie: SHA-256 of the token, user, device, expiry, `step_up_until`, kind (`user` or `door`). `pin_reset_until` (0005): until then an owner session may set a new owner PIN without the old one; set only by an email-code or magic-link sign-in (`created_at` + 15 min), cleared by any PIN change in the session ([owner recovery](runbooks/owner-recovery.md)). |
| `challenges` | Single-use nonces: login challenges and punch nonces (5 minutes) and offline nonces (24 hours). |
| `magic_links` | Owner sign-in links and 6-digit codes (15 minutes, single use, limited tries). |

### Places

| Table | What it is for |
|---|---|
| `sites` | A geofence: the salon (permanent) or a venue (temporary), with centre, radius and maximum accuracy. |
| `door_devices` | Paired door screens: encrypted per-site secret, secret version, pairing code state. |
| `calibration_samples` | Location fixes collected while the owner calibrates the salon fence. |
| `salon_networks` | HMACs of IP addresses seen at the salon, used as a positive risk signal. |

### Schedule

| Table | What it is for |
|---|---|
| `roster_overrides` | One person on one date: a different template, a swapped week-off, or no shift. |
| `holidays` | Holidays per year, with what happens when someone works (comp-off, extra pay, both). |
| `blackout_days` | Days when leave is discouraged (wedding season). Sending a request is still allowed. |
| `offsite_duties` | An owner-created assignment to work at a venue for a date and time window, with its venue site and mode. |
| `offsite_duty_staff` | Which staff are on a duty. |
| `ot_preapprovals` | Overtime that is approved in advance (for example by a duty). |

Setup and the demo seed propose Gujarat public holidays for 2026 and 2027. The 2026 rows are the hand-written `HOLIDAYS_2026` list in `app/worker/seed/index.ts` (it already includes Holi, Janmashtami, Dussehra and Diwali). The 2027 rows come from `app/worker/seed/holidays-in.ts`, which `scripts/gen-holidays.mjs` generates from the `date-holidays` package (ISC code, CC-BY-3.0 data; see `NOTICE`). The package is a dev dependency and the Worker bundles only the static list. Lunar festivals are not in the generated data for Gujarat, so for 2027 the owner adds Holi, Janmashtami, Dussehra and Diwali. Every proposed holiday is editable.

### Attendance

| Table | What it is for |
|---|---|
| `punches` | One recorded event: check in, check out, break start or end. Server time (`server_ts`), the time used for pay (`effective_ts`), work date, source (`online`, `offline`, `owner`, `auto`), best location fix, fence result, risk score and reasons, selfie key and hash, status (`accepted`, `flagged`, `pending`, `rejected`, `superseded`), review fields and the idempotency key. |
| `attendance_days` | One row per person per work date, derived by the engine: scheduled, worked, late, early, overtime minutes, status letter (P, H, A, L, LOP, WO, HO, NE, OPEN), tags, overrides, `locked` once payroll is finalised. Recomputed whenever its inputs change. |
| `ot_decisions` | The owner's decision on overtime candidate minutes. |
| `regularisations` | Staff requests to fix a day (forgot to check in or out, wrong time, venue without a duty) and the decision. |

### Leave

| Table | What it is for |
|---|---|
| `leave_types` | Casual, sick, comp-off, unpaid: quota, accrual, notice, expiry. |
| `leave_ledger` | Credits, debits, expiries and adjustments in days (halves allowed). The balance is the sum of the ledger. |
| `leave_requests` | A request with its paid and unpaid days, blackout flag, status and decision. |

### Money

| Table | What it is for |
|---|---|
| `advances` | Advances given (or requested): amount, mode, recovery plan, first month, staff acknowledgement. |
| `advance_recoveries` | Per-month recovery lines of an advance, including amounts carried forward because of the 50% cap. |
| `fines` | Fines (off by default): show-cause, staff response, owner confirmation. |
| `payroll_runs` | One run per month and revision: status (`draft`, `finalised`, `superseded`), a snapshot of the settings used, the engine version. |
| `adjustments` | Incentives, bonuses, other earnings, arrears, deductions and recoveries added to a run, each with a note. |
| `payslips` | One per person per run: the frozen snapshot, gross, deductions, net, rounding (paise), PDF key and status, verify token, paid date, mode and reference. |

### Notifications, consent, audit and operations

| Table | What it is for |
|---|---|
| `push_subscriptions` | Web Push endpoints per device; deleted at once when the push service says 404 or 410. |
| `notifications` | The inbox, and the source of truth for all channels: type (N1 to N37), copy, target URL, priority, topic, batch key, push status and open time. |
| `notification_prefs` | Per-person, per-event channel switches. |
| `consents` | Privacy notice, selfie, night work and fines notice, with the version, language, acceptance and withdrawal times. |
| `audit_log` | Append-only record of changes, security events, data access and exports, with before and after JSON, actor, reason, IP HMAC and request id. |
| `exports` | Report exports and their status; the file is in R2 for 7 days. |
| `cron_runs` | One row per job, organisation and slot so a scheduled action runs once. |
| `app_meta` | Key and value pairs such as `min_app_version`. |

## Platform tables (0002_platform.sql)

Added by WP-1 on top of PRD 8.2.

| Table | Columns | What it is for |
|---|---|---|
| `idempotency_keys` | `org_id`, `user_id`, `key`, `endpoint`, `status`, `response_json`, `created_at`; primary key `(user_id, key)`; index on `created_at` | Stores the first response of an idempotent request. `registerApi` reads it before calling a handler and returns the stored response (with `Idempotent-Replay: true`) on a repeat. A key reused for another endpoint answers `CONFLICT`. See [API conventions](api.md#idempotency). |
| `test_outbox` | `id`, `org_id`, `channel` (`push`, `email`, `whatsapp`), `to_addr`, `payload_json`, `created_at`; index on `(org_id, created_at)` | In previews and local runs, pushes, emails and WhatsApp messages are written here instead of being sent. `GET /__test/outbox` reads it. Production never writes to it. |

Neither table has a retention rule in PRD 8.3 yet. Idempotency rows are only useful for a few days, and the index on `created_at` is there so a purge job can be added; until then they stay. This is an open item for WP-8 (the nightly job). `test_outbox` is wiped by `/__test/reset`.

## Time credits and presence tables (0003_time_credits_presence.sql)

Added by WP-9 (PRD 8.2.1). Credit tables are owner only: no staff route returns them. Presence tables can be read by the staff member they belong to, for the My data screen.

### Time credits

| Table | Columns | What it is for |
|---|---|---|
| `credit_entries` | `user_id`, `work_date`, `kind` (`late`, `early`, `away`, `ot`, `ot_legal`), `minutes` (signed, never 0), `source_kind` (`punch`, `presence`, `ot_decision`), `source_id`, `confirmed_by`, `confirmed_at`, `status` (`active`, `superseded`), `engine_version` | The minute ledger, derived by the engine. Late, early and overtime entries are rewritten when the day is recomputed, while the day is unlocked. `ot_legal` is the second plus entry for overtime beyond 9 h a day or 48 h a week, written next to the `ot` entry when `legalOt2x` is on. `confirmed_by` is empty for automatic entries (late, early). Unique per person, day and kind, except `away`, which is unique per interval. |
| `credit_adjustments` | `user_id`, `work_date`, `kind`, `delta_min` (signed, never 0), `reason` (required), `status` (`active`, `void`), `created_by`, `created_at`, `voided_by`, `voided_at`, `void_reason` | An owner edit of one day and kind. It is its own row, so a recompute never undoes it, and the original entry stays visible. |
| `credit_settlements` | `user_id`, `payroll_run_id`, `month`, `balance_min`, `settle_min`, `applied_min`, `amount_paise`, `rate_json`, `warnings_json`, `status` (`draft`, `applied`, `void`), `decided_by`, `decided_at`, `note` | What the owner settled at payroll. `applied_min` is after the 50% cap. `amount_paise` is negative for a cut and positive for an earning, at 1x the person's rate. One live row per run and person. Takes effect on Finalise; Reopen voids it. |

The balance is not stored. It is the sum of active entries and adjustments up to a date, less the settled minutes of finalised settlements. The payslip line code is `time_credits`.

### Presence

| Table | Columns | What it is for |
|---|---|---|
| `roll_calls` | `work_date`, `slot_time`, `slot_ts`, `reminded_at`, `submitted_by`, `submitted_at`, `edited_at` | One roll-call slot of one day, opened by the `rules` job. `submitted_by` is empty until someone taps Done. Unique per day and slot. |
| `roll_call_marks` | `roll_call_id`, `user_id`, `mark` (`here`, `not_here`), `away_interval_id`, `marked_by`, `marked_at` | One row per person who was checked in at the slot. |
| `away_intervals` | `user_id`, `work_date`, `source` (`roll_call`, `step_out`, `mixed`), `reason` (`personal`, `lunch`, `errand`, `other`), `reason_note`, `staff_note`, `start_ts`, `end_ts`, `end_reason`, `back_missing`, `minutes`, `state` (`open`, `pending`, `confirmed`, `work`, `ignored`), `roll_call_id`, `opened_by`, `decided_by`, `decided_at`, `edited_by`, `edited_at` | A time a person was away. `minutes` is clipped to the shift, the day's presence and outside the break window. Roll-call intervals start as `confirmed`; step-outs wait as `pending` until the owner decides. |
| `presence_checks` | `user_id`, `work_date`, `check_ts`, `result` (`inside`, `edge`, `outside`, `no_fix`), `fence_result`, `distance_m`, `accuracy_m`, `distance_bucket`, `risk_reasons_json`, `device_id`, `idempotency_key` | The optional foreground check. It only raises a "seems away" hint and never makes an interval or a credit. No coordinates are stored. |

### Changed tables

| Table | Change |
|---|---|
| `attendance_days` | `away_min`: confirmed away minutes of the day. `total_min`: every worked minute of the day (in to out, less breaks), the figure the legal overtime band uses. Both default to 0. |
| `staff_profiles` | `time_credits` (empty = salon default, 0 = left out) and `presence_enabled` (empty = salon default) |
| `shift_templates` | `break_start`: optional usual break start, used for the presence break window |
| `consents` | Rebuilt so `kind` can be `presence_checks` |
| `challenges` | Rebuilt so `purpose` can be `presence` |

SQLite cannot change a CHECK constraint, so `consents` and `challenges` are copied into a new table, which replaces the old one.

### Settings

Both live in `orgs.settings_json` (no table):

- `timeCredits { enabled, startDate, legalOt2x }`: `legalOt2x` defaults to true. Changing `enabled` or `legalOt2x` needs step-up and is audited.
- `presence { enabled, rollCallTimes[], stepOut, foreground { enabled, intervalMin }, quietDuringBreaks }`.

Audit actions: `credits.settle`, `credits.adjust`, `credits.adjust.void`, `credits.export`, `rollcall.submit`, `rollcall.edit`, `presence.away.confirm`, `presence.away.work`, `presence.away.ignore`, `presence.away.edit`, `presence.step_out`.

## Retention

What the nightly job (03:00 IST) and the monthly purge delete. Details and how to check it: [retention runbook](runbooks/retention-purge.md).

| Data | Kept | Then | Job |
|---|---|---|---|
| `punches.lat`, `lng`, `accuracy_m`, `distance_m` | 90 days | Set to NULL; keep `fence_result`, `distance_bucket`, `risk_*` | Nightly purge |
| Selfies (R2 `selfies/`) | 30 days | R2 lifecycle deletes; nightly job sets `selfie_deleted_at` | R2 rule and nightly |
| Disputed selfies (R2 `hold/`) | Until the dispute is decided, plus 30 days | Deleted | Nightly |
| Attendance, payslips, advances, fines, leave, payroll runs, salary history | 5 years after the last entry of that person | Deleted | Monthly purge |
| Audit log `change` and `export` rows | 5 years (part of the wage records) | Deleted | Monthly |
| Audit log `security` and `access` rows | 1 year (DPDP Rules 2025, Rule 8(3)) | Deleted | Nightly |
| Sessions, challenges, magic links | Until expiry plus 7 days | Deleted | Nightly |
| Notifications | 180 days | Deleted | Nightly |
| Push subscriptions | Until 404 or 410, device revoked, or staff exit | Deleted at once | On the event |
| Devices | Until revoked plus 30 days | Deleted (the id stays in audit references) | Nightly |
| Calibration samples | 30 days after the calibration is applied | Deleted | Nightly |
| `presence_checks.distance_m`, `accuracy_m` | 90 days | Set to NULL (same rule as punch locations) | Nightly purge |
| `presence_checks` rows, `roll_call_marks` with `here` | 90 days | Deleted (a not-here mark lives on in its away interval) | Nightly |
| `away_intervals`, `roll_call_marks` with `not_here`, `credit_entries`, `credit_adjustments`, `credit_settlements` | 5 years after the last entry of that person (wage records) | Deleted | Monthly purge |
| Salon network IPs (HMAC) | 7 days since last seen | Deleted | Nightly |
| Exports (R2 `exports/`) | 7 days | R2 lifecycle | R2 rule |
| Staff profile after exit | Statutory fields (name, code, designation, dates, wage records) 5 years; phone, photo and consent detail deleted 30 days after exit | Partial delete | Nightly |

## R2 layout

Bucket `fbc-staff-media` (production) and `fbc-staff-media-preview`. Private: no public access and no custom domain. Objects are served only through Worker routes that check the session, and every key starts with the organisation id, which the Worker compares with the session.

| Prefix | Content | Lifecycle rule |
|---|---|---|
| `selfies/<orgId>/<yyyy>/<mm>/<dd>/<punchId>.jpg` | Check-in selfies, JPEG about 480 px | Delete after 30 days |
| `hold/<orgId>/<punchId>.jpg` | Selfies under dispute (copied from `selfies/`) | None (nightly job) |
| `photos/<orgId>/<userId>.jpg` | Enrolled reference photo (only if selfies are on) | None (deleted on exit plus 30 days) |
| `payslips/<orgId>/<yyyy-mm>/<payslipId>-r<rev>.pdf` | Payslip PDFs | None (5-year purge job) |
| `exports/<orgId>/<exportId>.<csv or pdf>` | Report exports | Delete after 7 days |
| `backups/d1/<yyyy-mm-dd>.sql.gz` (P1) | Weekly D1 export | Delete after 90 days |

Object metadata: `content-type`, `x-org-id`, `x-sha256`. Owners get selfie thumbnails from `GET /owner/punches/:id/selfie` with `Cache-Control: private, max-age=604800`.

## Migrations

- Files live in `migrations/` as `NNNN_name.sql` and are applied with `wrangler d1 migrations apply`. `app/wrangler.jsonc` points both databases at `../migrations`.
- Locally and in CI the E2E run applies them to a local database. For the shared preview database, the `preview` workflow runs `wrangler d1 migrations apply fbc-staff-preview --remote -c wrangler.preview-migrations.jsonc`. In production, the `deploy` workflow exports the database first and then applies them ([deploy guide](deploy.md), [backup runbook](runbooks/backup-restore.md)).
- A bad migration is fixed forward with a new file. D1 Time Travel (30 days) is the safety net for the data.
- Current files: `0001_init.sql` (the PRD 8.2 schema), `0002_platform.sql` (idempotency keys and the preview outbox) `0003_time_credits_presence.sql` (time credits and presence, WP-9) and `0005_session_pin_reset.sql` (`sessions.pin_reset_until`, the forgotten owner PIN window; numbered after the owner access `0004`, which it does not need).
