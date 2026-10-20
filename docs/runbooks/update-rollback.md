# Update and rollback

How a change gets to the salon, how to check it worked, and how to go back if it did not. The code and the data are rolled back separately. The facts here match `.github/workflows/deploy.yml`; the longer story is in the [deploy guide](../deploy.md).

Contents: [How an update reaches production](#how-an-update-reaches-production) · [Choose a good time](#choose-a-good-time) · [Deploy by hand](#deploy-by-hand) · [Check an update worked](#check-an-update-worked) · [Roll back the code](#roll-back-the-code) · [If a migration is the problem](#if-a-migration-is-the-problem) · [Roll back the data](#roll-back-the-data) · [Tell people](#tell-people) · [The minimum app version](#the-minimum-app-version)

## How an update reaches production

1. A change is made on a branch and goes through a pull request. Checks `ci`, `e2e` and `preview` must pass.
2. The pull request is merged into `main`.
3. When `e2e` passes on `main`, the `deploy` workflow starts by itself. Docs-only merges do not deploy.
4. `deploy` makes sure `ci` was green for that commit, then: builds, exports the production database as the `d1-backup` artifact (kept 30 days), applies new migrations, publishes the Worker with the app, checks `/api/v1/health`, `/api/v1/config` and the home page, and tags the commit `vYYYY.MM.DD-N`.
5. Staff phones pick up the new version the next time they open the app. They see "A new version is ready" and tap **Update**.

If the deploy fails before the publish step, nothing changed for users. If it fails at the smoke checks, the new version is already live: decide quickly between fixing forward and [rolling back](#roll-back-the-code).

## Choose a good time

- Best: before the salon opens, or after it closes. Check-ins from 09:00 to 10:30 are the busiest time.
- Avoid the 1st to the 3rd (payroll) and the 5th to the 7th (salaries) unless the change is a fix for payroll itself.
- Tell Urmi before a change that she will notice.

## Deploy by hand

Normally not needed. To deploy the current `main`:

```sh
gh workflow run deploy --ref main
gh run list --workflow deploy --limit 1
gh run watch <run-id> --exit-status
gh run view <run-id> --log-failed        # only if it failed
```

The workflow needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Without them it prints a notice and does nothing. The `production` environment may ask a reviewer to approve first.

## Check an update worked

1. The `deploy` run is green, including the smoke step.
2. `curl -fsS https://staff.feelingsbeautycare.in/api/v1/health` answers `{"ok":true,...}` with the new `version` and `commit`. Compare the commit with the one you merged.
3. Open the app on a phone: it loads, **Today** shows the right day, and (for staff) the **Check in** sheet opens.
4. Sign in as the owner and open **Today** and **Needs action**.
5. For a payroll change: open the current draft and compare a person's payslip with the one before.
6. Watch `npx wrangler tail` for a few minutes from `app/` for errors.

## Roll back the code

The Worker and its app files are versioned together, so one command goes back. Run from `app/`, signed in to the salon's Cloudflare account:

```sh
npx wrangler deployments list           # recent versions
npx wrangler rollback                   # to the previous version
npx wrangler rollback <version-id>      # to a chosen version
```

The dashboard has the same: Workers and Pages, `feelings-staff`, Deployments.

Then:

1. Check `/api/v1/health` again.
2. Open a **revert pull request** so `main` matches what is live. If you skip this, the next deploy puts the bad version back.
3. Write the rollback in the [ops log](../ops-log.md): date, version before and after, reason.

A rollback does not touch the database. Migrations only add things (never drop or rename in the same release), so the older code still works with the newer database.

## If a migration is the problem

- A migration that failed halfway: `deploy` stops, and nothing is published. Read the log (`gh run view <run-id> --log-failed`), fix with a **new** migration in a pull request. Never edit a migration that has already been applied ([data model](../data-model.md#migrations)).
- A migration that applied but is wrong: roll the code back if needed, then fix forward with a new migration.
- Data was damaged: go to [roll back the data](#roll-back-the-data) and the [backup runbook](backup-restore.md). The `d1-backup` artifact of that deploy is the copy from just before the migration:

```sh
gh run list --workflow deploy --limit 10
gh run download <run-id> -n d1-backup
```

## Roll back the data

A data restore is serious: it loses everything written after the restore point. Check-ins, requests and decisions made in between would be gone.

1. Be sure it is the data and not the code. Try [rolling back the code](#roll-back-the-code) first if the problem started with a deploy.
2. Take a manual export of the current state, tell Urmi, then follow [Restore with Time Travel](backup-restore.md#restore-with-time-travel).
3. After it, follow [After a restore](backup-restore.md#after-a-restore) and write the ops log entry.

## Tell people

- **Urmi:** one line before and after anything she will notice, in plain words ("The app has a fix for payslips. Staff will see Update once.").
- **Staff:** usually no message. The app asks them to tap **Update**. After a rollback they may be asked again to update to the older version.
- **After a payroll-related rollback:** tell Urmi what was wrong and whether anything needs doing again.

## The minimum app version

`MIN_APP_VERSION` (in `app/wrangler.jsonc` `vars`) is the oldest app version that is allowed to talk to the server. An older phone gets "Please update the app" and cannot check in until it updates.

- Raise it only when an old app would break something (a changed API the old app cannot use).
- Raising it takes effect on the next deploy, and everyone has to update at their next opening. Do it outside working hours and tell Urmi first.
- Never set it higher than the version you have deployed, or nobody can use the app.
- `APP_VERSION` is the version of the build you are deploying.
