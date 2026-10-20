# Architecture decisions

One short record per decision: what was going on, what we chose, what follows from it. ADR-01 to ADR-14 come from PRD section 13.5. ADR-15 and ADR-16 record what WP-1 built. ADR-17 and ADR-18 record the Time credits and presence decisions of WP-9 (PRD 4.18, 4.19, 7.17, 7.18). The overview and diagrams are in [architecture.md](../architecture.md).

| ADR | Decision |
|---|---|
| [ADR-01](0001-one-worker-for-assets-api-and-cron.md) | One Worker for assets, API and cron |
| [ADR-02](0002-react-and-vite-single-page-app-not-astro.md) | React and Vite single-page app, not Astro |
| [ADR-03](0003-tailwind-v4-with-a-locked-theme.md) | Tailwind v4 with a locked theme |
| [ADR-04](0004-d1-with-application-level-tenancy.md) | D1 with application-level tenancy |
| [ADR-05](0005-staff-sign-in-with-a-pin-and-a-device-bound-key-no-sms-otp.md) | Staff sign-in with a PIN and a device-bound key, no SMS OTP |
| [ADR-06](0006-server-time-ist-work-dates-integer-paise-and-exact-fractions.md) | Server time, IST work dates, integer paise and exact fractions |
| [ADR-07](0007-pdfs-through-browser-run-from-html-templates.md) | PDFs through Browser Run from HTML templates |
| [ADR-08](0008-web-push-with-pushforge-builder-behind-an-interface.md) | Web Push with @pushforge/builder behind an interface |
| [ADR-09](0009-email-through-cloudflare-email-service.md) | Email through Cloudflare Email Service |
| [ADR-10](0010-two-crons-and-an-idempotency-table-no-queues-in-v1.md) | Two crons and an idempotency table, no Queues in v1 |
| [ADR-11](0011-selfie-is-optional-and-there-are-no-biometrics.md) | Selfie is optional and there are no biometrics |
| [ADR-12](0012-contracts-first-in-a-pnpm-monorepo.md) | Contracts first, in a pnpm monorepo |
| [ADR-13](0013-polling-for-the-live-board.md) | Polling for the live board |
| [ADR-14](0014-leaflet-and-openstreetmap-loaded-lazily.md) | Leaflet and OpenStreetMap, loaded lazily |
| [ADR-15](0015-endpoint-table-drives-server-and-client.md) | Endpoint table drives server and client |
| [ADR-16](0016-mock-mode-on-localhost-for-visual-baselines.md) | Mock mode on localhost for visual baselines |
| [ADR-17](0017-time-credits-an-owner-settled-minute-ledger-instead-of-automatic-late-and-overtime-pay.md) | Time credits: an owner-settled minute ledger instead of automatic late and overtime pay |
| [ADR-18](0018-presence-by-roll-call-and-step-out-not-background-location.md) | Presence by roll-call and step-out, not background location |

To add a decision, copy the newest file, use the next number, and add a row above. Do not edit an accepted record to change history; write a new one that supersedes it and mark the old one "superseded by ADR-NN".
