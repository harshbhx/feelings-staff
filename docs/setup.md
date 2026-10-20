# Setup and local development

How to work on Feelings Staff. The short version: you edit code and use git on your machine, and **GitHub Actions does every build, test run, browser run and screenshot**. Nothing here asks you to run those locally.

Contents: [The rule](#the-rule-heavy-work-runs-in-github-actions) · [Get the code](#get-the-code) · [What you may run locally](#what-you-may-run-locally) · [The workflow of a change](#the-workflow-of-a-change) · [Workflows](#github-actions-workflows) · [Scripts](#scripts) · [Secrets for tests](#secrets-for-tests-and-dev-vars) · [Mock mode](#mock-mode) · [Reading failures](#reading-failures) · [Visual baselines](#visual-baselines)

## The rule: heavy work runs in GitHub Actions

The machine this project is built from (a shared VM with 2 CPUs) cannot run builds, test suites or browsers without making everything else crawl. So:

- **Do not run** on that machine: `pnpm build`, `pnpm test*`, `pnpm e2e`, Playwright, `vite`, `vite preview`, `wrangler dev`, `mint dev` or any other dev server, screenshot job or Lighthouse run.
- **Do run** quick checks that finish in seconds (see below).
- Push the branch and let Actions do the rest. The workflows below already cover typecheck, lint, unit tests, Workers API tests, build, size budgets, browsers, accessibility and visual checks.

If a repo rule and this page ever disagree, [CONTRIBUTING.md](../CONTRIBUTING.md) wins.

## Get the code

Requirements: Git, the [GitHub CLI](https://cli.github.com/) (`gh`), Node 22 (`.node-version`) and pnpm 10 (`packageManager` in `package.json`; `corepack enable` provides it).

```sh
gh repo clone harshbhx/feelings-staff
cd feelings-staff
git switch -c feat/my-change
```

The repo is a pnpm workspace: `app/` (SPA and Worker), `packages/*` (`contracts`, `engine`, `i18n`, `templates`, `ui`) and `e2e/`. The map and owners are in [architecture.md](architecture.md#packages-and-owners).

## What you may run locally

| Command | Why it is fine |
|---|---|
| `pnpm install --lockfile-only` | Updates `pnpm-lock.yaml` after you change a `package.json`. It only resolves versions; it does not install or build. |
| `npx @biomejs/biome@2.5.15 check --write <files you touched>` | Lint and format on a few files. Use the version pinned in `package.json`. Do not run it on the whole repo; `pnpm lint` does that in CI. |
| Parse checks: YAML, JSON, one `node --check file.mjs` | Takes milliseconds. |
| `node scripts/gen-secrets.mjs --dev-vars app/.dev.vars` | Writes throwaway secrets (see below). |
| `curl` against a preview or production URL | One request. |
| `git`, `gh` | Always. |

Stop any local server or browser you start by mistake.

## The workflow of a change

1. Branch from `main` (`feat/...`, `fix/...`, `docs/...`). Use conventional commits with a scope (`feat(punch): ...`).
2. Edit. Run Biome on the files you touched. No AI attribution lines anywhere.
3. Push and open a **draft** PR into `main`. `ci` starts on every push.
4. Watch it and fix what fails (see [Reading failures](#reading-failures)).
5. When `ci` is green, mark the PR ready for review. That also starts `e2e` and `preview`.
6. The lead reviews and merges with a merge commit. Never push to `main`.

Anything with more than one commit goes through a PR, in your own repos and in others. Fill in the PR template (`Preview:` line, what changed, results, numbered acceptance checks). The full rules and the definition of done are in [CONTRIBUTING.md](../CONTRIBUTING.md).

```sh
git push -u origin HEAD
gh pr create --draft --base main
gh pr checks --watch
```

## GitHub Actions workflows

All workflows are in `.github/workflows/`. `ci`, `e2e` and `preview` skip changes that only touch `docs/**` or `*.md` files (`paths-ignore`).

| Workflow | Runs when | What it does |
|---|---|---|
| `ci` | Every push to a PR, pushes to `main`, manual | One job. Install with the frozen lockfile, then (every step runs even if an earlier one fails): typecheck, Biome lint, `check:ui`, `check:arch`, `check:i18n`, unit tests (contracts, engine, i18n, ui, templates), client unit tests, Workers API tests with coverage, build, size budgets. Uploads coverage and the size report. |
| `e2e` | Pushes to `main`; PRs that are **ready for review** (not drafts); draft PRs labelled `e2e`; manual (optional `grep`); called by `nightly` | Playwright in the Playwright Docker image: generates throwaway secrets, builds, runs four projects (`staff-android`, `staff-ios`, `owner-desktop`, `owner-phone`) with axe and visual checks. Uploads the report, traces and screenshots (7 days). |
| `snapshots` | Manual on a branch | Regenerates the visual baselines in the same image; always uploads them, and with `commit=true` also pushes them to the branch. See [Visual baselines](#visual-baselines). |
| `preview` | Ready (non-draft) PRs from a branch in this repo | Builds, applies migrations to `fbc-staff-preview`, deploys a Worker Preview named `pr-<number>`, smoke-tests it with `curl`, and posts `**Preview:** <url>` on the PR. Without the Cloudflare secrets it only prints a notice. |
| `deploy` | When `e2e` completes successfully on `main`; manual | Needs a green `ci` for the commit. Builds, exports the production database as an artifact (30 days), applies migrations, deploys, smoke-tests the live URL, tags `vYYYY.MM.DD-N`. Uses the `production` environment. Without the Cloudflare secrets it prints a notice and does nothing. See [deploy.md](deploy.md). |
| `nightly` | 02:00 IST daily; manual | Audits production dependencies (`pnpm audit --prod --audit-level high`). If `main` changed in the last 24 hours (or on a manual run), also runs the full `e2e` workflow. |

The planned weekly D1 export to R2 and the error-rate alert email are P1 and are not built yet (PRD X-06, X-07).

Notes:

- A docs-only PR therefore shows no `ci` run. Branch protection should list `ci`, `e2e` and `preview` as required checks only once code PRs flow (PRD 15.2).
- `e2e` takes up to 40 minutes. Open PRs as drafts while iterating, then mark ready (or add the `e2e` label) when you want it.
- To run a subset: `gh workflow run e2e --ref <branch> -f grep="E2E-04"`.

## Scripts

Root `package.json`:

| Script | What it runs | Where |
|---|---|---|
| `pnpm typecheck` | `tsc` for every workspace package (`app` runs four tsconfigs: app, worker, sw, node), without stopping at the first failure | CI |
| `pnpm lint` | `biome ci --error-on-warnings .` | CI |
| `pnpm format` | `biome check --write .` | Your machine, on files you touched (prefer the `npx` form above) |
| `pnpm check:ui` | `scripts/check-ui.mjs`: no hex colours outside `packages/ui/src/styles/`, no Tailwind default greys, no `rounded-xl` or larger, no big shadows or gradients, no emoji in app code and catalogs, Phosphor icons only | CI |
| `pnpm check:arch` | `scripts/check-arch.mjs`: raw D1 access only inside `app/worker/db/`, the seed and tests; no test-route imports outside the route index; no AI attribution strings in source | CI |
| `pnpm check:i18n` | `scripts/check-i18n.mjs`: every `ns:key` used in code exists in the English catalog; missing Gujarati keys are warnings (set `I18N_STRICT_GU=1` to fail) | CI |
| `pnpm check` | lint, `check:ui`, `check:arch` and `check:i18n` together | CI |
| `pnpm test` | `pnpm -r run test` | CI |
| `pnpm test:unit` | Unit tests of `@fs/contracts`, `@fs/engine`, `@fs/i18n`, `@fs/ui` and `@fs/templates` | CI |
| `pnpm test:api` | Workers API tests (`app`, project `api`): the Worker runs in workerd with real D1 and R2 in Miniflare, migrations applied per test file | CI |
| `pnpm build` | `vite build` of `app` (client and Worker) | CI |
| `pnpm size` | `scripts/size-budgets.mjs`: staff initial JS 170 KB gzip, each owner route chunk 120 KB (map chunks excluded), CSS 25 KB | CI, after the build |
| `pnpm e2e` | Playwright (`e2e` package) | CI only |

`app/package.json` adds `dev` (`vite`), `preview`, `db:migrate:local` and `cf-typegen`; these are for a machine that can afford them, not the shared VM. Other scripts: `scripts/gen-secrets.mjs` (below) and `scripts/lib.mjs` (shared helpers).

## Secrets for tests and dev vars

`scripts/gen-secrets.mjs` has two modes. Neither prints a secret to the terminal in `--dev-vars` mode.

```sh
# Throwaway secrets for tests and local runs: writes app/.dev.vars (mode 600, git-ignored)
node scripts/gen-secrets.mjs --dev-vars app/.dev.vars --env local

# Real secrets for a deployment: prints `wrangler secret put` commands (see deploy.md)
node scripts/gen-secrets.mjs --wrangler [--preview]
```

`--dev-vars` writes `ENV`, `EMAIL_PROVIDER=outbox` (emails go to the test outbox instead of being sent), an empty `APP_ORIGIN`, and fresh values for `SESSION_SECRET`, `PIN_PEPPER`, `TIME_SIGNING_KEY`, `IP_HMAC_KEY`, `QR_MASTER_KEY`, `PUNCH_ENC_PRIVATE_JWK`, `VAPID_PRIVATE_JWK`, `SETUP_TOKEN` and `E2E_TOKEN`. Pass `--e2e-token <value>` to choose the test token. The `e2e` and `snapshots` workflows do this on every run with a random token that is masked in the logs. The Workers API tests generate their own secrets in `app/vitest.config.ts`.

Never commit `.dev.vars`, and never paste real secrets into chats, issues, PRs or logs.

## Email: what is sent where

- **Local, tests, previews** (`EMAIL_PROVIDER=outbox`, `ENV=preview`): nothing leaves the Worker. Sign-in links, codes and digests are written to the test outbox (`/__test/*` with the E2E token). On the demo preview the owner signs in with email and password plus the owner PIN ("Use password instead"), not a mailed link.
- **Production** (`EMAIL_PROVIDER=cloudflare`): the `EMAIL` `send_email` binding of Cloudflare Email Service sends from `staff@feelingsbeautycare.in`. The binding only allows that sender address (`allowed_sender_addresses` in `app/wrangler.jsonc`).
- **Verify the sending domain before go-live** (the client's own domain, or any other domain you switch to):
  1. Cloudflare dashboard, Compute, Email Service, Email Sending, Onboard Domain, pick the domain. Cloudflare adds SPF, DKIM and DMARC records on a `cf-bounce` sub-domain, so existing Email Routing MX records are untouched.
  2. Wait until the domain shows as verified. Until then sends fail.
  3. Change `EMAIL_FROM` and the binding's `allowed_sender_addresses` in `app/wrangler.jsonc` to an address on that domain, in a pull request.
  4. After the deploy, request a sign-in link for the owner email at `/auth/owner` and check it arrives (and is not in spam).
  5. Email Routing for the same domain (`wrangler email routing rules list feelingsbeautycare.in`) makes the addresses exist for receiving: `urmi@` (the owner's sign-in address) and `staff@` (the sender, so replies land somewhere) each have a forward rule to a verified destination address (Email Routing, Destination addresses; the owner of that inbox must click the confirmation mail). Change the `urmi@` rule to Urmi's own inbox once she has one verified: `wrangler email routing addresses create <inbox>` then `wrangler email routing rules` to update.
  6. Fallback if Email Sending misbehaves: set `EMAIL_PROVIDER=resend` and the `RESEND_API_KEY` secret; the owner can also use password and PIN.
  Full production steps: [deploy.md, Email](deploy.md#4-email).

## Mock mode

The SPA can run without a server, on the example responses in `packages/contracts/fixtures/`. It is meant for building screens before their endpoints exist and for stable visual baselines ([ADR-16](decisions/0016-mock-mode-on-localhost-for-visual-baselines.md)).

- It turns on only on `localhost` or `127.0.0.1` with `?mock=1` in the URL, or in a build made with `VITE_API_MODE=mock`. On any other host (including production and previews) the URL parameter does nothing.
- Pick the state of a screen per endpoint with `variant`:

```text
http://localhost:8787/?mock=1&variant=meToday:checked-in,ownerToday:holiday
```

  A variant `endpointKey:name` loads `packages/contracts/fixtures/<endpointKey>.<name>.json` (for example `meToday.checked-in.json`; other `meToday` variants are `ready`, `checked-out`, `on-break`, `on-leave`, `pending-proof` and `week-off`).
- The choice is kept in `sessionStorage` for the tab. Open a new tab, or clear it, to leave mock mode.
- The mock adds 120 ms of fake latency and is loaded only when used.
- Screens never call `fetch` directly. They use `useApi()`, so the same screen works against the real API and the mock.

Visual baselines use mock mode. Flow tests (sign in, check in, payroll) use the real API on a fresh database.

## Reading failures

```sh
gh run list --branch <branch> --limit 5            # find the run
gh run watch <run-id> --exit-status                # wait for it, non-zero exit if it fails
gh run view <run-id> --log-failed                  # only the failing steps
gh run view <run-id> --json jobs --jq '.jobs[] | {name, conclusion}'
gh run download <run-id> -n playwright-report      # report, traces, screenshots (e2e)
gh run download <run-id> -n coverage-and-size      # coverage and size report (ci)
gh run rerun <run-id> --failed                     # retry only the failed jobs
```

Where to look:

| Failing step | What it usually means |
|---|---|
| Typecheck | A schema or type changed; fix the call sites. `app` runs four tsconfigs, so read which one failed. |
| Lint (Biome) | Run Biome with `--write` on the files named in the log. |
| `check:ui`, `check:arch`, `check:i18n` | The message names the file, line and rule. |
| Unit tests | A contract change without its fixture or docs row. `api-docs.test.ts` says which endpoint is missing from [api.md](api.md). |
| Workers API tests | Read the failing test name; the tenant tests name the route that leaked. |
| Size budgets | The report lists chunk sizes; lazy-load or remove what grew. |
| `e2e` | Download `playwright-report`. Open `index.html` for traces, or read the diff images for visual failures. |

Open the downloaded `playwright-report/index.html` on a machine with spare CPU, or read the failure text in the log; do not start a browser on the shared VM.

## Visual baselines

Baselines live in `e2e/tests/__screenshots__/` at two sizes (390 by 844 and 1280 by 800), with a fixed clock (10:42 IST on 19 Oct 2026) and a maximum difference of 0.1%. They must be generated in the same Docker image CI uses, never on your machine.

```sh
gh workflow run snapshots -f ref=<branch> -f commit=true     # regenerate and push to the branch
gh run download <run-id> -n visual-baselines                 # or review them first
```

A push made by the workflow does not trigger `ci`, so push any small follow-up commit to re-run the checks. Review the images before you keep them.
