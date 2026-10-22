# API reference

The API is one Hono app inside the Worker, mounted at `/api/v1`. It is described by one table, `endpoints` in [`packages/contracts/src/endpoints.ts`](../packages/contracts/src/endpoints.ts). The server registers every row of that table, and the browser client and the mock client are built from the same rows (see [ADR-15](decisions/0015-endpoint-table-drives-server-and-client.md)). This page is the readable form of the table. A test (`packages/contracts/test/api-docs.test.ts`) fails when a method and path in the table is missing from the tables below, so add a row here in the same PR that adds the endpoint.

The source of truth for every request and response shape is the zod schema named in the tables. The names are exported from `@fs/contracts`. Every path below is relative to `/api/v1`.

Contents: [Conventions](#conventions) · [Endpoints](#endpoints) · [Error shape and codes](#error-shape-and-codes) · [Rate limits](#rate-limits)

## Conventions

### Format

- JSON in and out (`application/json; charset=utf-8`).
- Two exceptions: `POST /punches` is multipart (a field called `payload` holds the JSON, the selfie is a file field), and file downloads (payslip PDF, selfies, exports) return the file.
- Times are epoch milliseconds (names end in `At` or `Ts`). Dates are `YYYY-MM-DD`, months `YYYY-MM`. Money is integer paise (names end in `Paise`).
- An endpoint with no response body answers with the status in the table and an empty body.
- Every response carries `X-Request-Id`. Quote it when you report a problem; the logs and the error body carry the same id.

### Sign-in, cookie and roles

- A session is the cookie `fs_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`). It holds a random token; the database keeps only its SHA-256. Staff sessions slide for 30 days, owner and manager sessions for 14, door sessions for 365. On the owner host ([owner access](owner-access.md)) an owner session started with a passkey is bound to that credential: 12 hours idle, 7 days at most, and it ends when the credential is removed; an owner who has a passkey has no other kind of session there.
- The **Who may call** column uses these words:

| Word | Meaning |
|---|---|
| public | No session needed |
| any signed-in person | Staff, manager or owner, acting on their own data |
| owner | The owner only |
| any manager | A manager (the owner always passes) |
| manager with `perm` | A manager who was granted that permission (the owner always passes) |
| door | A paired door device session |
| test token | Test-only route; needs `X-E2E-Token`, outside production only |

- Manager permissions: `approve_attendance`, `approve_leave`, `approve_overtime`, `offsite`, `roster`, `door`, `payroll`, `staff`, `exports`, `rollcall`.
- **Step-up** `yes` means the owner must have entered the PIN in the last 10 minutes (`POST /auth/step-up`). Without it the call fails with `STEP_UP_REQUIRED` (403); the client shows the PIN sheet and repeats the call.
- A wrong id, or an id from another organisation, always answers `NOT_FOUND` (404), never 403.

### CSRF and versioning

- Every request that is not GET, HEAD or OPTIONS must send an `Origin` header equal to the app origin and an `X-FS-Client: <appVersion>` header. Otherwise the answer is `CSRF` (403). The browser client does this for you; when you call the API by hand (for example `POST /setup` with curl), add both headers.
- If `X-FS-Client` is lower than the Worker's `MIN_APP_VERSION`, the answer is `UPGRADE_REQUIRED` (426) with `details.minAppVersion`. The app then asks the person to update.
- The path carries the major version (`/api/v1`). The contracts are frozen at `contracts-v1`; a change to an endpoint or schema needs a PR labelled `contract-change` that updates the server and the client together.

### Idempotency

Endpoints marked **Idempotent** `yes` accept an `Idempotency-Key` header (8 to 100 characters, one per intended action). The first response is stored with the key, per signed-in person. A repeat with the same key returns the stored status and body and adds the header `Idempotent-Replay: true`. Reusing a key on a different endpoint answers `CONFLICT`. The client generates a key when you do not pass one. Stored keys live in the `idempotency_keys` table ([data model](data-model.md)).

### Validation and unbuilt endpoints

- Input (path, query, body) is parsed with the zod schemas of the table. A failure answers `VALIDATION` (400) with `details.issues`, a list of `{ path, message, code }`.
- Outside production, every response is also checked against its schema; a mismatch answers `INTERNAL` and logs `contract.response_mismatch`. This catches drift in tests and previews.
- An endpoint that is in the table but whose work package has not landed yet answers `NOT_IMPLEMENTED` (501).

## Endpoints

Columns: method, path (under `/api/v1`), who may call, whether step-up is needed, whether `Idempotency-Key` is accepted, the request schemas (`path` = `:param` segments, `query`, `body`), the response schema and the success status when it is not 200, and a one-line summary.

### System and sign-in

Health, public config, one-time setup, joining with an invite, staff and owner sign-in, step-up, and the signed-in person's own profile and consents.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/health` | public | no | no | - | `Health` | Liveness, no DB call |
| GET | `/config` | public | no | no | - | `PublicConfig` | Public client config |
| GET | `/time` | any signed-in person, door | no | no | - | `SignedTime` | Signed server time |
| POST | `/setup` | public | no | no | body `SetupRequest` | `SetupResult` (201) | Create the org and owner once (X-Setup-Token header) |
| GET | `/join/lookup` | public | no | no | query `JoinLookupQuery` | `JoinLookup` | Invite page: name and state for a join code |
| POST | `/join/verify` | public | no | no | body `JoinVerifyRequest` | `JoinVerifyResult` | Check phone + join code |
| POST | `/join/complete` | public | no | no | body `JoinCompleteRequest` | `Me` | Set PIN, register the device key (pending), start a session |
| GET | `/auth/challenge` | public | no | no | query `ChallengeQuery` | `Challenge` | Login challenge nonce (5 min) |
| POST | `/auth/staff/login` | public | no | no | body `StaffLoginRequest` | `Me` | Phone + PIN + device signature |
| POST | `/auth/staff/new-device` | public | no | no | body `NewDeviceRequest` | `NewDeviceResult` | I have a new phone: pending device, notify owner |
| POST | `/auth/owner/magic` | public | no | no | body `OwnerMagicRequest` | no body (202) | Email a sign-in link + 6-digit code (always 202) |
| POST | `/auth/owner/verify` | public | no | no | body `OwnerVerifyRequest` | `Me` | Sign in with the link token or email + code |
| POST | `/auth/owner/password` | public | no | no | body `OwnerPasswordRequest` | `Me` | Password + owner PIN fallback sign-in |
| POST | `/auth/step-up` | owner, any manager | no | no | body `StepUpRequest` | `StepUpResult` | Owner PIN for sensitive actions (10 min) |
| POST | `/auth/logout` | any signed-in person, door | no | no | - | no body (204) | Revoke this session |
| GET | `/me` | any signed-in person | no | no | - | `Me` | Current user, org, device, flags |
| PATCH | `/me` | any signed-in person | no | no | body `MePatch` | `Me` | Language (and owner name) |
| POST | `/me/consents` | any signed-in person | no | no | body `ConsentCreate` | `ConsentView` (201) | Record a consent (new notice version, selfie, night work) |
| POST | `/me/consents/:kind/withdraw` | any signed-in person | no | no | path `ConsentWithdrawParams` | `ConsentView` | Withdraw a consent (selfie) |

### Staff: attendance

Check in and out, door proof, and the staff member's own day, month and data.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| POST | `/punch/nonce` | any signed-in person | no | no | body `NonceRequest` | `NonceResult` | Punch nonce + signed time, or 2 offline nonces |
| POST | `/punches` | any signed-in person | no | yes | multipart body `PunchRequest` | `PunchResult` | Check in / out (multipart payload + optional selfie JPEG <= 200 KB) |
| POST | `/punches/:id/proof` | any signed-in person | no | no | path `IdParams`; body `PunchProofRequest` | `PunchResult` | Attach a door QR to a pending punch (10 min) |
| POST | `/punches/:id/request-approval` | any signed-in person | no | no | path `IdParams`; body `PunchApprovalRequest` | `PunchResult` | Send a needs-proof punch to the owner |
| GET | `/me/today` | any signed-in person | no | no | - | `TodayView` | Today screen |
| GET | `/me/days` | any signed-in person | no | no | query `MonthQuery` | `MonthView` | My month |
| GET | `/me/days/:date` | any signed-in person | no | no | path `DateParams` | `DayDetail` | One day explained |
| GET | `/me/data` | any signed-in person | no | no | - | `MyData` | DPDP: my data |
| GET | `/me/punches/:id/selfie` | any signed-in person | no | no | path `IdParams` | file | My own selfie JPEG while it is kept |

### Staff: requests

Leave, fixes to a day (regularisations) and advances, from the staff member's side.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/me/leave` | any signed-in person | no | no | - | `MyLeave` | Balances, requests, blackout days |
| POST | `/leave-requests/preview` | any signed-in person | no | no | body `LeaveRequestCreate` | `LeavePreview` | Counted days, paid/unpaid split and warnings before sending |
| POST | `/leave-requests` | any signed-in person | no | no | body `LeaveRequestCreate` | `LeaveRequestView` (201) | Ask for leave |
| POST | `/leave-requests/:id/cancel` | any signed-in person | no | no | path `IdParams` | `LeaveRequestView` | Cancel a leave request |
| GET | `/me/regularisations` | any signed-in person | no | no | - | `MyRegularisations` | My fix requests |
| POST | `/regularisations` | any signed-in person | no | no | body `RegularisationCreate` | `RegularisationView` (201) | Fix a day |
| POST | `/regularisations/:id/cancel` | any signed-in person | no | no | path `IdParams` | `RegularisationView` | Cancel a fix request |
| GET | `/me/advances` | any signed-in person | no | no | - | `MyAdvances` | My advances and ledger |
| POST | `/advance-requests` | any signed-in person | no | no | body `AdvanceRequestCreate` | `AdvanceView` (201) | Ask for an advance (P1) |
| POST | `/advances/:id/ack` | any signed-in person | no | no | path `IdParams`; body `AdvanceAckRequest` | `AdvanceView` | That's right / Something's wrong |

### Staff: pay

Payslips. The PDF endpoint is also used by the owner and by managers with the `payroll` permission.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/me/payslips` | any signed-in person | no | no | - | `PayslipSummary[]` | My payslips |
| GET | `/me/payslips/:id` | any signed-in person | no | no | path `IdParams` | `PayslipView` | One payslip |
| GET | `/payslips/:id/pdf` | any signed-in person | no | no | path `IdParams` | file | Payslip PDF (202 while generating) |

### Staff: presence (P1)

Step out, I'm back, the optional foreground check and the person's own presence log. None of these routes returns credits, balances or rupee values.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/me/presence` | any signed-in person | no | no | - | `PresenceState` | Presence state: Step out button, marked-away card, foreground timer |
| POST | `/presence/step-out` | any signed-in person | no | yes | body `StepOutRequest` | `AwayIntervalStaff` | Step out with a reason chip (409 CONFLICT if not checked in or already out) |
| POST | `/presence/back` | any signed-in person | no | yes | body `BackRequest` | `AwayIntervalStaff` | I'm back: end the open interval, stepped out or marked away |
| POST | `/me/presence/away/:id/note` | any signed-in person | no | no | path `IdParams`; body `AwayNoteRequest` | `AwayIntervalStaff` | One note on an away interval |
| POST | `/presence/checks` | any signed-in person | no | yes | body `PresenceCheckRequest` | `PresenceCheckResultView` | Optional signed foreground check (nonce purpose presence; no coordinates kept) |
| GET | `/me/presence/history` | any signed-in person | no | no | query `PresenceHistoryQuery` | `PresenceHistory` | My roll-call marks, away intervals and checks for a month |

### Notifications

Inbox, Web Push subscriptions and per-event switches.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/notifications` | any signed-in person | no | no | query `NotificationsQuery` | `NotificationsPage` | Inbox page |
| POST | `/notifications/read` | any signed-in person | no | no | body `NotificationsReadRequest` | no body (204) | Mark read |
| POST | `/notifications/:id/opened` | any signed-in person | no | no | path `IdParams` | no body (204) | Push was opened (feeds escalation) |
| POST | `/push/subscribe` | any signed-in person | no | no | body `PushSubscribeRequest` | no body (201) | Save a push subscription |
| DELETE | `/push/subscribe` | any signed-in person | no | no | body `PushUnsubscribeRequest` | no body (204) | Remove a push subscription |
| GET | `/me/notification-prefs` | any signed-in person | no | no | - | `NotificationPrefs` | Per-event channel switches |
| PUT | `/me/notification-prefs` | any signed-in person | no | no | body `NotificationPrefs` | `NotificationPrefs` | Save per-event channel switches |

### Owner: today, actions, register, days

The live board, the Needs action queue, devices, decisions, the month register, and evidence for a single day.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/today` | owner, any manager | no | no | - | `TodayBoard` | Live board |
| GET | `/owner/actions` | owner, any manager | no | no | query `ActionsQuery` | `ActionsView` | Needs-action queue |
| POST | `/owner/actions/bulk` | owner, manager with `approve_attendance` | no | yes | body `BulkDecideRequest` | `BulkDecideResult` | Approve selected items of one type (not devices) |
| POST | `/owner/punches/:id/review` | owner, manager with `approve_attendance` | no | yes | path `IdParams`; body `PunchReviewRequest` | `PunchResult` | Looks fine / approve / reject a punch |
| POST | `/owner/devices/:id/decide` | owner | yes | yes | path `DeviceIdParams`; body `DecideRequest` | `DeviceView` | Approve or reject a new phone |
| POST | `/owner/devices/:id/revoke` | owner | yes | no | path `DeviceIdParams`; body `RevokeRequest` | `DeviceView` | Remove an approved phone |
| POST | `/owner/leave-requests/:id/decide` | owner, manager with `approve_leave` | no | yes | path `IdParams`; body `DecideRequest` | `LeaveRequestView` | Approve or reject leave |
| POST | `/owner/regularisations/:id/decide` | owner, manager with `approve_attendance` | no | yes | path `IdParams`; body `RegularisationDecideRequest` | `RegularisationView` | Approve or reject a fix |
| POST | `/owner/overtime/:userId/:date/decide` | owner, manager with `approve_overtime` | no | yes | path `OvertimeParams`; body `OvertimeDecideRequest` | inline object | Approve all, part or none of the overtime |
| POST | `/owner/days/:userId/:date/auto-close` | owner, manager with `approve_attendance` | no | no | path `UserDateParams`; body `AutoCloseDecideRequest` | `OwnerDayDetail` | Keep the auto check-out time or change it |
| GET | `/owner/register` | owner, any manager | no | no | query `RegisterQuery` | `RegisterView` | Month grid staff x days |
| GET | `/owner/days/:userId/:date` | owner, any manager | no | no | path `UserDateParams` | `OwnerDayDetail` | Evidence for one person-day |
| PUT | `/owner/days/:userId/:date/override` | owner | no | no | path `UserDateParams`; body `DayOverrideRequest` | `OwnerDayDetail` | Override a day or its punches, with a reason |
| GET | `/owner/punches/:id/selfie` | owner, any manager | no | no | path `IdParams` | file | Selfie JPEG (access-logged) |
| GET | `/owner/staff/:id/photo` | owner, any manager | no | no | path `IdParams` | file | Enrolled reference photo (access-logged) |

### Owner: staff

People: add, edit, invite, reset PIN, exit, rehire and leave balances. At most 15 active staff.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/staff` | owner, manager with `staff` | no | no | query `StaffListQuery` | `StaffRow[]` | People list |
| POST | `/owner/staff` | owner | no | yes | body `StaffCreate` | `StaffCreated` (201) | Add staff and create an invite (max 15 active) |
| GET | `/owner/staff/:id` | owner, manager with `staff` | no | no | path `IdParams` | `StaffDetail` | One person |
| PATCH | `/owner/staff/:id` | owner | no | no | path `IdParams`; body `StaffPatch` | `StaffDetail` | Edit; salary changes need step-up |
| POST | `/owner/staff/:id/invite` | owner | no | no | path `IdParams` | `StaffInviteResult` | Re-send invite (old code stops working) |
| POST | `/owner/staff/:id/reset-pin` | owner | no | no | path `IdParams` | `StaffInviteResult` | PIN reset invite |
| POST | `/owner/staff/:id/exit` | owner | yes | no | path `IdParams`; body `StaffExitRequest` | `StaffDetail` | Mark as left |
| POST | `/owner/staff/:id/rehire` | owner | no | no | path `IdParams`; body `StaffRehireRequest` | `StaffCreated` | Rehire an exited person (history kept, new invite) |
| GET | `/owner/staff/:id/leave` | owner, manager with `approve_leave` | no | no | path `IdParams` | `StaffLeaveView` | Balances, ledger and requests |
| POST | `/owner/staff/:id/leave-adjust` | owner | no | no | path `IdParams`; body `LeaveAdjustRequest` | `StaffLeaveView` | Ledger adjustment with a note |

### Owner: roster, templates, holidays

The weekly plan, shift templates, holidays and no-leave days.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/roster` | owner, manager with `roster` | no | no | query `RosterQuery` | `RosterView` | Week plan |
| PUT | `/owner/roster` | owner, manager with `roster` | no | no | body `RosterPut` | `RosterView` | Change days (swap = two changes) |
| GET | `/owner/shift-templates` | owner, any manager | no | no | - | `ShiftTemplateView[]` | Shift templates |
| POST | `/owner/shift-templates` | owner | no | no | body `ShiftTemplateCreate` | `ShiftTemplateView` (201) | Add a template |
| PATCH | `/owner/shift-templates/:id` | owner | no | no | path `IdParams`; body `ShiftTemplatePatch` | `ShiftTemplateView` | Edit a template |
| DELETE | `/owner/shift-templates/:id` | owner | no | no | path `IdParams` | no body (204) | Deactivate a template (refused while in use) |
| GET | `/owner/holidays` | owner, any manager | no | no | query `HolidaysQuery` | `HolidayView[]` | Holidays for a year |
| POST | `/owner/holidays` | owner | no | no | body `HolidayCreate` | `HolidayView` (201) | Add a holiday (staff get N28) |
| PATCH | `/owner/holidays/:id` | owner | no | no | path `IdParams`; body `HolidayPatch` | `HolidayView` | Edit a holiday |
| DELETE | `/owner/holidays/:id` | owner | no | no | path `IdParams` | no body (204) | Remove a holiday |
| GET | `/owner/blackout-days` | owner, any manager | no | no | query `HolidaysQuery` | `BlackoutDay[]` | No-leave days for a year |
| POST | `/owner/blackout-days` | owner | no | no | body `BlackoutCreate` | `BlackoutDay` (201) | Add a no-leave day |
| DELETE | `/owner/blackout-days/:date` | owner | no | no | path `DateKeyParams` | no body (204) | Remove a no-leave day |

### Owner: sites, off-site duties, door

The salon geofence and its calibration, venue duties, off-site requests, the door code and door devices.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/sites` | owner, any manager | no | no | - | `SiteView[]` | Salon and active venues |
| PATCH | `/owner/sites/:id` | owner | yes | no | path `IdParams`; body `SitePatch` | `SiteView` | Change centre, radius or accuracy |
| POST | `/owner/sites/:id/calibration-samples` | owner | no | no | path `IdParams`; body `CalibrationSamples` | inline object | Store a calibration session |
| POST | `/owner/sites/:id/calibration/propose` | owner | no | no | path `IdParams` | `CalibrationProposal` | Proposed centre and radius (median / p95 rule) |
| GET | `/owner/offsite-duties` | owner, manager with `offsite` | no | no | query `DutiesQuery` | `DutyView[]` | Off-site duties in a date range |
| POST | `/owner/offsite-duties` | owner, manager with `offsite` | no | yes | body `DutyCreate` | `DutyView` (201) | Create a venue duty (creates a venue site) |
| GET | `/owner/offsite-duties/:id` | owner, manager with `offsite` | no | no | path `IdParams` | `DutyView` | One duty |
| PATCH | `/owner/offsite-duties/:id` | owner, manager with `offsite` | no | no | path `IdParams`; body `DutyPatch` | `DutyView` | Change a duty (staff get N18) |
| DELETE | `/owner/offsite-duties/:id` | owner, manager with `offsite` | no | no | path `IdParams` | no body (204) | Cancel a duty |
| POST | `/owner/maps/resolve` | owner, any manager | no | no | body `MapsResolveRequest` | `MapsResolveResult` | Read a location from a Google Maps link |
| POST | `/owner/offsite-requests/:punchId/decide` | owner, manager with `offsite` | no | yes | path inline; body `OffsiteDecideRequest` | `PunchResult` | Approve, approve and open the venue, or reject |
| GET | `/owner/door-code` | owner, manager with `door` | no | no | - | `DoorCode` | Owner's phone as the door |
| GET | `/owner/door-devices` | owner | no | no | - | `DoorDeviceView[]` | Paired door devices |
| POST | `/owner/door-devices` | owner | yes | no | body `DoorDeviceCreate` | `DoorPairing` (201) | One-time pairing code (10 min) |
| DELETE | `/owner/door-devices/:id` | owner | yes | no | path `IdParams` | no body (204) | Unpair |
| POST | `/owner/door-devices/:id/rotate` | owner | yes | no | path `IdParams` | `DoorDeviceView` | New secret; old tokens stop working |

### Owner: advances, payroll, exports

Advances, payroll runs from draft to paid, adjustments, payslip payment marks and exports.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/advances` | owner, manager with `payroll` | no | no | query `AdvancesQuery` | `AdvancesView` | Advances and balances |
| POST | `/owner/advances` | owner | no | yes | body `AdvanceCreate` | `AdvanceView` (201) | Give an advance (staff get N22) |
| GET | `/owner/advances/:id` | owner, manager with `payroll` | no | no | path `IdParams` | `AdvanceView` | One advance with ledger |
| PATCH | `/owner/advances/:id` | owner | no | no | path `IdParams`; body `AdvancePatch` | `AdvanceView` | Edit before any recovery |
| DELETE | `/owner/advances/:id` | owner | no | no | path `IdParams` | no body (204) | Cancel an advance with no recoveries |
| POST | `/owner/advances/:id/decide` | owner | no | no | path `IdParams`; body `AdvanceDecideRequest` | `AdvanceView` | Approve or reject an advance request (P1) |
| GET | `/owner/payroll-runs` | owner, manager with `payroll` | no | no | - | `PayrollRunSummary[]` | Runs by month |
| POST | `/owner/payroll-runs` | owner | no | yes | body `PayrollCreate` | `PayrollRunView` (201) | Start payroll (draft) for a closed month |
| GET | `/owner/payroll-preview` | owner, manager with `payroll` | no | no | query `PayrollPreviewQuery` | `PayrollRunView` | Payroll so far (read-only, mid-month) |
| GET | `/owner/payroll-runs/:id` | owner, manager with `payroll` | no | no | path `IdParams` | `PayrollRunView` | Review a run |
| POST | `/owner/payroll-runs/:id/recompute` | owner | no | yes | path `IdParams` | `PayrollRunView` | Recompute a draft |
| GET | `/owner/payroll-runs/:id/people/:userId` | owner, manager with `payroll` | no | no | path `RunPersonParams` | `OwnerPayslipView` | One person's payslip with formulas |
| POST | `/owner/payroll-runs/:id/adjustments` | owner | no | yes | path `IdParams`; body `AdjustmentCreate` | `OwnerPayslipView` (201) | Incentive, other earning or deduction |
| DELETE | `/owner/payroll-runs/:id/adjustments/:adjId` | owner | no | no | path `RunAdjParams` | `OwnerPayslipView` | Remove an adjustment |
| PATCH | `/owner/payroll-runs/:id/advance-recovery` | owner | no | no | path `IdParams`; body `AdvanceRecoveryPatch` | `OwnerPayslipView` | Lower this month’s advance recovery |
| POST | `/owner/payroll-runs/:id/finalise` | owner | yes | yes | path `IdParams`; body `FinaliseRequest` | `PayrollRunView` | Finalise: lock the month, freeze payslips, queue PDFs |
| POST | `/owner/payroll-runs/:id/reopen` | owner | yes | yes | path `IdParams`; body `ReopenRequest` | `PayrollRunView` | Reopen as a new revision |
| POST | `/owner/payslips/:id/mark-paid` | owner | no | yes | path `IdParams`; body `MarkPaidRequest` | `OwnerPayslipView` | Mark one salary paid |
| POST | `/owner/payroll-runs/:id/mark-all-paid` | owner | no | yes | path `IdParams`; body `MarkPaidRequest` | `PayrollRunView` | Mark every unpaid salary paid |
| GET | `/owner/exports` | owner, manager with `exports` | no | no | - | `ExportView[]` | Recent exports (7 days) |
| POST | `/owner/exports` | owner, manager with `exports` | yes | no | body `ExportRequest` | `ExportCreated` (202) | Start an export |
| GET | `/owner/exports/:id` | owner, manager with `exports` | no | no | path `IdParams` | `ExportView` | Export status |
| GET | `/owner/exports/:id/file` | owner, manager with `exports` | no | no | path `IdParams` | file | Download the export |

### Owner: settings, setup, security, audit

Organisation settings, the first-run checklist, the owner's own security, the audit log and managers.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/settings` | owner | no | no | - | `SettingsView` | Settings |
| PATCH | `/owner/settings` | owner | no | no | body `SettingsPatchRequest` | `SettingsView` | Change settings (step-up for strong mode and risk thresholds) |
| GET | `/owner/setup` | owner | no | no | - | `SetupView` | Setup checklist |
| POST | `/owner/setup/steps/:step` | owner | no | no | path `SetupStepParams`; body `SetupStepRequest` | `SetupView` | Mark a setup step done or skipped |
| GET | `/owner/security` | owner | no | no | - | `SecurityView` | Email, password/PIN state, sessions |
| PUT | `/owner/security/password` | owner | yes | no | body `SetPasswordRequest` | `SecurityView` | Set or change the fallback password |
| PUT | `/owner/security/pin` | owner | no | no | body `SetPinRequest` | `SecurityView` | Set the owner PIN (first time, or a forgotten one, within 15 min of an email sign-in) or change it |
| POST | `/owner/security/sign-out-others` | owner | no | no | - | `SecurityView` | Revoke every other session |
| GET | `/owner/audit` | owner | no | no | query `AuditQuery` | `AuditPage` | Audit log |
| GET | `/owner/managers` | owner | no | no | - | `ManagerView[]` | Managers (P1) |
| PUT | `/owner/managers` | owner | yes | no | body `ManagerUpsert` | `ManagerView` | Grant manager rights (P1) |
| DELETE | `/owner/managers/:id` | owner | yes | no | path `IdParams` | no body (204) | Remove manager rights (P1) |

Forgotten owner PIN ([owner access](owner-access.md#passkeys), flow 6): `PUT /owner/security/pin` without `currentPin` while a PIN exists sets a new one only while `SecurityView.pinResetUntil` is in the future. The server opens that window for 15 minutes after an email-code or magic-link sign-in (a password sign-in never opens it), once per sign-in; otherwise it answers `RULE_VIOLATION` with `reason: recent_sign_in_required`. A reset clears the PIN failures and lock, revokes the owner's other sessions, emails "Your Feelings Staff owner PIN was changed" to the owner address and writes the audit row `owner.pin_reset`; any PIN set or change closes the window for that session. The admin path is `scripts/owner-recovery.mjs --clear-pin` ([owner recovery runbook](runbooks/owner-recovery.md)).

### Owner: Time credits and presence

The credits routes are owner only; managers get 403 on all of them. Roll-call and away routes are open to managers with `rollcall`.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/owner/credits` | owner | no | no | query `CreditsQuery` | `CreditsOverview` | Credits: one row per person with balance and 1x estimate |
| GET | `/owner/credits/:userId/ledger` | owner | no | no | path `CreditUserParams`; query `CreditLedgerQuery` | `CreditLedger` | One person's ledger with running balance and edit history |
| POST | `/owner/credits/:userId/adjustments` | owner | no | yes | path `CreditUserParams`; body `CreditAdjustmentCreate` | `CreditAdjustment` (201) | Adjust one day and kind, with a required reason |
| PATCH | `/owner/credits/adjustments/:id` | owner | no | no | path `IdParams`; body `CreditAdjustmentPatch` | `CreditAdjustment` | Change an adjustment; the original stays in the history |
| DELETE | `/owner/credits/adjustments/:id` | owner | no | no | path `IdParams`; body `CreditAdjustmentVoid` | `CreditAdjustment` | Void an adjustment with a reason; the original stays in the history |
| GET | `/owner/payroll-runs/:id/credits` | owner | no | no | path `IdParams` | `CreditsSettleView` | Settle credits step of a payroll run |
| PUT | `/owner/payroll-runs/:id/credits/:userId` | owner | no | yes | path `RunPersonParams`; body `CreditSettleRequest` | `CreditSettleResult` | Settle minutes for one person until finalise (0 removes it) |
| GET | `/owner/roll-calls` | owner, manager with `rollcall` | no | no | query `RollCallDayQuery` | `RollCallDay` | The day's roll-call slots (P1) |
| GET | `/owner/roll-calls/:id` | owner, manager with `rollcall` | no | no | path `IdParams` | `RollCallView` | People checked in at the slot time (P1) |
| POST | `/owner/roll-calls/:id/submit` | owner, manager with `rollcall` | no | yes | path `IdParams`; body `RollCallSubmit` | `RollCallResult` | Submit or edit a roll-call: Not here starts or continues an interval (P1) |
| GET | `/owner/presence/away` | owner | no | no | query `AwayListQuery` | `AwayIntervalView[]` | Away intervals by state (same items as the Needs action away type) |
| PATCH | `/owner/presence/away/:id` | owner, manager with `rollcall` | no | no | path `IdParams`; body `AwayPatch` | `AwayIntervalView` | Edit start, end, reason or the work flag of an away interval |
| POST | `/owner/presence/away/:id/decide` | owner | no | yes | path `IdParams`; body `AwayDecideRequest` | `AwayIntervalView` | Confirm, mark as work or ignore a pending step-out |
| GET | `/owner/presence/:userId/:date` | owner, manager with `rollcall` | no | no | path `UserDateParams` | `OwnerPresenceDay` | One person's roll-calls, away intervals and checks for a day |

### Owner access: passkeys, devices, recovery

Sign-in with passkeys on the owner's own host ([ADR-19](decisions/0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md), design in [owner access](owner-access.md)). These routes answer only on the owner host: on the staff host, and everywhere while `OWNER_HOST` is unset, they answer `NOT_FOUND` (404). A route that is not built yet answers `NOT_IMPLEMENTED` (501) instead, except on the staff host: built are the passkey options and verify, enrolment (the first device, and another device with the `enrolToken` of an approved device request), device requests (create, poll, list, decide), the device list, rename and Remove; recovery comes in the next slice. The schemas are in `packages/contracts/src/api/owner-access.ts`.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| POST | `/auth/owner/passkey/options` | public (`confirm`: an owner passkey session) | no | no | body `OwnerPasskeyOptionsRequest` | `OwnerPasskeyOptions` | Passkey challenge (5 min, single use) for sign-in or to confirm a device action |
| POST | `/auth/owner/passkey/verify` | public | no | no | body `OwnerPasskeyVerifyRequest` | `Me` | Sign in with a passkey: owner session bound to that credential |
| POST | `/auth/owner/enrol/options` | public (an owner session without a passkey, or an enrolment token) | no | no | body `OwnerEnrolOptionsRequest` | `OwnerEnrolOptions` | Passkey creation options: first device after the email code, or an enrolment token |
| POST | `/auth/owner/enrol/verify` | public (an owner session without a passkey, or an enrolment token) | no | no | body `OwnerEnrolVerifyRequest` | `OwnerEnrolResult` (201) | Store the new passkey, approve this device, start a session bound to it |
| POST | `/auth/owner/device-requests` | public | no | no | body `OwnerDeviceRequestCreate` | `OwnerDeviceRequestCreated` (201) | Add this device: a request with a 6-digit code (15 min) |
| POST | `/auth/owner/device-requests/:id/status` | public | no | no | path `IdParams`; body `OwnerDeviceRequestPoll` | `OwnerDeviceRequestState` | The new device polls its own request with its enrolment token |
| GET | `/owner/device-requests` | owner | no | no | - | `OwnerDeviceRequestList` | Pending device requests (approval cards in Needs action) |
| POST | `/owner/device-requests/:id/decide` | owner | yes | no | path `IdParams`; body `OwnerDeviceRequestDecision` | `OwnerDeviceRequestView` | Approve (passkey on this device + PIN) or decline a device request |
| GET | `/owner/security/devices` | owner | no | no | - | `OwnerDeviceList` | Approved devices (passkeys) of the signed-in owner |
| PATCH | `/owner/security/devices/:id` | owner | no | no | path `IdParams`; body `OwnerDeviceRenameRequest` | `OwnerDeviceView` | Rename an approved device |
| POST | `/owner/security/devices/:id/remove` | owner | yes | no | path `IdParams`; body `OwnerDeviceRemoveRequest` | `OwnerDeviceList` | Remove a device (passkey on this device + PIN); never the last one |
| POST | `/auth/owner/recovery` | public | no | no | body `OwnerRecoveryRedeemRequest` | `OwnerRecoveryRedeemResult` | Recovery code (admin-issued, single use) -> enrolment token for a fresh first device |

How the routes fit together:

- **Sign in.** `POST /auth/owner/passkey/options` with `purpose: "signin"` returns a challenge and the options for `navigator.credentials.get()` (usernameless: no allow list, user verification required). `emailCode` is true while an owner of the salon has no passkey yet; only then does the page offer "Email me a code". The browser's answer goes to `POST /auth/owner/passkey/verify` with the `challengeId`.
- **First device.** The existing `POST /auth/owner/magic` and `POST /auth/owner/verify` sign the owner in with the email code; then `POST /auth/owner/enrol/options` (no token) and `POST /auth/owner/enrol/verify` create the passkey. From then on the email-code routes refuse that owner on the owner host.
- **Another device.** The new device calls `POST /auth/owner/device-requests` and keeps the `enrolToken` (never shown); it shows the `code` and polls `POST /auth/owner/device-requests/:id/status`. On an approved device the owner sees the request in `GET /owner/device-requests`, gets a challenge with `purpose: "confirm"` and approves with `POST /owner/device-requests/:id/decide` (passkey on that device, then the PIN). The new device then has 10 minutes to call the enrol routes with its `enrolToken`.
- **Recovery.** `POST /auth/owner/recovery` turns an admin-issued code into an `enrolToken`; enrolling with it removes the owner's old passkeys.
- **Confirming a device action.** Approve and Remove carry a passkey assertion made on the device that holds the session (`purpose: "confirm"`: the options allow only that session's credential) and need step-up.

Errors these routes use (no new codes):

| Code | When |
|---|---|
| `NONCE_INVALID` (409) | The challenge is unknown, used, expired (5 min) or was issued for another purpose or session. Get a new one. |
| `SIGNATURE_INVALID` (401) | The passkey answer does not verify: signature, origin, relying-party id, user verification flag, counter, or an unknown or removed credential. |
| `FORBIDDEN` (403), `details.reason: "passkey_enrolled"` | The email-code sign-in on the owner host for an owner who has a passkey. |
| `RULE_VIOLATION` (422), `details.reason` | `already_enrolled` (first-device enrolment for an owner with a passkey), `no_device` (a device request while no owner has a passkey to approve it), `last_device` (removing the only device). |
| `FORBIDDEN` (403), `details.reason: "passkey_session"` | A confirm challenge, the request list or a decision from a session that did not sign in with a passkey. |
| `NOT_FOUND` (404) | Polling a request with a token that is not its own (wrong or another request's). |
| `LINK_EXPIRED` (410) | An enrolment token or device request that expired (15 minutes pending, 10 minutes after approval), was declined, was not approved yet or was used; a recovery code that expired or was used. Polling a used token answers it too; a declined or expired request polls as `status: "declined"` or `"expired"`. |
| `ALREADY_DECIDED` (409) | Deciding a device request that is no longer pending. |
| `CODE_WRONG` (401) | A recovery code that does not match. |

### Door device

The kiosk screen at the door.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| POST | `/door/pair` | public | no | no | body `DoorPairRequest` | `DoorPairResult` | Pair this device as the door screen |
| GET | `/door/status` | door | no | no | - | `DoorStatus` | Last check-in line |
| GET | `/door/secret` | door | no | no | - | `DoorSecret` | Current secret of this door device (after the owner rotates it) |

### Public

No sign-in needed.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| GET | `/verify/payslip/:token` | public | no | no | path `VerifyTokenParams` | `PayslipVerify` | Payslip authenticity (name initial, month, net, revision) |

### Test-only routes

Exist only outside production. They need the `X-E2E-Token` header; without it (or in production) they answer 404.

| Method | Path | Who may call | Step-up | Idempotent | Request | Response | Summary |
|---|---|---|---|---|---|---|---|
| POST | `/__test/reset` | test token | no | no | body `TestResetRequest` | `TestResetResult` | Truncate and seed a scenario |
| POST | `/__test/clock` | test token | no | no | body `TestClockRequest` | `TestClockResult` | Set or clear the fake server clock |
| POST | `/__test/cron` | test token | no | no | body `TestCronRequest` | `TestCronResult` | Run a scheduled job now |
| GET | `/__test/outbox` | test token | no | no | - | `TestOutbox` | Captured pushes, emails, WhatsApp |

## Error shape and codes

Every error has the same body:

```json
{ "error": { "code": "PIN_WRONG", "message": "Wrong PIN. 3 tries left.",
             "details": { "triesLeft": 3 }, "requestId": "01JB..." } }
```

`message` is safe to show. The client maps `code` to translated copy where it has some, and falls back to `message`. `details` depends on the code (`VALIDATION`: `issues`; `PIN_LOCKED`: `until`; `UPGRADE_REQUIRED`: `minAppVersion`). Stack traces are never sent.

The default messages below come from `DEFAULT_ERROR_MESSAGES` in `packages/contracts/src/errors.ts`; the server may send a more specific one.

| HTTP | Code | Default message |
|---|---|---|
| 400 | `VALIDATION` | Some details need fixing. |
| 400 | `BAD_REQUEST` | We couldn't read that request. |
| 401 | `UNAUTHENTICATED` | Please sign in again. |
| 401 | `PIN_WRONG` | Wrong PIN. |
| 401 | `CODE_WRONG` | That code doesn't match. |
| 401 | `SIGNATURE_INVALID` | This phone's security key didn't match. |
| 403 | `FORBIDDEN` | You don't have access to this. |
| 403 | `CSRF` | We couldn't verify where this request came from. Reload the app and try again. |
| 403 | `DEVICE_NOT_APPROVED` | This phone isn't approved yet. |
| 403 | `ACCOUNT_INACTIVE` | Your account is not active. Talk to the owner. |
| 403 | `STEP_UP_REQUIRED` | Enter your PIN to continue. |
| 403 | `INSTALL_REQUIRED` | The staff app works after you add it to your home screen. |
| 404 | `NOT_FOUND` | We couldn't find that. |
| 409 | `CONFLICT` | That changed in the meantime. Reload and try again. |
| 409 | `NONCE_INVALID` | That took too long. Try again. |
| 409 | `ALREADY_DECIDED` | This was already decided. |
| 409 | `MONTH_LOCKED` | This month is closed. |
| 409 | `DUPLICATE` | This already exists. |
| 410 | `INVITE_EXPIRED` | This invite has expired. |
| 410 | `LINK_EXPIRED` | This link has expired. Send a new one. |
| 413 | `PAYLOAD_TOO_LARGE` | The photo is too large. |
| 422 | `LOCATION_APPROXIMATE` | Your phone is sharing only an approximate location. |
| 422 | `OUTSIDE_FENCE` | You're outside the salon. |
| 422 | `TOO_EARLY` | It's too early to check in. |
| 422 | `RULE_VIOLATION` | That isn't allowed by the salon's rules. |
| 423 | `PIN_LOCKED` | Too many wrong tries. |
| 426 | `UPGRADE_REQUIRED` | Please update the app. |
| 429 | `RATE_LIMITED` | Too many tries. Wait a little and try again. |
| 500 | `INTERNAL` | We couldn't complete that. Try again in a moment. |
| 501 | `NOT_IMPLEMENTED` | This isn't ready yet. |
| 503 | `UNAVAILABLE` | We couldn't reach the server. Try again in a moment. |

`NOT_IMPLEMENTED` (501) is not in PRD 9.2. It is the answer for a table row whose handler is not built yet (see above).

## Rate limits

Short windows use the Workers rate-limit bindings (10 or 60 second periods; counts are per Cloudflare location, so they are a first line only). Lockouts that must hold for minutes or hours are counted in D1. A blocked call answers `RATE_LIMITED` (429) with `Retry-After`.

| Scope | Limit | Mechanism |
|---|---|---|
| Any request, per IP | 300 per 60 s | binding `RL_IP` |
| Signed-in API, per session | 120 per 60 s | binding `RL_SESSION` |
| Punch submissions, per user | 6 per 60 s | binding `RL_PUNCH` |
| Door status, per door device | 12 per 60 s | binding `RL_DOOR` |
| PIN tries, per user | 5 wrong: locked 15 min; 10 wrong in 24 h: owner alert | D1, `users.pin_*` |
| Join code tries, per phone | 5 per hour | D1, `invites` |
| Magic link requests | 3 per email per 15 min; 10 per IP per hour | D1, `magic_links` |
| Magic code tries, per link | 5, then the link dies | D1 |
| Exports, per organisation | 10 per hour | D1, `exports` |
| Google Maps link resolve, per organisation | 20 per hour | D1 |
| Owner passkey challenges (`/auth/owner/passkey/options`, `/auth/owner/enrol/options`) | 20 per IP per 15 min; each verify uses up one challenge, so verifies are capped too | D1, owner access challenges |
| Owner device requests | 5 per IP per hour; 3 pending at a time per organisation | D1, `owner_device_requests` |
| Recovery code tries | 5 per IP per hour | D1 |

Locally the IP and session limits are off unless a test sends `X-FS-Test-RateLimit: on`.

## Keeping this page current

1. Add the endpoint to `packages/contracts/src/endpoints.ts` (a `contract-change` PR, see [CONTRIBUTING](../CONTRIBUTING.md)).
2. Add a row to the right table here, with the same method and path.
3. The drift test in `packages/contracts/test/api-docs.test.ts` runs in the `ci` workflow and fails when a row is missing.
