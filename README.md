# Feelings Staff

[![ci](https://github.com/harshbhx/feelings-staff/actions/workflows/ci.yml/badge.svg)](https://github.com/harshbhx/feelings-staff/actions/workflows/ci.yml)
[![e2e](https://github.com/harshbhx/feelings-staff/actions/workflows/e2e.yml/badge.svg)](https://github.com/harshbhx/feelings-staff/actions/workflows/e2e.yml)
[![deploy](https://github.com/harshbhx/feelings-staff/actions/workflows/deploy.yml/badge.svg)](https://github.com/harshbhx/feelings-staff/actions/workflows/deploy.yml)
[![nightly](https://github.com/harshbhx/feelings-staff/actions/workflows/nightly.yml/badge.svg)](https://github.com/harshbhx/feelings-staff/actions/workflows/nightly.yml)

Staff attendance and payroll app (an installable PWA) for Feelings Beauty Care, Jamnagar.

## What it is and who it is for

- **Staff** check in and out from their own phone inside the salon geofence (or at a wedding venue the owner sets up), ask for leave and fixes, and get their payslips.
- **The owner (Urmi)** sees who is in, who is late and who has not arrived, approves requests in one place, and runs payroll at month end with a payslip per person.
- **Harsh** builds and runs it. It is one salon, up to 15 active staff, in English now and Gujarati next.

The app never tracks anyone: location is read only when someone taps Check in or Check out.

## Stack

One Cloudflare Worker serves the React SPA, the Hono API at `/api/v1` and the cron jobs, with D1 and R2, built with Vite, TypeScript, Tailwind v4 and pnpm workspaces.

## Documents

| Document | What is in it |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements. Everything we build traces back to it. |
| [`docs/architecture.md`](docs/architecture.md) | Overview with diagrams, package map and owners |
| [`docs/decisions/`](docs/decisions/README.md) | Architecture decision records, ADR-01 to ADR-16 |
| [`docs/setup.md`](docs/setup.md) | Setup, workflows, scripts, mock mode, reading CI failures |
| [`docs/deploy.md`](docs/deploy.md) | Go-live, rollback and the preview environment |
| [`docs/api.md`](docs/api.md) | API reference, errors and conventions |
| [`docs/data-model.md`](docs/data-model.md) | Tables, retention, R2 layout, migrations |
| [`docs/runbooks/incident.md`](docs/runbooks/incident.md) | When something is wrong |
| [`docs/runbooks/backup-restore.md`](docs/runbooks/backup-restore.md) | Backups and restores |
| [`docs/runbooks/retention-purge.md`](docs/runbooks/retention-purge.md) | What is deleted and when; purge on request |
| [`docs/runbooks/secrets.md`](docs/runbooks/secrets.md) | Rotating each secret |
| [`docs/ops-log.md`](docs/ops-log.md) | Log of manual production actions |
| [`docs/guides/owner.md`](docs/guides/owner.md) | Guide for the owner |
| [`docs/guides/staff.md`](docs/guides/staff.md) | Guide for staff |
| [`docs/research/brand-and-stack.md`](docs/research/brand-and-stack.md) | Brand tokens, stack and hosting of the salon's website |
| [`docs/research/domain.md`](docs/research/domain.md) | Competitors, geofencing, web push, PWA, Indian payroll law, DPDP |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Rules, ownership, how the pieces connect |
| [`SECURITY.md`](SECURITY.md) | Reporting a problem; what the app protects |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed |

## Screenshots

The lead adds images here at the end.

<!-- screenshot: readme-staff-today -->
<!-- screenshot: readme-owner-today -->
<!-- screenshot: readme-owner-register -->
<!-- screenshot: readme-payslip -->

## Working rules

- Every change goes through a pull request with green checks. Conventional commits (`feat(punch): ...`).
- Builds, tests, browsers and screenshots run in GitHub Actions, never on the shared VM. See [`docs/setup.md`](docs/setup.md).
- Contracts in `packages/contracts` are frozen per version; changes need a PR labelled `contract-change`.
