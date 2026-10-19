# ADR-03. Tailwind v4 with a locked theme

Status: accepted, 19 Oct 2026. Source: PRD 13.5, 12.

## Context

Several people and agents build screens in parallel. Tailwind is fast and composes well with Radix primitives, but its default palette and scales push every app towards the same generic look. The brief was a non-generic UI in the Feelings Beauty Care colours.

## Decision

Use Tailwind v4 with every default scale cleared and replaced by the brand tokens (`docs/research/brand-and-stack.md` section 6.3). There is no default palette to reach for. `scripts/check-ui.mjs` runs in `ci` and fails on hex colours outside `packages/ui/src/styles/`, Tailwind default greys, `rounded-xl` and larger, big shadows, gradients, emoji in the app, and icon sets other than Phosphor.

## Consequences

- Speed for parallel builders, and Radix for accessible behaviour.
- The risk is a generic look. The mitigations are the missing default palette, the CI check, and the review checklist in PRD 12.11.
- Anything that needs a new colour or radius changes the tokens in `packages/ui`, which WP-2 owns.
