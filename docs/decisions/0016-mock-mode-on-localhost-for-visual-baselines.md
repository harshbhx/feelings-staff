# ADR-16. Mock mode on localhost for visual baselines

Status: accepted, 19 Oct 2026. Source: WP-1 (build-time decision).

## Context

Visual baselines must show the same pixels on every run. Real API data changes with time, ids and seeds, and a screen state such as "on break" is hard to reach through the real API. The UI packages also have to be built before the API exists.

## Decision

The SPA can run on fixtures instead of the network. `app/src/api/provider.tsx` picks `MockApiClient` when:

- the build sets `VITE_API_MODE=mock`, or
- the page runs on `localhost` or `127.0.0.1` and the URL has `?mock=1`. The choice is stored in `sessionStorage` (`fs.mock`) and sticks for the tab.

States are selected per endpoint with `&variant=<endpointKey>:<name>,...`, for example `?mock=1&variant=meToday:checked-in,ownerToday:holiday`. A variant name maps to a fixture file `packages/contracts/fixtures/<endpointKey>.<name>.json`. The mock client has 120 ms of simulated latency and is loaded lazily (`@fs/contracts/mock`), so it adds nothing to the initial bundle.

Visual baselines of screens use mock mode. Flow E2E tests use the real API and the `__test` routes.

## Consequences

- Stable, fast screenshots at 390 and 1280 pixels, and a way to reach every UI state.
- The host check means a production visitor cannot switch into mock mode: on any other host the mock is never used unless the build flag was set, and production builds do not set it.
- Every JSON endpoint needs a default fixture, and every fixture is validated against its schema in `packages/contracts/test/fixtures.test.ts`, so the mock cannot drift from the contract.
- The CSP had to drop `upgrade-insecure-requests` because WebKit applies it to `http://localhost`, which broke the iPhone project of the CI run. HSTS already forces HTTPS in production (see PRD Appendix C).
