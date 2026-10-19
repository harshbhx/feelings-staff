# ADR-08. Web Push with @pushforge/builder behind an interface

Status: accepted, 19 Oct 2026. Source: PRD 6, 13.5.

## Context

The classic `web-push` package fails on Workers because it relies on Node crypto. Push is the main way the owner hears about late staff and approvals.

## Decision

Use `@pushforge/builder` (Web Crypto, no dependencies), pinned to one version and wrapped in the `PushSender` port (`app/worker/services/ports.ts`). Payloads use the Declarative Web Push shape, and the service worker always shows a notification inside `event.waitUntil` (Safari drops subscriptions after silent pushes). `web-push-neo` is the named alternative.

## Consequences

- Swapping the library touches one adapter.
- 404 and 410 answers delete the subscription at once.
- Tests use a fake `PushSender` and the preview outbox instead of real push services.
