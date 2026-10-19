# ADR-12. Contracts first, in a pnpm monorepo

Status: accepted, 19 Oct 2026. Source: PRD 16.1, 13.5.

## Context

Eight work packages are built in parallel. They only fit together if everyone agrees on the data shapes before writing code.

## Decision

Use pnpm workspaces. `packages/contracts` (zod schemas, types, error codes, the endpoint table, the `ApiClient` interface, fixtures and the mock) is written first and frozen at `contracts-v1`. The server, the client and the tests import the same schemas. After the freeze, a change needs a PR labelled `contract-change` that updates both sides and is reviewed by the lead.

## Consequences

- Packages can build against the mock before the API exists.
- A schema change is visible in one place and in one review.
- The ownership table in [CONTRIBUTING](../../CONTRIBUTING.md) says who owns which paths.
