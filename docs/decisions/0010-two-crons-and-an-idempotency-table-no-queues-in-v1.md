# ADR-10. Two crons and an idempotency table, no Queues in v1

Status: accepted, 19 Oct 2026. Source: PRD 9.5, 13.5.

## Context

The product needs timed rules (reminders, not-in-yet alerts, auto-close, payroll draft) and a nightly clean-up, for one salon with about 10 staff.

## Decision

Two cron triggers on the production Worker: `*/5 * * * *` runs the `rules` job for each organisation in IST, and `30 21 * * *` (03:00 IST) runs `nightly`. Each action is guarded by a `cron_runs` row (`job`, `org_id`, `slot`), so a retry never repeats it. Fan-out uses `ctx.waitUntil(Promise.allSettled(...))`. Cloudflare Queues are left for a multi-tenant future.

## Consequences

- A failed job simply runs again on the next tick.
- Crons do not run on Previews; tests call `POST /__test/cron`.
- Each run logs one structured line per organisation with counts and duration.
- The job bodies belong to WP-8; until they land, `runJob` returns `implemented: false`.
