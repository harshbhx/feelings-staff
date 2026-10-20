# Backup and restore runbook

What copies of the production data exist, how to take one, and how to restore. The database is D1 (`fbc-staff`); files are in R2 (`fbc-staff-media`). Run the commands on your own machine, in `app/`, signed in to the salon's Cloudflare account.

Contents: [What exists](#what-exists) · [Before every deploy](#before-every-deploy) · [Take a manual export](#take-a-manual-export) · [Restore with Time Travel](#restore-with-time-travel) · [Restore from an export](#restore-from-an-export) · [Weekly backup to R2 (P1)](#weekly-backup-to-r2-p1) · [Files in R2](#files-in-r2) · [After a restore](#after-a-restore) · [Verify a backup](#verify-a-backup)

## What exists

| Copy | Covers | How far back | Where | State |
|---|---|---|---|---|
| D1 Time Travel | The whole database, to any minute | 30 days | Inside Cloudflare, automatic | Always on |
| Pre-deploy export | The database as it was just before a deploy | 30 days | GitHub Actions artifact `d1-backup` of each `deploy` run | Built (`deploy.yml`) |
| Manual export | The database at a moment you choose | Until you delete it | A `.sql` file on your machine | On demand |
| Weekly export to R2 | The database every week | 90 days | R2 `backups/d1/<yyyy-mm-dd>.sql.gz` | P1, not built yet (PRD X-06) |

A restore is a serious action: it loses everything written after the restore point. Take an export first, tell Urmi, and write the action in the [ops log](../ops-log.md).

## Before every deploy

The `deploy` workflow does this for you, in this order: build, `wrangler d1 export fbc-staff --remote`, upload the file as the `d1-backup` artifact (kept 30 days), apply migrations, deploy, smoke test.

To find and download the copy from just before a given deploy:

```sh
gh run list --workflow deploy --limit 10
gh run download <run-id> -n d1-backup        # saves d1-backup-YYYYMMDD-HHMM.sql
```

Treat the file as confidential: it holds staff names, phone numbers and wage records. Keep it on your machine, not in the repo, and delete it when it is no longer needed.

For a risky manual change (a hand-written migration, a bulk SQL fix), take an export yourself first, even though the last deploy made one.

## Take a manual export

```sh
cd app
npx wrangler d1 export fbc-staff --remote --output=../d1-export-$(date +%Y%m%d-%H%M).sql
```

The file is plain SQL (schema and data). The database is small, so this takes seconds; do it outside salon hours if you can, because an export holds the database while it runs. Check that the file is not empty and ends with an `INSERT` or `CREATE INDEX` statement.

## Restore with Time Travel

Use this when data was damaged within the last 30 days: a bad migration, a wrong bulk update, an accidental delete.

1. Decide the restore point: a time just before the damage (use the audit log, `deployments list`, or the time of the bad action). Times are UTC unless you give an offset.
2. Take a manual export of the current state (above), so nothing is lost by the restore itself.
3. Look at the current bookmark, and write it down:

```sh
npx wrangler d1 time-travel info fbc-staff
```

4. Restore. Use a timestamp or a bookmark:

```sh
npx wrangler d1 time-travel restore fbc-staff --timestamp=2026-11-02T04:10:00Z
```

5. Wrangler prints the bookmark from before the restore. Keep it: restoring to that bookmark undoes the restore.
6. Go to [After a restore](#after-a-restore).

Time Travel restores the whole database in place. It cannot restore a single table or a single person. For that, restore into a scratch database from an export and copy the rows you need (below).

## Restore from an export

Use this when the damage is older than 30 days, or when you need only some rows.

1. Get the export file (pre-deploy artifact, manual export, or the weekly R2 file once it exists).
2. Create a scratch database and load the file:

```sh
npx wrangler d1 create fbc-staff-restore --location apac
npx wrangler d1 execute fbc-staff-restore --remote --file=../d1-export-20261102-0410.sql
```

3. Look at the data with `wrangler d1 execute fbc-staff-restore --remote --command "SELECT ..."` and check that it is the state you want.
4. Either:
   - **Copy rows back.** Export the rows you need from the scratch database as `INSERT` statements, review them, and apply them to `fbc-staff` with `d1 execute --file`. Every `org_id` must match the real organisation.
   - **Switch the Worker to the scratch database.** Put its `database_id` in `app/wrangler.jsonc` through a PR and deploy. Do this only if the real database is unusable. Keep the old database until you are sure.
5. Delete the scratch database when you are done: `npx wrangler d1 delete fbc-staff-restore`.

Loading an export into a database that already has tables fails on the first `CREATE TABLE`. Always load into a new, empty database.

## Weekly backup to R2 (P1)

Planned and not built yet (PRD X-06): a step in `nightly.yml` that, once a week, runs `wrangler d1 export fbc-staff --remote`, compresses it and stores it as `backups/d1/<yyyy-mm-dd>.sql.gz` in `fbc-staff-media`, with a 90-day lifecycle rule. It is on top of Time Travel's 30 days so a problem found late can still be undone.

When it exists, fetch a copy with:

```sh
npx wrangler r2 object get fbc-staff-media/backups/d1/2026-11-01.sql.gz --remote --file=../backup.sql.gz
gunzip ../backup.sql.gz
```

Then restore as in [Restore from an export](#restore-from-an-export). Until it is built, the pre-deploy exports and Time Travel are the copies you have, which cover 30 days.

## Files in R2

R2 has no versioning here, and the lifecycle rules delete files on purpose ([retention](retention-purge.md)).

- **Selfies** (30 days) and **exports** (7 days) are short-lived by design and are not backed up.
- **Payslip PDFs** are kept for 5 years. Each payslip's frozen snapshot is in D1 (`payslips.snapshot_json`), so a lost PDF can be made again from it, and the HTML payslip works meanwhile.
- **Enrolled photos** exist only when selfies are on, and the owner can retake them.

## After a restore

1. `curl -fsS https://staff.feelingsbeautycare.in/api/v1/health` answers `ok`.
2. Sign in as the owner. Open Today and the Register for the current month.
3. Compare a few facts with the live world: the newest punch time, the number of staff, the latest payroll status, the last audit entry. Everything after the restore point is gone, so list what that window contained (check-ins, requests, decisions).
4. Tell Urmi what was lost in plain words, and tell staff who need to check in or ask again. Check-ins can be repaired through "Fix a day" or by the owner's day override.
5. Phones that queued punches keep them and send them when online, so some lost punches may reappear; they are accepted or flagged by the normal rules.
6. Write the ops log entry: date and time, reason, restore point, bookmark before and after, who was told. Add the `ops.manual` audit row ([incident runbook](incident.md#useful-commands)).

## Verify a backup

A backup that has never been restored is a guess. Do this once before launch, and then every three months. It uses a scratch database, so production is never touched. It takes about 15 minutes. Run from `app/`.

1. **Get the newest copy.** Download the export of the last deploy, or take a manual one:

```sh
gh run list --workflow deploy --limit 5
gh run download <run-id> -n d1-backup
# or: npx wrangler d1 export fbc-staff --remote --output=../d1-export-$(date +%Y%m%d-%H%M).sql
```

2. **Check the file.** It must not be empty, and it must hold the tables:

```sh
ls -l ../d1-export-*.sql d1-backup-*.sql 2>/dev/null
grep -c 'CREATE TABLE' <the file>
grep -c 'INSERT INTO' <the file>
```

   Both counts must be above zero.

3. **Load it into a new, empty scratch database.**

```sh
npx wrangler d1 create fbc-staff-restore --location apac
npx wrangler d1 execute fbc-staff-restore --remote --file=<the file>
```

4. **Compare it with production.** The counts will differ only by what happened since the copy was taken:

```sh
npx wrangler d1 execute fbc-staff-restore --remote --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM punches) AS punches, (SELECT COUNT(*) FROM payslips) AS payslips"
npx wrangler d1 execute fbc-staff --remote --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM punches) AS punches, (SELECT COUNT(*) FROM payslips) AS payslips"
```

   The numbers of users and payslips should match or be close. Punches may be higher in production.

5. **Check the newest data.** The latest punch time in the scratch copy should be close to the time of the export:

```sh
npx wrangler d1 execute fbc-staff-restore --remote --command "SELECT datetime(MAX(server_ts)/1000,'unixepoch') AS newest_punch_utc FROM punches"
```

6. **Delete the scratch database and the local files.** The export holds personal data.

```sh
npx wrangler d1 delete fbc-staff-restore
rm -f ../d1-export-*.sql d1-backup-*.sql
```

7. **Also check Time Travel works:** `npx wrangler d1 time-travel info fbc-staff` shows a current bookmark and a restore window of 30 days. Do not restore.
8. **Write one line in the [ops log](../ops-log.md):** the date, which copy, the counts, and "verified".

If a step fails (empty file, load errors, counts far apart), treat it as an urgent problem: take a fresh export, find the cause, and verify again before the next payroll.
