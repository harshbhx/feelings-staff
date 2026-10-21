# Architecture

Feelings Staff is one Cloudflare Worker that serves the React app, the `/api/v1` API and the scheduled jobs, backed by D1 (database) and R2 (files). This page is the overview. The decisions behind it are in [`docs/decisions/`](decisions/README.md); the full requirements are in [`PRD.md`](PRD.md) (sections 13 to 16).

Contents: [System context](#system-context) · [A check-in, end to end](#a-check-in-end-to-end) · [Data model](#data-model) · [Packages and owners](#packages-and-owners) · [How the pieces connect](#how-the-pieces-connect) · [Environments](#environments) · [Decisions](#decisions)

## System context

Everyone talks to the same Worker over HTTPS with a cookie session. The Worker is the only thing that touches the database, the file store and the outside services.

```mermaid
flowchart TB
  staff["Staff phone<br/>installed app, service worker,<br/>device key and offline queue in IndexedDB"]
  owner["Owner phone or laptop<br/>owner panel at /o"]
  door["Door device<br/>kiosk at /door"]

  subgraph worker["Cloudflare Worker feelings-staff"]
    assets["Static assets<br/>Vite build"]
    api["Hono API /api/v1<br/>zod validation, services, org-scoped data layer"]
    cron["scheduled<br/>every 5 min and 03:00 IST"]
    engine["packages/engine<br/>pure rules"]
  end

  d1[("D1 fbc-staff")]
  r2[("R2 fbc-staff-media<br/>selfies, payslips, exports")]
  browser["Browser Run<br/>payslip PDF"]
  email["Email Service<br/>sign-in links"]
  push["Push services<br/>FCM, Apple, Mozilla"]
  wa["WhatsApp Cloud API<br/>P1, not built yet"]

  staff -->|HTTPS, same origin| worker
  owner -->|HTTPS, same origin| worker
  door -->|HTTPS, same origin| worker
  api --> engine
  cron --> engine
  worker --> d1
  worker --> r2
  worker --> browser
  worker --> email
  worker --> push
  worker -.-> wa
```

Static files are served from assets. `/api/*`, `/v/*`, `/q/*`, `/__kit`, `/assets/*`, `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest`, the split build folders `/_s/*` and `/_o/*` (always 404 under their own name) and the owner and staff page paths (`/o`, `/auth/owner`, `/signin`, `/join` and so on; the Worker passes them to the assets unchanged unless `OWNER_HOST` is set) (a missing hashed file is a real 404, never the shell) always reach the Worker code first (`run_worker_first`), everything else falls back to the single-page app ([ADR-01](decisions/0001-one-worker-for-assets-api-and-cron.md)).

What the Worker does on every `/api/*` request, in order:

1. Assign a request id and, on the way out, add the security headers (`app/worker/middleware/headers.ts`).
2. `guard`: CSRF (`Origin` and `X-FS-Client`), minimum app version, per-IP rate limit.
3. `context`: load the session and user, pick the organisation, build the org-scoped database (`OrgDb`), the services and the per-session rate limit.
4. The endpoint registered by `registerApi` ([ADR-15](decisions/0015-endpoint-table-drives-server-and-client.md)): access check, input parsing, step-up, idempotency, handler, response check.
5. Errors anywhere are turned into the standard error body ([API reference](api.md#error-shape-and-codes)).

## A check-in, end to end

PRD section 13.2 as a sequence. The check-in is a single `POST /punches`; everything that must commit together is one `DB.batch()`.

```mermaid
sequenceDiagram
  autonumber
  participant App as Staff app
  participant W as Worker
  participant D as D1
  participant R as R2
  participant P as Push services

  App->>W: POST /punch/nonce (while watchPosition runs)
  W->>D: store nonce (challenges)
  W-->>App: nonce and signed server time
  Note over App: build PunchRequest, sign canonical JSON with the device key
  App->>W: POST /punches (multipart, Idempotency-Key, optional selfie)
  W->>W: CSRF and version, session, rate limit, zod
  W->>D: load device (approved, same user)
  W->>W: verify signature, consume nonce, verify PIN
  W->>R: put selfie (if sent, hash checked)
  W->>W: fenceCheck, riskScore (packages/engine)
  W->>D: batch: punch, computeDay, attendance_days, notification rows, audit
  W-->>App: PunchResult
  W--)P: waitUntil: owner push if flagged, late or pending
```

Steps 3 and 4 of PRD 13.2 in plain words:

- A request that fails a check stops there. A wrong PIN, an unapproved device or an approximate location stores nothing except a security audit row.
- The time that counts is the server time of the first submission. If the punch ends up pending (needs proof or approval) it keeps that time.
- A repeat of the same `Idempotency-Key` returns the first answer, so a double tap or a retry never records two punches.
- Offline punches are queued on the phone with a signed time anchor and an encrypted PIN, and sent later through the same endpoint (PRD 4.3.6).

## Data model

The main tables and how they relate. The complete list, conventions and retention are in the [data model](data-model.md). Every table except `orgs` and `app_meta` carries `org_id`; it is left out of the diagram for clarity.

```mermaid
erDiagram
  orgs ||--o{ users : has
  users ||--o| staff_profiles : "staff only"
  users ||--o{ salary_history : "pay over time"
  users ||--o{ devices : owns
  users ||--o{ sessions : signs_in
  users ||--o{ invites : "joins with"
  orgs ||--o{ sites : has
  sites ||--o{ door_devices : "paired to"
  sites ||--o{ offsite_duties : "venue of"
  offsite_duties ||--o{ offsite_duty_staff : assigns
  users ||--o{ punches : makes
  sites ||--o{ punches : "checked at"
  offsite_duties ||--o{ punches : "during"
  users ||--o{ attendance_days : "one per day"
  users ||--o{ regularisations : "asks to fix"
  users ||--o{ leave_requests : asks
  leave_types ||--o{ leave_ledger : "balance of"
  users ||--o{ advances : receives
  advances ||--o{ advance_recoveries : "recovered by"
  payroll_runs ||--o{ payslips : contains
  users ||--o{ payslips : gets
  payroll_runs ||--o{ adjustments : has
  users ||--o{ notifications : receives
  users ||--o{ push_subscriptions : has
  users ||--o{ consents : gives
  orgs ||--o{ audit_log : records

  users {
    text id PK
    text role "owner, manager, staff"
    text status "invited, active, suspended, exited"
    text phone_e164
  }
  devices {
    text id PK
    text status "pending, approved, rejected, revoked"
    text public_jwk
  }
  punches {
    text id PK
    text kind "in, out, break_start, break_end"
    int server_ts
    text work_date
    text fence_result
    int risk_score
    text status "accepted, flagged, pending, rejected, superseded"
  }
  attendance_days {
    text user_id FK
    text work_date
    int locked
  }
  payroll_runs {
    text id PK
    text month
    int revision
    text status "draft, finalised, superseded"
  }
  payslips {
    text id PK
    int net_paise
    text verify_token
  }
```

Platform tables added after the first migration (`migrations/0002_platform.sql`): `idempotency_keys` and `test_outbox`.

Conventions that matter when you read the code: ids are ULIDs, instants are epoch milliseconds, dates are `YYYY-MM-DD`, money is integer paise, and the audit log is append-only.

## Packages and owners

```mermaid
flowchart LR
  contracts["packages/contracts<br/>schemas, endpoint table,<br/>ApiClient, fixtures, mock<br/>WP-1"]
  engine["packages/engine<br/>schedule, day, pay, leave, money (WP-5)<br/>fence, risk (WP-4)"]
  ui["packages/ui<br/>tokens, components, kit<br/>WP-2"]
  i18n["packages/i18n<br/>en, gu catalogs<br/>WP-7 plus one file per area"]
  templates["packages/templates<br/>payslip and report HTML<br/>WP-5"]
  app["app<br/>SPA and Worker"]
  e2e["e2e<br/>Playwright, axe, visual"]
  migrations["migrations<br/>D1 schema"]

  contracts --> engine
  contracts --> app
  contracts --> e2e
  engine --> app
  ui --> app
  i18n --> app
  i18n --> ui
  templates --> app
  migrations -.-> app
  app --> e2e
```

Who owns what is the table in [CONTRIBUTING.md](../CONTRIBUTING.md#who-owns-what). In short:

| Package | Owner | What it holds |
|---|---|---|
| WP-1 platform | lead | Root configs, Worker entry, middleware, data layer, seed, ports, `packages/contracts`, `migrations/`, the E2E harness, `scripts/`, `.github/` |
| WP-2 design system | | `packages/ui`, styles, the kit page |
| WP-3 auth | | Sign-in, devices, staff accounts, invites, step-up |
| WP-4 attendance | | Punches, fence, risk, door QR, off-site duties, leave and fixes, owner Today and Needs action |
| WP-5 engine and payroll | | Pay rules, payroll runs, payslips, PDFs, exports, advances |
| WP-6 owner panel | | Owner screens and the public pages |
| WP-7 staff app and PWA | | Staff screens, service worker, offline queue, most i18n catalogs |
| WP-8 notifications and jobs | | Push, email, WhatsApp, the two cron jobs, inbox |

## How the pieces connect

- **One endpoint table.** `packages/contracts/src/endpoints.ts` is the API. The server registers it, the client and mock are built from it, and `docs/api.md` mirrors it ([ADR-15](decisions/0015-endpoint-table-drives-server-and-client.md)).
- **Ports.** `app/worker/services/ports.ts` defines the services a handler may use: `Clock`, `Audit`, `Notifier`, `StepUp`, `DayService`, `PayrollService`, `PdfRenderer`, `PushSender`, `EmailSender`, `MapsResolver` and `Outbox`. `services/registry.ts` wires the real ones. Tests replace them with fakes from `app/worker/test/fakes/`.
- **Data access.** Handlers use `ctx.db` (`OrgDb`, adds `org_id` to every statement) and, only before sign-in, `ctx.sys` (`SystemDb`). `scripts/check-arch.mjs` enforces this.
- **Pure rules.** `packages/engine` has no I/O. It computes a day (`computeDay`), a payslip, the fence result and the risk score from plain data, so it is tested with tables of cases.
- **Client.** Screens call `useApi()` and TanStack Query. The provider picks the real client or, on localhost with `?mock=1`, the mock ([ADR-16](decisions/0016-mock-mode-on-localhost-for-visual-baselines.md)). Copy comes from `packages/i18n` namespaces (`common`, `staff`, `owner`, `errors`, `notify`, `payslip`, `auth`, `door`, `ui`).
- **Test routes.** `/api/v1/__test/*` (reset a scenario, set the clock, run a cron job, read the outbox) exist only outside production and need the `X-E2E-Token` header.

## Environments

| Environment | Where | Database and files | Crons |
|---|---|---|---|
| CI and local | `wrangler dev` or `vite preview` on `localhost:8787`, inside GitHub Actions | Local D1 (Miniflare) | Run by hand with `/__test/cron` |
| Preview (per PR) | The Worker Preview URL the `preview` workflow posts on the PR | `fbc-staff-preview` and `fbc-staff-media-preview`, shared by all previews | Do not run |
| Production | `https://staff.feelingsbeautycare.in` | `fbc-staff` and `fbc-staff-media` | Run |

Setup steps are in [setup.md](setup.md), going live in [deploy.md](deploy.md).

## Decisions

| ADR | Decision |
|---|---|
| [01](decisions/0001-one-worker-for-assets-api-and-cron.md) | One Worker for assets, API and cron |
| [02](decisions/0002-react-and-vite-single-page-app-not-astro.md) | React and Vite single-page app, not Astro |
| [03](decisions/0003-tailwind-v4-with-a-locked-theme.md) | Tailwind v4 with a locked theme |
| [04](decisions/0004-d1-with-application-level-tenancy.md) | D1 with application-level tenancy |
| [05](decisions/0005-staff-sign-in-with-a-pin-and-a-device-bound-key-no-sms-otp.md) | Staff sign-in with a PIN and a device-bound key, no SMS OTP |
| [06](decisions/0006-server-time-ist-work-dates-integer-paise-and-exact-fractions.md) | Server time, IST work dates, integer paise and exact fractions |
| [07](decisions/0007-pdfs-through-browser-run-from-html-templates.md) | PDFs through Browser Run from HTML templates |
| [08](decisions/0008-web-push-with-pushforge-builder-behind-an-interface.md) | Web Push with `@pushforge/builder` behind an interface |
| [09](decisions/0009-email-through-cloudflare-email-service.md) | Email through Cloudflare Email Service |
| [10](decisions/0010-two-crons-and-an-idempotency-table-no-queues-in-v1.md) | Two crons and an idempotency table, no Queues in v1 |
| [11](decisions/0011-selfie-is-optional-and-there-are-no-biometrics.md) | Selfie is optional and there are no biometrics |
| [12](decisions/0012-contracts-first-in-a-pnpm-monorepo.md) | Contracts first, in a pnpm monorepo |
| [13](decisions/0013-polling-for-the-live-board.md) | Polling for the live board |
| [14](decisions/0014-leaflet-and-openstreetmap-loaded-lazily.md) | Leaflet and OpenStreetMap, loaded lazily |
| [15](decisions/0015-endpoint-table-drives-server-and-client.md) | Endpoint table drives server and client |
| [16](decisions/0016-mock-mode-on-localhost-for-visual-baselines.md) | Mock mode on localhost for visual baselines |
