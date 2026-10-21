# Changelog

All notable changes to Feelings Staff are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has not been released yet; production deploys are tagged `vYYYY.MM.DD-N` by the `deploy` workflow, and the first tagged deploy will turn "Unreleased" into a dated section.

Each work package adds its own lines under **Unreleased** in the PR that lands it, in the group that fits (Added, Changed, Fixed, Security, Removed). Write what a person would notice, not the file list.

## [Unreleased]

### Changed

- Register on a phone is a person-first list: one row per person with the last seven days as 36 px cells and the full name on one line; a "Month grid" toggle keeps the table (96 px name column, 40 px cells). Late days show the minutes (`+28`, `+1h`) on the late tint and cells drop the icon. On desktop the Register has a panel for the selected day (status, punches, source, note, Fix this day), the summary is one line and the key opens from a popover.

### Added

- Owner host Cloudflare Access check (owner access slice 2): when `OWNER_HOST` and `ACCESS_AUD` are both set, every owner-host request must carry a valid Cloudflare Access token (RS256, audience, issuer, expiry and an allowed e-mail) or answers 403 with an empty body. New optional variables `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_ALLOWED_EMAILS`. Off, and no change anywhere, while either is unset.
- Setup and the demo seed now propose Gujarat public holidays for 2027 as well as 2026. The 2027 list has no lunar festivals (Holi, Janmashtami, Dussehra, Diwali): add them in Settings, Holidays.

Docs for Time credits and presence (WP-9):

- Owner guide sections on Time credits, the Credits screen, settling at payroll, legal overtime at 2x, roll-call and step-outs; staff guide section on Step out and I'm back and the payslip Time adjustment line; data model for migration 0003 with retention; ADR-17 and ADR-18.

WP-1, platform, contracts and CI (merged):

- Monorepo with pnpm workspaces: `app` (React SPA and Worker in one Vite project), `packages/contracts`, `engine`, `i18n`, `templates`, `ui`, and `e2e`.
- `packages/contracts` at `contracts-v1`: zod schemas, error codes, the endpoint table (143 endpoints), the `ApiClient` interface, fixtures with UI-state variants for every JSON endpoint, and `MockApiClient`.
- Worker skeleton: one Hono app under `/api/v1` that registers every endpoint from the table, with access checks, input validation, step-up, idempotency, response validation outside production and `501 NOT_IMPLEMENTED` for endpoints not built yet. Middleware for CSRF, minimum app version, rate limits, sessions, errors and security headers.
- Org-scoped data layer (`OrgDb`, `SystemDb`) and an architecture check that blocks raw database access elsewhere.
- Service ports (`Clock`, `Audit`, `Notifier`, `StepUp`, `DayService`, `PayrollService`, `PdfRenderer`, `PushSender`, `EmailSender`, `MapsResolver`, `Outbox`) with fakes for tests.
- Test routes under `/api/v1/__test/*` (reset a seeded scenario, fake clock, run a cron job, read the outbox), outside production only.
- Migrations: `0001_init.sql` (the PRD 8.2 schema) and `0002_platform.sql` (`idempotency_keys` and the preview `test_outbox`).
- SPA shell: router with role-based homes, route guards, i18n setup with the `common`, `staff`, `owner`, `errors`, `notify`, `payslip`, `auth`, `door` and `ui` namespaces, `ApiProvider`, and mock mode on localhost (`?mock=1&variant=...`).
- Workflows: `ci`, `e2e` (Playwright with axe and visual checks, on ready or `e2e`-labelled PRs), `snapshots`, `preview`, `deploy` and `nightly`.
- Scripts: `check-ui`, `check-arch`, `check-i18n`, `size-budgets` and `gen-secrets` (`--dev-vars` and `--wrangler`).
- Playwright harness with fixtures (`reset`, `setServerClock`, `runCron`, `outbox`, `setGeo`, `checkA11y`), a fake camera and four projects.
- Active staff are capped at 15 (`MAX_ACTIVE_STAFF`).
- `Fix.accuracySpreadM` in the engine contract.

WP-9 Time credits and presence, contracts (`contracts-v1.2`):

- Engine types for the minute ledger and presence (`CreditRules`, `CreditEntry`, `CreditAdjustment`, `CreditSettlement`, `MinuteRate`, `AwayInterval`, `PresenceRules` and friends), the `time_credits` payslip line, `TimeRules.credits`.
- Settings `timeCredits` and `presence` (changing their `enabled` flag needs step-up), the `rollcall` manager permission, the `presence_checks` consent, the `credits_ledger` and `presence_log` export kinds.
- 20 endpoints: owner credits, adjustments, settle step, roll-calls, away intervals; staff Step out, I'm back, foreground check and presence history. The `away` Needs-action item, `TodayBoard.rollCall` and notification events N32 to N36.
- Extra endpoints on top of PRD 9.4: join lookup, leave preview, owner security, setup checklist, payroll preview, door device list, consents, bulk approve, staff photo, staff rehire and device revoke.

WP-9 Time credits, engine:

- The minute ledger in `@fs/engine`: entries for a day (late and early from the first minute, confirmed away time, approved overtime), the balance with carry-over, the 1x money value with one rounding, the settlement inside the 50% cap, and 9 h a day / 48 h a week warnings.
- With Time credits on, a day owes nothing (no grace, tolerance, make-up or undertime; over-break is only tagged) and the payslip pays no overtime for it; the owner's settlement becomes one `time_credits` line. With it off, payslips are unchanged.
- Legal overtime at 2x (setting on by default): approved overtime beyond 9 h a day or 48 h a week (`legalOtBand`) adds an `ot_legal` entry, so it counts twice in the balance and the settlement; the payroll preview tells the owner, or warns when the setting is off.
- Presence in `@fs/engine`: away intervals from roll-call marks and step-outs (start, end at I'm back, the next Here, check-out or shift end, merge, clipping to the shift, presence and break, the 5-minute floor) and the "seems away" hint from foreground checks.

WP-6, owner panel:

- Owner shell, Today, Needs action, Register with day detail, and Staff (list, add and invite, profile) on phone and desktop, with loading, empty, error and offline states.
- Owner actions that need the owner PIN use the shared step-up sheet from sign-in.
- A screen whose server part isn't built yet says so in plain words instead of a general error, and is not retried.
- Roster week plan with week-off swaps and the 48 h warning, the off-site duty form (current location, map pick or Google Maps link), Show door code, the More menu, and the public payslip check page.

Docs:

- Handbook: [architecture](docs/architecture.md) with diagrams, [decision records](docs/decisions/README.md) ADR-01 to ADR-16, [setup](docs/setup.md), [deploy and go-live](docs/deploy.md), [API reference](docs/api.md) with a test that fails when an endpoint is missing from it, [data model](docs/data-model.md), runbooks for [incidents](docs/runbooks/incident.md), [backup and restore](docs/runbooks/backup-restore.md), [retention purge](docs/runbooks/retention-purge.md) and [secrets](docs/runbooks/secrets.md), an [ops log](docs/ops-log.md), and guides for the [owner](docs/guides/owner.md) and [staff](docs/guides/staff.md).
- `SECURITY.md`, this changelog, and a rewritten README.

WP-9 Time credits and presence, WP-10 polish, merged first (PR links: https://github.com/harshbhx/feelings-staff/pull/43, https://github.com/harshbhx/feelings-staff/pull/46, https://github.com/harshbhx/feelings-staff/pull/48, https://github.com/harshbhx/feelings-staff/pull/49, https://github.com/harshbhx/feelings-staff/pull/50, https://github.com/harshbhx/feelings-staff/pull/51, https://github.com/harshbhx/feelings-staff/pull/52, https://github.com/harshbhx/feelings-staff/pull/47, https://github.com/harshbhx/feelings-staff/pull/55):

- PRD 1.3 for Time credits and presence checks, with legal overtime at 2x (setting **Pay legal overtime at 2x**, on by default) and examples 14 and 15 on the month's own daily rate.
- Contracts, engine ledger and presence away intervals (see the two WP-9 groups above).
- Migration `0003_time_credits_presence.sql` and the owner credits API: ledger, adjustments, settle step, CSV.
- UI kit uplift: intents, stat chips, progress strip, card and rail.

Also merged since (all with `ci` and `e2e` green on main):

- Legal overtime 2x in the credits API: https://github.com/harshbhx/feelings-staff/pull/54 (day recompute writes `ot_legal`, later days of the ISO week refreshed, payroll notice and shortfall warning).
- Presence API: https://github.com/harshbhx/feelings-staff/pull/61 (roll-calls, Step out, I'm back, away intervals, foreground check, the `rules` job reminders). Roll-call view returns each person's saved mark (contract change): https://github.com/harshbhx/feelings-staff/pull/66. Fixture variants for the presence screens: https://github.com/harshbhx/feelings-staff/pull/62.
- Owner Time credits screens (Credits, person ledger, settle step, settings): https://github.com/harshbhx/feelings-staff/pull/57. Owner roll-call, away items in Needs action and presence settings: https://github.com/harshbhx/feelings-staff/pull/63.
- Staff Step out, I'm back, the marked-away card and the presence notice: https://github.com/harshbhx/feelings-staff/pull/65. Staff leave and fix forms, payslips (with the **Time adjustment** line), Me, My data and Privacy: https://github.com/harshbhx/feelings-staff/pull/64.
- Staff shift timeline, hero Check in and success check: https://github.com/harshbhx/feelings-staff/pull/58. Owner Today stat chips, register summary grid and rail icons: https://github.com/harshbhx/feelings-staff/pull/53.
- Staff initial JS under the 170 KB gzip budget (lazy inbox screen, toast layer and icon paths): https://github.com/harshbhx/feelings-staff/pull/56.
- Docs: Time credits and presence guides, data model for 0003, ADR-17 and ADR-18: https://github.com/harshbhx/feelings-staff/pull/59; PRD `total_min` in migration 0003 and payslip wording for an earning: https://github.com/harshbhx/feelings-staff/pull/60; PRD examples 14 and 15: https://github.com/harshbhx/feelings-staff/pull/55.
- India (Gujarat) holiday suggestions for 2026 and 2027 in setup and the demo seed: https://github.com/harshbhx/feelings-staff/pull/68. The seed starts Time credits on its first day: https://github.com/harshbhx/feelings-staff/pull/73.
- WhatsApp escalation, the weekly digest (Mondays from 09:00) and payroll emails: https://github.com/harshbhx/feelings-staff/pull/69.
- Cross-flow end-to-end suites (E2E-02, 04, 12, 13, 14, 16): https://github.com/harshbhx/feelings-staff/pull/71.
- Stale lazy chunks after a redeploy: a phone with an old app shell now asks the server first and, if a file is missing, drops its saved copy and reloads once by itself: https://github.com/harshbhx/feelings-staff/pull/74.
- Docs: email per environment and how to verify a sending domain: https://github.com/harshbhx/feelings-staff/pull/75.
- Review follow-ups: presence, requests, Me and icons on the staff side https://github.com/harshbhx/feelings-staff/pull/76; presence, roll-call, escalation and seed in the Worker https://github.com/harshbhx/feelings-staff/pull/77; roll-call, presence settings and credits on the owner side https://github.com/harshbhx/feelings-staff/pull/78.

### Changed

- Settings groups its sections under four headings (The salon, People and pay, Attendance, Account and safety). Setup leads with the next step as one card and folds finished steps into one line such as "7 of 8 done"; the "Done" pills are gone.
- The Content Security Policy no longer sends `upgrade-insecure-requests`. Every source is `'self'`, HSTS already forces HTTPS, and WebKit applies the directive to `http://localhost`, which broke the iPhone project of the CI run.
- `CONTRIBUTING.md` now covers docs rules, labels and the PR template.
- `docs/PRD.md` is at version 1.3 (see Appendix C). 1.2 added Time credits and presence checks; 1.3 restores the legal overtime guardrail: the Time credits setting **Pay legal overtime at 2×** is on by default, so approved overtime beyond 9 h a day or 48 h a week counts twice in the ledger and is worth 2× when it is settled or netted against late and early minutes (PRD 7.17.7).
- The payslip engine computes late/early, overtime pay and the off-day extra in one stage (`timeLines`), ready for Time credits to replace it. Payslips are unchanged.

[Unreleased]: https://github.com/harshbhx/feelings-staff/commits/main
