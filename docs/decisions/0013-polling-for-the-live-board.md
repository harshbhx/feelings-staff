# ADR-13. Polling for the live board

Status: accepted, 19 Oct 2026. Source: PRD 13.5.

## Context

The owner's Today board must feel live, but there is one owner and a few phones.

## Decision

The board polls `GET /owner/today` every 30 seconds while the screen is visible, and refetches when a push arrives. Durable Objects with WebSockets are a P2 option if more salons use the app.

## Consequences

- No long-lived connections and nothing extra to run or pay for.
- Up to 30 seconds of delay when no push arrives, which is acceptable for this use.
