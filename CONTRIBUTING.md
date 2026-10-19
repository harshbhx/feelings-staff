# Contributing to Feelings Staff

This repo is built by several parallel work packages (WPs, `docs/PRD.md` section 16). These rules keep them from stepping on each other.

## Ground rules

1. **Pull requests only.** Any change with more than one commit goes on a branch and through a PR. Never push to `main`.
2. **Conventional commits** with a scope: `feat(punch): …`, `fix(payroll): …`, `test(e2e): …`, `docs: …`. Branches are `feat/…`, `fix/…`, `docs/…`.
3. **No AI attribution** anywhere: not in commits, PR bodies, code comments or docs. No signature lines. Commits do not need GPG signing.
4. **Heavy work runs in GitHub Actions.** Do not run builds, test suites, browsers or dev servers on the shared 2-CPU VM. Locally you may run `pnpm install --lockfile-only`, Biome on the files you touched, and YAML or JSON parse checks. Push, then watch with `gh run watch`, read failures with `gh run view --log-failed`, and fetch reports with `gh run download`.
5. **Draft PRs while iterating.** `ci` runs on every push. `e2e` (Playwright, visual, axe) runs only when the PR is ready for review or labelled `e2e`, and on `main`. Mark the PR ready when you want the full suite.
6. **Definition of done** is PRD section 14.7: green checks, ACs tested and named with their id (`S-04.3`), strict types, no lint warnings, visual baselines at 390 and 1280 for new UI, axe clean, copy from the i18n catalogs, audit rows for every mutation, zod schemas for every input, docs updated, budgets met.

## Contracts

`packages/contracts` is frozen at `contracts-v1`. The server, the client and the mock all come from the same endpoint table (`packages/contracts/src/endpoints.ts`). Changing a schema or adding an endpoint needs a PR labelled `contract-change` that updates both sides, reviewed by the lead.

## Who owns what

Touching another package's paths needs that owner's review. Shared files are created once by WP-1 with every area already mounted, so nobody edits them to add routes.

| Package | Owns |
|---|---|
| WP-1 platform | root configs, `app/vite.config.ts`, `app/wrangler*.jsonc`, `app/worker/index.ts`, `app/worker/middleware/`, `app/worker/db/`, `app/worker/lib/`, `app/worker/seed/`, `app/worker/services/{ports,registry,audit,clock,outbox}.ts`, `app/worker/routes/{index,system}.ts`, `app/worker/routes/owner/{index,settings}.ts`, `app/worker/test-routes.ts`, `app/worker/test/` helpers, `app/src/{main,router}.tsx`, `app/src/api/`, `app/src/app/`, `packages/contracts/`, `migrations/`, `e2e/` harness, `scripts/`, `.github/` |
| WP-2 design system | `packages/ui/`, `app/src/styles/`, `app/src/features/kit/` |
| WP-3 auth | `app/worker/routes/auth/`, `app/worker/routes/staff/`, `app/worker/services/{auth,session,device,pin,invite,stepup}.ts`, `app/src/features/auth/`, `app/src/lib/device-key.ts` |
| WP-4 attendance | `app/worker/routes/attendance/`, `app/worker/routes/owner/{today,actions,register,days,roster,sites,duties,door}.ts`, `app/worker/services/{punch,fence,risk,day,door,duty,leave,regularisation,maps}.ts`, `packages/engine/src/{fence,risk}/`, `app/src/lib/punch/`, `app/src/lib/geolocation.ts`, `app/src/lib/qr/`, `app/src/features/door/` (logic) |
| WP-5 engine and payroll | `packages/engine/src/{schedule,day,pay,leave,money}/`, `packages/templates/`, `app/worker/routes/payroll/`, `app/worker/services/{payroll,payslip,pdf,export,advance}.ts`, `packages/i18n/*/payslip.json` |
| WP-6 owner panel | `app/src/features/owner/`, `app/src/features/public/`, `packages/i18n/*/owner.json` |
| WP-7 staff app and PWA | `app/src/features/staff/`, `app/src/pwa/` (except `sw/push-handlers.ts` and `push.ts`), `app/build/pwa.ts`, `app/public/` icons and manifest, `packages/i18n/*/{common,staff,errors,notify}.json`, `packages/i18n/src/` |
| WP-8 notifications and jobs | `app/worker/routes/notify/`, `app/worker/services/{notifier,push,email,whatsapp}.ts`, `app/worker/cron/`, `app/src/pwa/sw/push-handlers.ts`, `app/src/pwa/push.ts`, `app/src/features/inbox/`, `scripts/r2-lifecycle.ts` |

## How the pieces connect

- **Server endpoints.** Each route module exports `handlers: Handlers` (see `app/worker/lib/api.ts`). Registration, access checks (`access`, `perm`), input parsing, step-up, idempotency and the 501 stub for unbuilt endpoints are automatic. Outside production every response is validated against its contract schema.
- **Database.** Use `ctx.db` (`OrgDb`): every tenant statement contains `org_id = ?org`. Use `ctx.sys` (`SystemDb`) only for pre-auth lookups. `env.DB.prepare` outside `app/worker/db/` fails CI. Group a change and its audit row in one `ctx.db.batch([...])`.
- **Ports.** `app/worker/services/ports.ts` defines `Clock`, `Audit`, `Notifier`, `StepUp`, `DayService`, `PayrollService`, `PdfRenderer`, `PushSender`, `EmailSender`, `MapsResolver`, `Outbox`; `ctx.services` holds them.
- **Client.** Screens use `useApi()` (real client, or `MockApiClient` with `VITE_API_MODE=mock`) and TanStack Query. Copy comes from `packages/i18n` (`t('staff:today.checkIn')`).
- **Tests.** Workers API tests use `app/worker/test/helpers.ts` (`resetScenario`, `sessionFor`, `call`). E2E uses `e2e/fixtures` (`reset`, `setServerClock`, `runCron`, `outbox`, `setGeo`, `checkA11y`).

## Visual baselines

Run the `snapshots` workflow on your branch (`gh workflow run snapshots -f ref=<branch>`), download the `visual-baselines` artifact, review it, commit it to `e2e/tests/__screenshots__`, and push.
