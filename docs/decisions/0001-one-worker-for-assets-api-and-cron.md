# ADR-01. One Worker for assets, API and cron

Status: accepted, 19 Oct 2026. Source: PRD 13.5, 15.1.

## Context

The reference site (the salon's marketing website) runs on Cloudflare Pages with Functions. Pages Functions have no cron triggers, and a separate cron Worker would split the code and the deploy in two. The app needs same-origin cookies, scheduled jobs and per-PR previews.

## Decision

Run one Worker, `feelings-staff`, that serves everything:

- Static assets from the Vite build, with `not_found_handling: "single-page-application"`.
- `run_worker_first: ["/api/*", "/v/*", "/q/*", "/__kit"]`, so these paths reach the Worker code and everything else is served straight from assets.
- The Hono API under `/api/v1`.
- `scheduled()` for the two cron triggers (see [ADR-10](0010-two-crons-and-an-idempotency-table-no-queues-in-v1.md)).

The entry point is `app/worker/index.ts`; the config is `app/wrangler.jsonc`.

## Consequences

- One deploy unit and one version to roll back with `wrangler rollback` (assets included).
- The session cookie is same-origin, so `SameSite=Strict` works and CORS is not needed.
- Worker Previews give every PR its own URL.
- The plan must be **Workers Paid** ($5 a month). The app needs it for CPU time (signature checks, push encryption), Email Sending and Browser Run, so this is not an extra cost. It is already active on the salon's account.
- Cron triggers do not run on Previews; tests call `/__test/cron` instead.
