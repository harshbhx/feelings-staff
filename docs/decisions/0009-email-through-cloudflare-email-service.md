# ADR-09. Email through Cloudflare Email Service

Status: accepted, 19 Oct 2026. Source: PRD 13.5, 15.4.

## Context

Owner sign-in links and codes need email. The salon's domain is already on Cloudflare with Email Routing.

## Decision

Use the `send_email` binding (Email Sending, beta, Workers Paid, 3,000 emails a month included) with `feelingsbeautycare.in` onboarded in the same account. Wrap it in the `EmailSender` port. `EMAIL_PROVIDER` selects `cloudflare`, `resend` (fallback adapter) or `outbox` (previews and local: the message is stored in `test_outbox` and read through `GET /__test/outbox`). The owner also has a password and PIN sign-in, so email is never the only door.

## Consequences

- No extra vendor or cost.
- Email Sending is in beta; the Resend adapter is the escape hatch (`RESEND_API_KEY`).
- Previews never send real mail.
