# Feelings Staff

Staff attendance and payroll app (installable PWA) for Feelings Beauty Care, Jamnagar.

- Staff check in and out from their own phone inside the salon geofence (or at a wedding venue the owner sets up), request leave and fixes, and get their payslips.
- The owner sees who is in, who is late and who has not arrived, approves requests in one place, and runs payroll at the end of the month with a payslip per person.

It runs on one Cloudflare Worker (static assets, `/api/v1`, scheduled jobs) with D1 and R2.

## Documents

- [`docs/PRD.md`](docs/PRD.md): the product requirements. Everything we build traces back to it.
- [`docs/research/brand-and-stack.md`](docs/research/brand-and-stack.md): brand tokens, stack and hosting of the salon's website.
- [`docs/research/domain.md`](docs/research/domain.md): competitors, geofencing, web push, PWA, Indian payroll law, DPDP.

## Working rules

- Every change goes through a pull request with green checks. Conventional commits (`feat(punch): …`).
- Builds, tests, browsers and screenshots run in GitHub Actions.
- Contracts in `packages/contracts` are frozen per version; changes need a PR labelled `contract-change`.
