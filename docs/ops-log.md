# Operations log

A record of every manual action on production: anything done by hand through Wrangler or the Cloudflare dashboard instead of through the app or a pull request. PRD 10.11 requires it. There is no hidden admin or support login in the app, so this log and the audit log are how a direct action stays accountable to the owner.

## When to write an entry

Write one for:

- any SQL run against production data (`wrangler d1 execute --remote`), including reads of personal data you did for an investigation;
- a database restore, a Time Travel restore or a restore drill ([backup runbook](runbooks/backup-restore.md));
- a secret rotation ([secrets runbook](runbooks/secrets.md)), without the value;
- a rollback ([deploy guide](deploy.md#rollback)), a manual deploy, a change of the custom domain or the workers.dev route;
- an incident, from the first note to the closing summary ([incident runbook](runbooks/incident.md));
- a data purge on request ([retention runbook](runbooks/retention-purge.md)) and the monthly retention checks;
- the one-time owner bootstrap.

Normal deploys from `main` do not need an entry: the `deploy` workflow run, its tag and the `d1-backup` artifact are the record.

## Rules

1. Add the entry when you do the action, not later. Newest entries at the bottom.
2. Never write a secret, a PIN, a join code, a token or a full phone number. Refer to people by name and staff code.
3. Paste the exact SQL or command that changed data, with placeholders for ids that identify a person if you prefer, but keep it reproducible.
4. For every SQL write on production data, also insert an `audit_log` row (`actor_type = system`, `action = ops.manual`) and note its id here. The statement to use is in the [incident runbook](runbooks/incident.md#useful-commands).
5. Say who asked. Direct actions on production data happen only at the owner's request or to contain an incident. If Urmi asked, write that and when.
6. Corrections are new entries that refer to the old one; do not edit history.

## Entries

| Date and time (IST) | By | Action | Why and who asked | Command or SQL | Audit row id | Result |
|---|---|---|---|---|---|---|
| 21 Oct 2026 12:25 | lead (Wrangler OAuth) | Production created and owner bootstrapped | Harsh asked for go-live on staff.feelingsbeautycare.in | `d1 create fbc-staff`, `r2 bucket create fbc-staff-media`, migrations 0001-0003, `wrangler deploy --secrets-file`, `POST /api/v1/setup` once | none (setup) | 201, org created, health ok on the custom domain |
| | | | | | | |

Copy the last row for each new entry. A longer incident can have a heading of its own under this table with the timeline, root cause, change made, pull request link, and who was told and when.
