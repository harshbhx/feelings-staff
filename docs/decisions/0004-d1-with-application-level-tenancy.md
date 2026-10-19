# ADR-04. D1 with application-level tenancy

Status: accepted, 19 Oct 2026. Source: PRD 8.1, 10.8, 13.5.

## Context

The product is single-salon today, but the data model should not need a rewrite if a second salon ever joins. D1 (SQLite) has no row-level security. Supabase was considered; it is a new vendor, its free tier pauses, and the salon is already on Cloudflare.

## Decision

Use one D1 database per environment and put `org_id` on every table except `orgs` and `app_meta`. All access goes through `app/worker/db/`: `OrgDb` adds `org_id = ?org` to every statement, and `SystemDb` is for the few lookups that happen before sign-in. `scripts/check-arch.mjs` fails `ci` when raw `env.DB.prepare` or `.batch` is used outside `app/worker/db/`, the seed, or tests.

## Consequences

- Isolation is only as good as the repository layer, so the tests are mandatory: `app/worker/test/tenant.test.ts` seeds two organisations and proves that another organisation's ids answer 404 and change nothing.
- R2 keys start with the organisation id, and the Worker checks it against the session before serving.
- The public routes before sign-in use the single organisation of the deployment (`resolveSingleOrg`).
