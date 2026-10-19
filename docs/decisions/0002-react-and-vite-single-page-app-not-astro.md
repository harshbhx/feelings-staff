# ADR-02. React and Vite single-page app, not Astro

Status: accepted, 19 Oct 2026. Source: PRD 13.5, 11.

## Context

The salon's website is Astro with plain CSS. This app is stateful: a punch state machine, an offline queue, a register grid and payroll editing. It also needs a service worker with precise control over caching, push and updates.

## Decision

Build the client as a React 19 single-page app with Vite, React Router 7 in library mode, TanStack Query for server state, and `vite-plugin-pwa` (injectManifest, Workbox) for the service worker. `@cloudflare/vite-plugin` builds the client and the Worker in one project (`app/`).

## Consequences

- The brand is carried by copying the token file unchanged and by the component rules in PRD section 12, not by sharing Astro components.
- The client bundle has budgets (staff initial JS 170 KB gzip, each owner route chunk 120 KB, CSS 25 KB) enforced by `scripts/size-budgets.mjs` in `ci`.
- Screens never call `fetch` directly; they use `useApi()` ([ADR-15](0015-endpoint-table-drives-server-and-client.md)).
