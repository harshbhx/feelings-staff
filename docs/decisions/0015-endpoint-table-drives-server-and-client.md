# ADR-15. Endpoint table drives server and client

Status: accepted, 19 Oct 2026. Source: WP-1 (build-time decision).

## Context

Parallel packages need one agreed API, and each endpoint has many rules: who may call it, step-up, idempotency, validation, status codes. Written by hand in three places (server routes, client, mock), they drift apart.

## Decision

The API is one table, `endpoints` in `packages/contracts/src/endpoints.ts`. Each row is built with `ep({...})` and holds the method, path, `access` (`public`, `self`, `owner`, `manager`, `door`, `test`), the manager permission `perm`, `stepUp`, `idempotent`, `multipart`, `binary`, the success `status`, zod schemas for `params`, `query`, `body` and `res`, and a one-line `summary`.

Everything else is derived from the table:

- **Server.** `registerApi` (`app/worker/lib/api.ts`) loops over the table and registers each row on the Hono app. For every request it checks access, parses input with the row's schemas, enforces step-up, replays idempotent requests from `idempotency_keys`, calls the handler, validates the response against `res` outside production, and sends it. A row without a handler answers `NOT_IMPLEMENTED` (501). Route modules only export `Handlers` (a map from endpoint key to function); they never register routes, and `mergeHandlers` throws if a key is implemented twice.
- **Client.** The `ApiClient` type has one method per key, with input and output types inferred from the row. `HttpApiClient` (`app/src/api/http-client.ts`) and `MockApiClient` implement it.
- **Docs and tests.** `docs/api.md` mirrors the table and `packages/contracts/test/api-docs.test.ts` fails when a row is missing. Other tests check that every method and path is unique, that `params` exist exactly when the path has `:params`, and that every JSON endpoint has a fixture that matches its schema.

## Consequences

- Adding or changing an endpoint is one edit to the table, and every consumer sees it at once. After `contracts-v1` it needs a `contract-change` PR.
- A package that has not landed yet cannot break the others: its rows answer 501 and its fixtures keep the UI working.
- Response validation outside production catches handlers that drift from their schema before they reach users; it is off in production to save CPU.
- Nobody can add a route that skips the access check, because routes are not registered anywhere else.
- Special cases (multipart, binary, 202 while generating) are flags on the row, not one-off code.
