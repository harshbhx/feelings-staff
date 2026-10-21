# Retention purge runbook

What the app deletes by itself, how to check that it really does, and how to remove a former staff member's data when they ask. The rules come from PRD 8.3 and 10.9 and the privacy notice staff accept when they join. The salon (Urmi) is the data fiduciary; Harsh is the processor and acts on her instructions.

Contents: [What is kept and for how long](#what-is-kept-and-for-how-long) · [How the purge runs](#how-the-purge-runs) · [Check that it works](#check-that-it-works) · [Purge a former staff member's data on request](#purge-a-former-staff-members-data-on-request) · [If the purge did not run](#if-the-purge-did-not-run)

## What is kept and for how long

Two kinds of data: things we keep only briefly (location, selfies, sessions) and wage records the law makes the salon keep for five years (Code on Wages).

| Data | Kept | Then | Job |
|---|---|---|---|
| Punch location: `punches.lat`, `lng`, `accuracy_m`, `distance_m` | 90 days | Set to NULL; `fence_result`, `distance_bucket` and `risk_*` stay | Nightly |
| Selfies (R2 `selfies/`) | 30 days | R2 rule deletes the file; nightly sets `selfie_deleted_at` | R2 rule and nightly |
| Disputed selfies (R2 `hold/`) | Until the dispute is decided, plus 30 days | Deleted | Nightly |
| Attendance, payslips, advances, fines, leave, payroll runs, salary history | 5 years after the person's last entry | Deleted | Monthly |
| Audit log `change` and `export` rows | 5 years | Deleted | Monthly |
| Audit log `security` and `access` rows | 1 year | Deleted | Nightly |
| Sessions, challenges, magic links | Until expiry plus 7 days | Deleted | Nightly |
| Owner passkey challenges | Until expiry plus 7 days | Deleted | Nightly |
| Owner device requests, owner recovery codes | Until expiry plus 30 days | Deleted | Nightly |
| Removed owner passkeys | 1 year after removal | Deleted | Nightly |
| Notifications | 180 days | Deleted | Nightly |
| Push subscriptions | Until the push service says 404 or 410, the device is revoked, or the person leaves | Deleted at once | On the event |
| Devices | Until revoked plus 30 days | Deleted; the id stays in audit references | Nightly |
| Calibration samples | 30 days after the calibration is applied | Deleted | Nightly |
| Salon network IPs (HMAC) | 7 days since last seen | Deleted | Nightly |
| Exports (R2 `exports/`) | 7 days | R2 rule deletes the file | R2 rule |
| A former staff member's profile | Statutory fields (name, code, designation, dates, wage records) 5 years. Phone, photo and consent detail are deleted 30 days after exit | Partial delete | Nightly |

The same table is in the [data model](../data-model.md#retention). The "location 90 days, selfies 30 days" promise is also what staff are told when they join, so the purge is a promise to them, not only a tidy-up.

## How the purge runs

- **Nightly job**, 03:00 IST (`30 21 * * *` UTC). Besides closing the previous work date, it performs every nightly row of the table above, in batches of 500 statements per D1 batch.
- **Monthly purge**, on the 1st, does the five-year deletes.
- **R2 lifecycle rules** delete selfies after 30 days, exports after 7 and (P1) backups after 90. They are created once with `gh workflow run r2-lifecycle -f mode=apply` (it runs `scripts/r2-lifecycle.ts`), and the same workflow runs in `check` mode every Monday and fails if a rule is missing.
- The job writes a summary row to `audit_log` (`actor_type = system`, `action = retention.purge`) with counts, and logs one structured line per organisation with counts and duration.
- It is **idempotent**: each action is guarded by a `cron_runs` row, so a retry does not repeat it and a failed run catches up on the next tick.
- Cron jobs run only on the production Worker, not on previews.

## Check that it works

Do this after the job has gone live, once a month for the first three months, and after any change to the job. Run from `app/`; `--remote` talks to production, and all of these only read.

1. **Did last night's run happen, and what did it delete?**

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT datetime(created_at/1000,'unixepoch') AS at_utc, after_json FROM audit_log WHERE action='retention.purge' ORDER BY created_at DESC LIMIT 5"
```

   Expect one row per night. A missing night means the job failed or did not run ([below](#if-the-purge-did-not-run)).

2. **No location older than 90 days.** Both counts must be 0 (ms = 90 days before now):

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT COUNT(*) AS old_locations FROM punches WHERE lat IS NOT NULL AND server_ts < (strftime('%s','now')-90*86400)*1000"
```

3. **No selfie reference older than 30 days:**

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT COUNT(*) AS old_selfies FROM punches WHERE selfie_key IS NOT NULL AND selfie_deleted_at IS NULL AND server_ts < (strftime('%s','now')-30*86400)*1000"
```

4. **Short-lived rows are gone.** Each should be 0 for rows older than their limit (`expires_at` plus 7 days for sessions, 180 days for notifications):

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT (SELECT COUNT(*) FROM sessions WHERE expires_at < (strftime('%s','now')-7*86400)*1000) AS stale_sessions, (SELECT COUNT(*) FROM notifications WHERE created_at < (strftime('%s','now')-180*86400)*1000) AS old_notifications, (SELECT COUNT(*) FROM salon_networks WHERE last_seen < (strftime('%s','now')-7*86400)*1000) AS old_networks"
```

5. **R2 rules exist and files are expiring.**

```sh
npx wrangler r2 bucket lifecycle list fbc-staff-media
npx wrangler r2 object get fbc-staff-media/<a selfie key older than 30 days> --remote --file=/dev/null   # should say not found
```

   The first command should show the 30-day (selfies) and 7-day (exports) rules. Take a key for the second check from a `selfies/` path in `punches.selfie_key` for an old punch.

6. **Exited people:** anyone with `status = 'exited'` and `exited_at` older than 30 days should have no phone and no photo:

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT COUNT(*) AS not_cleaned FROM users WHERE status='exited' AND exited_at < (strftime('%s','now')-30*86400)*1000 AND phone_e164 IS NOT NULL"
```

Write the result of each check in the [ops log](../ops-log.md) (a one-liner is enough).

## Purge a former staff member's data on request

A former staff member can ask for their data to be deleted (their right under the privacy notice; Settings, Data and privacy has "Delete a former staff member's data"). The salon decides, because it is the fiduciary. What the law lets us delete and what it makes the salon keep:

| Delete on request | Keep (statutory, 5 years after the last entry) |
|---|---|
| Phone number, devices, sessions, push subscriptions | Name, employee code, designation, joining and exit dates |
| Exact locations of every punch | Attendance days and punch times (without location) |
| Selfies, held selfies and the enrolled photo | Payslips, payroll runs, salary history |
| Consent records, notifications, invites | Leave, advances and fines records |
| | Audit log rows of type `change` and `export` |

Tell the person this plainly: the wage records stay for the five years the law requires and are deleted after that.

### Steps

1. **Get the request and Urmi's OK in writing** (a WhatsApp message is fine; keep a screenshot outside the repo). Note the date.
2. **Check the person has left.** The profile must show "Left" (`users.status = 'exited'`). If they are still active, do not purge; the owner marks them as left first (revokes devices and sessions).
3. **Prefer the app.** If Settings, Data and privacy has the delete action, use it. It does the steps below and writes the audit row. The SQL below is the fallback.
4. **Look first.** Set the ids once (`<org>` and `<user>` are the two ULIDs from the staff profile or `SELECT id, org_id, name, status FROM users WHERE name LIKE '%...%'`):

```sh
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT status, exited_at FROM users WHERE id='<user>' AND org_id='<org>'"
npx wrangler d1 execute fbc-staff --remote --command \
 "SELECT id, selfie_key FROM punches WHERE user_id='<user>' AND selfie_key IS NOT NULL AND selfie_deleted_at IS NULL"
```

5. **Take an export first** ([backup runbook](backup-restore.md#take-a-manual-export)).
6. **Delete the files in R2.** For each selfie key from the query above, and for the held and enrolled photos:

```sh
npx wrangler r2 object delete fbc-staff-media/<selfie key> --remote
npx wrangler r2 object delete fbc-staff-media/hold/<org>/<punch id>.jpg --remote
npx wrangler r2 object delete fbc-staff-media/photos/<org>/<user>.jpg --remote
```

   A "not found" for a held or enrolled photo is fine.
7. **Clear the rows.** Save this as a file outside the repo, replace the placeholders (`<now ms>` is `date +%s%3N`), read it once more, then run it with `d1 execute --file`. It is one batch.

```sql
UPDATE punches SET lat = NULL, lng = NULL, accuracy_m = NULL, distance_m = NULL,
  selfie_deleted_at = COALESCE(selfie_deleted_at, <now ms>)
  WHERE user_id = '<user>' AND org_id = '<org>';
UPDATE staff_profiles SET enrolled_photo_key = NULL WHERE user_id = '<user>' AND org_id = '<org>';
UPDATE users SET phone_e164 = NULL, pin_hash = NULL, pin_salt = NULL, updated_at = <now ms>
  WHERE id = '<user>' AND org_id = '<org>' AND status = 'exited';
DELETE FROM push_subscriptions WHERE user_id = '<user>' AND org_id = '<org>';
DELETE FROM sessions WHERE user_id = '<user>' AND org_id = '<org>';
DELETE FROM devices WHERE user_id = '<user>' AND org_id = '<org>';
DELETE FROM invites WHERE user_id = '<user>' AND org_id = '<org>';
DELETE FROM notifications WHERE user_id = '<user>' AND org_id = '<org>';
DELETE FROM notification_prefs WHERE user_id = '<user>';
DELETE FROM consents WHERE user_id = '<user>' AND org_id = '<org>';
INSERT INTO audit_log (id, org_id, category, actor_type, actor_id, action, entity, entity_id, reason, created_at)
  VALUES ('<new id>', '<org>', 'change', 'system', NULL, 'ops.manual', 'users', '<user>',
  'Data deleted at the former staff member''s request, approved by the owner on <date>', <now ms>);
```

8. **Verify.** Re-run the "look first" queries (zero rows), and check that the person's payslips and attendance still exist.
9. **Record.** Add an entry to the [ops log](../ops-log.md): date, request, who approved, what was deleted, what was kept and why. Tell Urmi, and tell the person it is done.

The statutory fields stay on the profile on purpose, so the person remains identifiable by name in the wage records for the five years. They are deleted by the monthly purge afterwards.

## If the purge did not run

1. Look at the Worker logs for the 03:00 IST run (`npx wrangler tail`, or the dashboard Logs) and at `cron_runs` for the latest slots.
2. A failed run retries on the next tick and is safe to repeat. If it keeps failing, find the error in the logs, fix it through a PR, and let the next night catch up.
3. If more than a few days are missed, run the checks above, and note in the ops log that the retention limit was exceeded and for how long.
4. If the R2 lifecycle rules are missing, add them by hand in the dashboard (R2, the bucket, Settings, Object lifecycle rules): `selfies/` after 30 days, `exports/` after 7.
