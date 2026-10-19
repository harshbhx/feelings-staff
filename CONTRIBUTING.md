# Contributing to Feelings Staff

This repo is built by several parallel work packages (WPs, [`docs/PRD.md`](docs/PRD.md) section 16). These rules keep them from stepping on each other. For how to set up, run checks and read failures, see [`docs/setup.md`](docs/setup.md); for the design, [`docs/architecture.md`](docs/architecture.md).

Contents: [Ground rules](#ground-rules) · [Docs](#docs) · [Contracts](#contracts) · [Who owns what](#who-owns-what) · [How the pieces connect](#how-the-pieces-connect) · [Visual baselines](#visual-baselines)

## Ground rules

1. **Pull requests only.** Any change with more than one commit goes on a branch and through a PR. Never push to `main`. The lead reviews and merges (merge commits); follow your PR until it is merged or closed.
2. **Conventional commits** with a scope: `feat(punch): …`, `fix(payroll): …`, `test(e2e): …`, `docs: …`. Branches are `feat/…`, `fix/…`, `docs/…`.
3. **No AI attribution** anywhere: not in commits, PR bodies, code comments or docs. No signature lines. Commits do not need GPG signing.
4. **Heavy work runs in GitHub Actions.** Do not run builds, test suites, browsers or dev servers (`mint dev` included) on the shared 2-CPU VM. Locally you may run `pnpm install --lockfile-only`, Biome on the files you touched, and YAML or JSON parse checks. Push, then watch with `gh run watch <id> --exit-status`, read failures with `gh run view <id> --log-failed`, and fetch reports with `gh run download`. The workflows and the scripts are described in [`docs/setup.md`](docs/setup.md).
5. **Draft PRs while iterating.** `ci` runs on every push. `e2e` (Playwright, visual, axe) runs only when the PR is ready for review or labelled `e2e`, and on `main`. Mark the PR ready when you want the full suite.
6. **Definition of done** is PRD section 14.7: green checks, ACs tested and named with their id (`S-04.3`), strict types, no lint warnings, visual baselines at 390 and 1280 for new UI, axe clean, copy from the i18n catalogs, audit rows for every mutation, zod schemas for every input, docs updated, budgets met.
7. **PR body** follows `.github/pull_request_template.md`: a `Preview:` line (posted by the `preview` workflow), what changed, results, and numbered acceptance checks.
8. **Labels.** `contract-change` for any change to a schema or endpoint, `e2e` to run the browser suite on a draft PR, `documentation` for docs-only PRs.

## Docs

Docs live in the repo and change in the same PR as the behaviour they describe (definition of done, item 7).

| Change | Update |
|---|---|
| Behaviour that the PRD describes | `docs/PRD.md`, with a line in Appendix C (changelog) |
| An endpoint, a schema or an error code | `docs/api.md` (a Vitest test in `packages/contracts/test/api-docs.test.ts` fails when an endpoint is missing there) |
| A table, a migration, retention or an R2 prefix | `docs/data-model.md` and the retention runbook |
| An architectural decision | A new file in `docs/decisions/` (next number; never rewrite an accepted record) |
| A workflow, a script or a setup step | `docs/setup.md` and, for go-live steps, `docs/deploy.md` |
| Ops: secrets, backups, incidents, purges | The matching file in `docs/runbooks/`, and an entry in `docs/ops-log.md` for any manual action on production |
| Copy on a screen that the guides describe | `docs/guides/staff.md` or `docs/guides/owner.md` |
| Anything user-visible or developer-visible | A line under Unreleased in `CHANGELOG.md` |

Style: plain, concise English in sentence case, no marketing words, no emoji, diagrams in mermaid (GitHub renders it). Full GitHub URLs when you refer to a PR or issue, never a bare number. Keep `<!-- screenshot: name -->` markers where screenshots go; the lead adds the images at the end.

`ci`, `e2e` and `preview` skip PRs that only touch `docs/**` or `*.md` files, so a docs-only PR shows no checks. If it adds a file under `packages/` (such as the API docs test), `ci` runs.

## Contracts

`packages/contracts` is frozen at `contracts-v1`. The server, the client and the mock all come from the same endpoint table (`packages/contracts/src/endpoints.ts`). Changing a schema or adding an endpoint needs a PR labelled `contract-change` that updates both sides, reviewed by the lead.

## Who owns what

Touching another package's paths needs that owner's review. Shared files are created once by WP-1 with every area already mounted, so nobody edits them to add routes.

| Package | Owns |
|---|---|
| WP-1 platform | root configs, `app/vite.config.ts`, `app/wrangler*.jsonc`, `app/worker/index.ts`, `app/worker/middleware/`, `app/worker/db/`, `app/worker/lib/`, `app/worker/seed/`, `app/worker/services/{ports,registry,audit,clock,outbox}.ts`, `app/worker/routes/{index,system}.ts`, `app/worker/routes/owner/{index,settings}.ts`, `app/worker/test-routes.ts`, `app/worker/test/` helpers, `app/src/{main,router}.tsx`, `app/src/api/`, `app/src/app/`, `packages/contracts/`, `migrations/`, `e2e/` harness, `scripts/`, `.github/` |
| WP-2 design system | `packages/ui/`, `app/src/styles/`, `app/src/features/kit/`, `packages/i18n/*/ui.json` |
| WP-3 auth | `app/worker/routes/auth/`, `app/worker/routes/staff/`, `app/worker/services/{auth,session,device,pin,invite,stepup}.ts`, `app/src/features/auth/`, `app/src/lib/device-key.ts`, `app/src/lib/idb.ts` (opens the `feelings` IndexedDB with every store from PRD 11.5), `packages/i18n/*/auth.json` |
| WP-4 attendance | `app/worker/routes/attendance/`, `app/worker/routes/owner/{today,actions,register,days,roster,sites,duties,door}.ts`, `app/worker/services/{punch,fence,risk,day,door,duty,leave,regularisation,maps}.ts`, `packages/engine/src/{fence,risk}/`, `app/src/lib/punch/`, `app/src/lib/geolocation.ts`, `app/src/lib/qr/`, `app/src/features/door/` (kiosk logic and UI), `packages/i18n/*/door.json` |
| WP-5 engine and payroll | `packages/engine/src/{schedule,day,pay,leave,money}/`, `packages/templates/`, `app/worker/routes/payroll/`, `app/worker/services/{payroll,payslip,pdf,export,advance}.ts`, `packages/i18n/*/payslip.json` |
| WP-6 owner panel | `app/src/features/owner/`, `app/src/features/public/`, `packages/i18n/*/owner.json` |
| WP-7 staff app and PWA | `app/src/features/staff/`, `app/src/pwa/` (except `sw/push-handlers.ts` and `push.ts`), `app/build/pwa.ts`, `app/public/` icons and manifest, `packages/i18n/*/{common,staff,errors}.json`, `packages/i18n/src/` |
| WP-8 notifications and jobs | `app/worker/routes/notify/`, `app/worker/services/{notifier,push,email,whatsapp}.ts`, `app/worker/cron/`, `app/src/pwa/sw/push-handlers.ts`, `app/src/pwa/push.ts`, `app/src/features/inbox/`, `scripts/r2-lifecycle.ts`, `packages/i18n/*/notify.json` |
| Docs | `docs/` (except `docs/PRD.md` semantics, which change only with a changelog line), `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `packages/contracts/test/api-docs.test.ts`. Every package updates the pages that describe its own behaviour (see Docs above) |

## How the pieces connect

- **Server endpoints.** Each route module exports `handlers: Handlers` (see `app/worker/lib/api.ts`). Registration, access checks (`access`, `perm`), input parsing, step-up, idempotency and the 501 stub for unbuilt endpoints are automatic. Outside production every response is validated against its contract schema.
- **Database.** Use `ctx.db` (`OrgDb`): every tenant statement contains `org_id = ?org`. Use `ctx.sys` (`SystemDb`) only for pre-auth lookups. `env.DB.prepare` outside `app/worker/db/` fails CI. Group a change and its audit row in one `ctx.db.batch([...])`.
- **Ports.** `app/worker/services/ports.ts` defines `Clock`, `Audit`, `Notifier`, `StepUp`, `DayService`, `PayrollService`, `PdfRenderer`, `PushSender`, `EmailSender`, `MapsResolver`, `Outbox`; `ctx.services` holds them.
- **Client.** Screens use `useApi()` (real client, or `MockApiClient` with `VITE_API_MODE=mock`) and TanStack Query. Copy comes from `packages/i18n` (`t('staff:today.checkIn')`).
- **E2E specs.** Each package adds its specs under `e2e/tests/<area>/` (`auth`, `attendance`, `payroll`, `owner`, `staff`, `notify`, `kit`) and names baselines with the area prefix, so packages never edit the same spec file.
- **Tests.** Workers API tests use `app/worker/test/helpers.ts` (`resetScenario`, `sessionFor`, `call`) and the port fakes in `app/worker/test/fakes/` with `setServiceOverridesForTests` from `services/registry.ts`.
- **Mock mode.** On localhost (CI E2E only) `?mock=1` makes the SPA use `MockApiClient` over the fixtures, with `&variant=meToday:checked-in,...` for states. Visual baselines of screens use mock mode for stable data; flow E2E uses the real API. E2E uses `e2e/fixtures` (`reset`, `setServerClock`, `runCron`, `outbox`, `setGeo`, `checkA11y`).

## Visual baselines

Baselines are made only in CI, in the same Docker image the `e2e` workflow uses. Run the `snapshots` workflow on your branch (`gh workflow run snapshots -f ref=<branch>`), download the `visual-baselines` artifact (`gh run download <id> -n visual-baselines`), review the images, then either commit them to `e2e/tests/__screenshots__` and push, or run the workflow with `-f commit=true` to have it push them for you. A push by the workflow does not start `ci`, so push a small follow-up commit to re-run the checks.
