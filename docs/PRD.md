# Feelings Staff: product requirements

| | |
|---|---|
| **Product** | Feelings Staff, the staff attendance and payroll app for Feelings Beauty Care |
| **Client** | Feelings Beauty Care, Om Residency, Hirji Mistry Road, near J J Tower, Jamnagar, Gujarat 361006 |
| **Owner of the business** | Urmi Mengar (founder; spelling still to be confirmed) |
| **Built and run by** | Harsh Bhanushali (GitHub `harshbhx`) |
| **URL** | https://staff.feelingsbeautycare.in |
| **Repository** | `harshbhx/feelings-staff` (new, private) |
| **Version** | 1.0, 19 Oct 2026 |
| **Status** | Ready for build. Open questions for the owner are in §17, each with the default we build if nobody answers. |
| **Inputs** | `research/brand-and-stack.md` (brand, stack, hosting, salon location) and `research/domain.md` (competitors, anti-spoofing, push, PWA, Indian payroll law, DPDP, costs) |

**How to read this document.** Sections 1–3 say what we are building and why. Sections 4–7 are the behaviour: every flow, screen, notification and pay rule. Sections 8–11 are the system: data, API, security and PWA. Section 12 is the look. Sections 13–16 are how we build, test and ship it, including the plan for parallel build agents. Section 17 lists risks and open questions.

**Words used with one meaning throughout**

| Term | Meaning |
|---|---|
| Owner | Urmi. Full rights. The data fiduciary under the DPDP Act. |
| Manager | Optional role with approval rights the owner grants. No salary access unless granted. |
| Staff | Anyone who checks in: stylist, beautician, makeup artist, mehndi artist, nail technician, receptionist, helper, trainer, trainee. |
| Punch | One recorded event: check in, check out, break start or break end. |
| Work date | The IST calendar date a punch belongs to (§7.2). Stored as `YYYY-MM-DD`. |
| Shift | The scheduled working window(s) for a work date, from a shift template or roster override. |
| Site | A geofence: the salon (permanent) or a venue (temporary, for one off-site duty). |
| Off-site duty | An owner-created assignment to work at a venue for a date and time window. |
| Flagged | Accepted, but marked for the owner to look at. Never blocks the staff member. |
| Pending | Not yet counted. Waits for proof (door QR) or the owner's approval. |
| LOP | Loss of pay: a day or part day that is not paid. |
| Paise | All money is stored and computed as integer paise (₹1 = 100 paise). |


## Contents

- [1. Summary, goals, non-goals, success metrics](#1-summary-goals-non-goals-success-metrics)
- [2. Personas](#2-personas)
- [3. Feature list by priority](#3-feature-list-by-priority)
- [4. User flows](#4-user-flows)
- [5. Screen inventory](#5-screen-inventory)
- [6. Notification matrix](#6-notification-matrix)
- [7. Payroll and time rules](#7-payroll-and-time-rules)
- [8. Data model](#8-data-model)
- [9. API](#9-api)
- [10. Security, anti-spoofing, privacy and audit](#10-security-anti-spoofing-privacy-and-audit)
- [11. PWA](#11-pwa)
- [12. Design system](#12-design-system)
- [13. Architecture and decisions](#13-architecture-and-decisions)
- [14. Testing strategy and definition of done](#14-testing-strategy-and-definition-of-done)
- [15. CI/CD, environments, secrets and domain](#15-cicd-environments-secrets-and-domain)
- [16. Build plan for parallel agents](#16-build-plan-for-parallel-agents)
- [17. Risks and open questions](#17-risks-and-open-questions)
- [Appendix A. Traceability to the original request](#appendix-a-traceability-to-the-original-request)
- [Appendix B. Sources](#appendix-b-sources)
- [Appendix C. Changelog](#appendix-c-changelog)

---

## 1. Summary, goals, non-goals, success metrics

### 1.1 Summary

Feelings Staff is an installable web app (PWA) with two faces in one app:

- **The staff app.** Staff check in and out from their own phone, only when they are inside the salon geofence (about 100 m, calibrated by the owner). On wedding days they check in at the venue, using a temporary geofence the owner creates, or with the owner's approval. They see their days, request leave and fixes, and get their payslips.
- **The owner panel.** Urmi sees who is in right now, who is late and who has not arrived. She gets push notifications for what matters, approves requests in one place, and runs payroll at the end of the month: salary, overtime, undertime, leave, advances and a payslip per person that she can share on WhatsApp.

It runs on one Cloudflare Worker (static assets + API + scheduled jobs) with D1 and R2, in the same Cloudflare account that already hosts the salon's website. It costs about $5 a month (the Workers Paid plan).

### 1.2 Goals

| # | Goal | Why it matters |
|---|---|---|
| G1 | A staff member checks in, honestly and from the salon, in under 10 seconds | If it is slow, people stop using it and the owner goes back to the paper register |
| G2 | The owner knows by 10:30 every morning who is in, who is late and who is missing, without asking anyone | This is the daily pain today |
| G3 | Month-end salary is computed from attendance in under 15 minutes, with every rupee explained | Removes arguments about cuts, overtime and advances |
| G4 | Check-in is hard to fake: device-bound, PIN, geofence with accuracy checks, risk score, door QR | Buddy punching and "I'm on my way" check-ins are the main abuse |
| G5 | Default rules stay inside Indian and Gujarat wage law | The owner should not break the law by accident (Code on Wages: 2× overtime, 50% deduction cap, no casual fines) |
| G6 | It feels like Feelings Beauty Care, not a template | Harsh asked for a non-generic UI in the brand colours |
| G7 | It works on cheap Android phones and on iPhones, including offline at the moment of check-in | Staff phones vary; the salon is inside a building |

### 1.3 Non-goals for v1

- Face recognition or any biometric template (would make the data "sensitive" under the SPDI rules; phase 2 at the earliest, opt-in).
- Commissions, service targets, tips, or a link to a booking or billing system (a manual "Incentive" line covers v1).
- Statutory filing: PF, ESI, professional tax and TDS returns. The fields exist (off), the filing does not.
- Paying salaries. The app records "paid" with a date and mode; money moves outside the app.
- Background location tracking or route history. Location is read only at check-in and check-out.
- Self-serve sign-up for other salons, billing and multi-branch UI. The data model is multi-tenant ready (`org_id` everywhere); the product is single-salon.
- Native Android or iOS apps. SMS OTP. Shift bidding and swaps between staff. Dark mode (the brand is light only). Hindi (phase 2).

### 1.4 Success metrics

Measured from the app's own data (no third-party analytics in the staff app).

| Metric | Target by week 4 after launch | How measured |
|---|---|---|
| Staff with the app installed and a device approved | 100% of active staff | `devices.status = approved` per active staff |
| Median check-in time (tap "Check in" to success screen) | ≤ 10 s; p90 ≤ 20 s | Client timing sent with the punch (`client_duration_ms`) |
| Punches auto-accepted (no flag, no pending) | ≥ 90% | `punches.status` |
| Punches needing the owner's approval | ≤ 5% | `punches.status = pending` at creation |
| Owner's Needs-action queue cleared within 24 h | ≥ 90% of items | decision time minus creation time |
| Payroll run time for the month | ≤ 15 min from opening the draft to finalising | `payroll_runs.opened_at` to `finalised_at` |
| Payslip disputes raised after finalising | 0 unexplained (every line has a formula) | Regularisations filed against a finalised month |
| Push delivery | ≥ 95% of sends return 201 | `notifications.push_status` |
| Accessibility | 0 serious or critical axe violations on every screen | CI |

---

## 2. Personas

### 2.1 Urmi, the owner

| | |
|---|---|
| **Who** | Founder (since 2009), lead bridal artist, runs the studio and the academy. Often away at weddings. |
| **Device** | Her own smartphone (Android or iPhone, to be confirmed: Q6). Uses WhatsApp all day. Opens a laptop for month-end. |
| **Language** | English, Gujarati and Hinglish. Owner panel ships in English (Gujarati optional later). |
| **Wants** | To know by 10:30 who is in; not to chase people for late check-ins; a salary sheet she trusts; to stop "I came at 10, the register is wrong" arguments; to approve things from her phone between clients. |
| **Fears** | A complicated app; staff feeling watched or insulted; doing something illegal with salary cuts; losing data. |
| **Success looks like** | One push at 10:45 ("8 in · 1 late · 1 not in yet"), a short Needs-action list, and a payroll she finalises on the 1st or 2nd with payslips sent on WhatsApp the same day. |

### 2.2 The manager (optional role)

| | |
|---|---|
| **Who** | A senior beautician or the receptionist who runs the floor when Urmi is at a wedding. |
| **Can** | See the Today board; approve or reject leave, regularisations, flagged punches, off-site requests and overtime for the staff the owner assigns; create off-site duties; show the door code. |
| **Cannot (by default)** | See or edit salaries, advances, payroll, settings, devices or exports. Each of these is a separate permission the owner can grant (§10.2). |
| **Default** | The role exists; nobody holds it at launch (Q12). |

### 2.3 Staff

| Persona | Device and habits | What they need from the app | Design consequence |
|---|---|---|---|
| **Priya, stylist** (typical) | Mid-range Android (Redmi or Realme), Chrome, Gujarati first, WhatsApp-fluent | Check in fast, see her hours and leave balance, ask for leave, see her payslip | One big button; status in words, not only colours; Gujarati in 1.1 |
| **Neha, makeup artist** | iPhone or Android; travels to venues; 4 am calls in wedding season | Check in at the venue; get paid overtime for early calls | Off-site mode; duties that pre-approve hours; works with poor signal (offline queue) |
| **Kajal, trainee or helper** | Older low-end Android, little phone experience | Not get stuck | Large tap targets, a PIN pad, few words, an "Ask Urmi" fallback on every error |
| **Receptionist** | Desk at the salon, often on the salon Wi-Fi | Same as Priya; may also hold the manager role | Salon Wi-Fi is a positive risk signal |

All staff: the app must never shame them (no streaks, scores, leaderboards or red "LATE!!" banners), must say plainly when location is read, and must always offer a human fallback ("Send to Urmi for approval").

---

## 3. Feature list by priority

P0 ships at launch. P1 follows within about four weeks of launch. P2 is later or on request. IDs are used by the acceptance criteria in §14.

### 3.1 Staff app

| ID | Feature | P | Notes |
|---|---|---|---|
| S-01 | Join by invite: install gate, join code, set PIN, privacy notice, device key, wait for approval | P0 | §4.1 |
| S-02 | Log in again with phone + PIN on an approved device | P0 | §4.1.6 |
| S-03 | Install the PWA (Android prompt; iOS guided sheet) | P0 | §4.2 |
| S-04 | Check in / check out with geofence + accuracy gating, PIN, device signature, server time | P0 | §4.3 |
| S-05 | Risk score with accept / flag / needs-proof outcomes | P0 | §4.4 |
| S-06 | Scan the door QR (strong mode and fallback) | P0 | §4.5 |
| S-07 | Optional selfie on check-in (owner toggle, default off); live camera only, no gallery | P0 | §4.3, §10.4 |
| S-08 | Off-site: check in inside an owner-created venue geofence; or "I'm at a venue" request | P0 | §4.6 |
| S-09 | Offline punch queue with signed server time and an encrypted PIN envelope | P0 | §4.3.6, §11.5 |
| S-10 | Today screen: shift, status, live hours, last punch | P0 | §5.1 |
| S-11 | My month: calendar of day statuses; day detail with punches and the pay effect | P0 | §5.1 |
| S-12 | Leave requests (full day), balances, cancel | P0 | §4.9 |
| S-13 | Regularisation requests (forgot to check in or out, wrong time) | P0 | §4.11 |
| S-14 | Payslips: view, download PDF, share | P0 | §4.14 |
| S-15 | Notification inbox + web push (opt in from a tap) | P0 | §6 |
| S-16 | My data: punches, location results, selfies while kept, consent record, grievance contact | P0 | §10.6 |
| S-17 | Language switch, English and Gujarati (Gujarati strings in 1.1) | P0 framework / P1 content | §11.9 |
| S-18 | Break punches (when the owner turns them on) | P1 | §4.7 |
| S-19 | Half-day leave | P1 | §4.9 |
| S-20 | Advance request | P1 | §4.10 |
| S-21 | Blink liveness check on the selfie (MediaPipe, lazy-loaded) | P1 | §10.4 |
| S-22 | Passkey (fingerprint or face unlock) instead of typing the PIN | P2 | Passkeys sync across a person's devices, so the device key stays for binding |
| S-23 | Hindi | P2 | |

### 3.2 Owner panel

| ID | Feature | P | Notes |
|---|---|---|---|
| O-01 | Owner sign-in: email magic link + 6-digit code; password + PIN fallback; step-up PIN for sensitive actions | P0 | §4.1.7 |
| O-02 | First-run setup: salon, location, shift templates, holidays, pay rules, first staff | P0 | §4.15 |
| O-03 | Today board: counters, who is in, not in yet, flagged; call or WhatsApp links | P0 | §5.2 |
| O-04 | Needs action: one queue for flagged and pending punches, devices, leave, regularisations, overtime, off-site requests | P0 | §4.12 |
| O-05 | Register: month grid of staff × days, totals, day detail with punches, map, selfie, audit trail | P0 | §5.2 |
| O-06 | Owner override of any day or punch, with a reason (audit-logged) | P0 | §4.12 |
| O-07 | Staff: add, invite, edit salary and shift, week-off, leave balances, devices, exit | P0 | §5.2 |
| O-08 | Roster: week view, swap week-offs, assign shift templates | P0 | §5.2 |
| O-09 | Geofence calibration with a map; radius and accuracy settings | P0 | §4.15.2 |
| O-10 | Door QR: pair a door device; "Show door code" on the owner's phone | P0 | §4.5 |
| O-11 | Off-site duties with temporary geofence (map pick, current location, or pasted Google Maps link) | P0 | §4.6 |
| O-12 | Advances: record, recovery plan, ledger, 50% cap carry-forward | P0 | §4.10 |
| O-13 | Payroll run: draft, review, adjustments, finalise (locks the month), mark paid, reopen as revision | P0 | §4.13 |
| O-14 | Payslip PDF (Form V style) with share to WhatsApp and a verify link | P0 | §4.14 |
| O-15 | Exports: register and salary register as CSV and PDF; punches, late/early, overtime, leave, advances and exceptions as CSV | P0 | §4.16 |
| O-16 | Settings: attendance rules, pay rules, leave policy, holidays and blackout days, notifications, quiet hours, selfie toggle, strong mode, retention | P0 | §4.17 |
| O-17 | Notifications: push + inbox for the events in §6 | P0 | §6 |
| O-18 | Audit log viewer | P0 | §10.7 |
| O-19 | Manager role and permissions | P1 | §10.2 |
| O-20 | WhatsApp Cloud API fallback for critical alerts and the daily summary | P1 | §6.3 |
| O-21 | Weekly email digest and payroll-ready email | P1 | §6 |
| O-22 | Fines (off by default) with show-cause acknowledgement and the 3% cap | P1 | §7.9 |
| O-23 | Exit settlement checklist (full and final within 2 working days) | P1 | §4.13.7 |
| O-24 | Earned leave accrual (1 day per 20 worked, after 240 days) | P1 | §7.8 |
| O-25 | Owner panel in Gujarati | P2 | |
| O-26 | Statutory deductions: PF, ESI, Gujarat professional tax, TDS (fields only) | P2 | §7.10 |
| O-27 | Multi-branch UI; tenant onboarding for other salons | P2 | |
| O-28 | Live board over WebSockets (Durable Objects) instead of polling | P2 | ADR-13 |

### 3.3 Platform

| ID | Feature | P |
|---|---|---|
| X-01 | One Worker: static assets, `/api/*`, cron; D1; R2; deploy from GitHub Actions | P0 |
| X-02 | PWA: manifest, icons, service worker, offline shell, update prompt, install UX | P0 |
| X-03 | Security headers, CSP, rate limits, audit log, retention purge | P0 |
| X-04 | Test suites in CI: engine unit, Workers API, Playwright E2E, visual 390/1280, axe | P0 |
| X-05 | Worker Previews per pull request with a preview D1 and R2 | P0 |
| X-06 | Weekly D1 export to R2 (on top of D1 Time Travel's 30 days) | P1 |
| X-07 | Error alert email to Harsh when the 5xx rate spikes | P1 |

---

## 4. User flows

Each flow lists its steps, then every state it can be in, including errors. Copy in quotes is the default English text (sentence case, warm, plain; Hinglish is fine). "Server time" always means the Worker's clock when the request arrived.

### 4.1 Onboarding, invite and sign-in

#### 4.1.1 Owner adds a staff member

1. Owner panel → Staff → **Add staff**.
2. Form: name (required), phone (required, Indian mobile, normalised to E.164 `+91XXXXXXXXXX`), role/designation (chips: Stylist, Beautician, Makeup artist, Mehndi artist, Nail technician, Receptionist, Helper, Trainer, Trainee, Other), joining date (default today), salary type (Monthly default, Daily), salary amount, shift template (default "Full day"), weekly off (weekday chips), language (English default; Gujarati), selfie required (inherits org setting), manager role (P1).
3. **Save and invite** creates the user (`status = invited`) and an invite with a join code, then opens the share sheet.

| State | What the owner sees |
|---|---|
| Phone already used by an active person in this salon | Inline error: "This number already belongs to Priya. Edit Priya instead?" with a link. |
| Phone belongs to an exited person | "Priya left on 3 Aug. Rehire her?" → reactivates the old record (history kept) and issues a new invite. |
| Salary below the minimum-wage check (when on) | Amber notice under the field: "₹11,000 is below the minimum wage you set (₹13,325 a month). You can still save." Saving is allowed. |
| Network error | The form keeps its values; toast "Couldn't save. Check your internet and try again." |

#### 4.1.2 The invite message

Shared through the Web Share API (falls back to a `https://wa.me/91XXXXXXXXXX?text=…` link and a Copy button).

> Hi Priya, this is Urmi from Feelings Beauty Care. Please join our staff app:
> https://staff.feelingsbeautycare.in/join/K7M4QPXD
> Your join code is **K7M-4QPX**. First add the app to your home screen, then open it and type the code.
> The link works for 48 hours.

- Join code: 8 characters, Crockford base32 (no I, L, O, U), shown as `XXX-XXXXX`, single use, expires in 48 h. Stored only as an HMAC (`SESSION_SECRET`-keyed) in `invites.code_hash`.
- The link carries the same code, so Android can prefill it.
- The owner can **Re-send invite** (new code; the old one stops working) from the staff profile.

#### 4.1.3 The invite page in a browser tab (`/join/:code`)

The page detects `display-mode`. In a browser tab it never enrols; it teaches the install, because iOS Home Screen apps do not share storage with Safari, and push on iOS works only in the installed app.

1. Header: bindi logo, "Welcome to the Feelings team, Priya." (name looked up from the code; if the code is invalid, no name).
2. **Android/Chromium** with `beforeinstallprompt` captured: one button **Install the app**. After `appinstalled`, the page says "Done. Open Feelings from your home screen." The code is also written to `localStorage` (Chrome shares storage with the installed WebAPK, so the app can prefill it).
3. **iOS Safari**: an illustrated 3-step sheet: tap **Share** → **Add to Home Screen** → open **Feelings** from the home screen. The code is shown big with a Copy button: "You'll type this code in the app: K7M-4QPX".
4. **iOS in another browser** (Chrome, WhatsApp's in-app browser): "Open this link in Safari to install." with a Copy link button. WhatsApp's in-app browser on both platforms gets the same message for its platform's browser.
5. **Desktop**: "Open this link on your phone." with a QR of the link.

| State | Message |
|---|---|
| Code expired | "This invite has expired. Ask Urmi to send a new one." + WhatsApp-the-owner link |
| Code already used | "This invite was already used. If that wasn't you, tell Urmi." |
| Code unknown | "We couldn't find this invite. Check the link, or ask Urmi." |
| Already installed and opened in the app | Skips straight to 4.1.4 with the code prefilled |

#### 4.1.4 Join inside the installed app

First launch with no session shows **Join your team** (staff) with a small "Owner sign-in" link at the bottom.

1. **Phone and code.** Phone number + join code (prefilled on Android if available). `POST /api/v1/join/verify` → returns the staff name and salon name. Screen: "Hi Priya. Let's set you up."
2. **Privacy notice** (DPDP s.5): a short plain-language screen, in the staff member's language, with a link to the full notice. "We check your location only when you tap Check in or Check out, to confirm you are at the salon. We never track you. We keep exact locations for 90 days and selfies for 30 days." Button **I understand**. If the salon requires selfies, a second, separate consent: "Take a photo when you check in" with **I agree** (required to continue when selfies are on). Night-shift consent is asked later only if needed (§7.11).
3. **Set your PIN.** 4–6 digits, entered twice on the PIN pad. Rejected: all same digit (`1111`), straight runs (`1234`, `4321`), the last 4–6 digits of their own phone, and `0000`. Message: "Pick a PIN that's harder to guess."
4. **Device key.** The app generates an ECDSA P-256 key pair with `extractable: false` (WebCrypto), stores the `CryptoKey` in IndexedDB (`fs-device` store), calls `navigator.storage.persist()`, and sends the public JWK with a label ("Redmi Note 12 · Chrome", from the UA) to `POST /api/v1/join/complete`. The server creates the device (`status = pending`), marks the invite used, sets `users.status = active`, and starts a session.
5. **Notifications.** "Get a ping when Urmi approves your phone, your leave, or your payslip." Button **Turn on notifications** (this tap requests permission; required on iOS). "Not now" is allowed.
6. **Waiting for approval.** "Urmi needs to approve this phone before you can check in. We've let her know." The owner gets a push and a Needs-action item. The screen updates itself when approved (poll every 15 s while visible, plus the push).

| State | Behaviour |
|---|---|
| Wrong code or phone | "That code doesn't match this number." 5 tries per phone per hour, then "Too many tries. Wait an hour or ask Urmi for a new invite." |
| WebCrypto or IndexedDB unavailable (old browser, private mode) | "This phone's browser can't keep the app's security key. Update Chrome or Safari, or use another phone." Join stops. |
| `storage.persist()` refused | Continue; show a one-line tip on the Today screen later: "Keep this app installed. If you clear browser data you'll need Urmi to approve this phone again." |
| Notification permission denied | Continue; the inbox still works. Profile shows "Notifications are off" with platform steps to turn them on. |
| Owner rejects the device | "Urmi didn't approve this phone. Talk to her, then try again." The device is `revoked`; a new join needs a new invite. |
| Already has an approved device | Join completes but the new device is `pending` and the screen says "This will replace your other phone once Urmi approves." On approval the old device is revoked (one approved device per person). |

#### 4.1.5 Owner approves a device

Needs action → "New phone for Priya · Redmi Note 12 · Chrome · joined 2 min ago" → **Approve** / **Reject**. Approval revokes any other approved device for that person and their sessions on it. Staff gets "Your phone is approved. You can check in now."

#### 4.1.6 Staff signing in again, new phone, forgotten PIN

- **Session expired** (30 days without opening the app; sessions slide on use): sign-in screen with phone + PIN. The app first fetches a challenge (`GET /api/v1/auth/challenge`), signs it with the device key, and sends phone + PIN + signature. A device that is not approved cannot sign in, only re-join.
- **New phone, old phone lost**: on the new phone the staff opens the app, taps **I have a new phone**, enters phone + PIN; this creates a pending device and notifies the owner (same as 4.1.5). No invite needed if the PIN is right.
- **Forgotten PIN**: "Ask Urmi to reset your PIN." The owner taps **Reset PIN** in the profile, which issues a new invite (the old PIN stops working, devices stay approved). Never by SMS.
- **Wrong PIN**: "Wrong PIN. 3 tries left." After 5 wrong tries: locked for 15 minutes ("Too many wrong tries. Try again at 10:42."). After 10 wrong tries in 24 h the owner gets a push: "Several wrong PIN tries on Priya's account."

#### 4.1.7 Owner sign-in

1. **Email.** "Owner sign-in" → email → **Send me a sign-in link**. The server always answers "If this email belongs to an owner, a link is on its way" (no account discovery).
2. The email has a link (`/auth/owner?t=<token>`, valid 15 min, single use) **and** a 6-digit code (same lifetime). Why both: on iPhone, a link tapped in Mail opens Safari, not the installed app (separate storage), so the owner types the 6-digit code into the app instead. 5 wrong codes kill the link.
3. **Fallback: password + PIN.** For when email is slow. Set up from Settings → Security (password ≥ 10 characters, not in a small built-in list of common passwords; plus a 6-digit owner PIN).
4. **Step-up.** These actions need the owner PIN entered in the last 10 minutes: finalise or reopen payroll, change salary, approve a device, change the geofence, pair a door device, export data, change retention, add a manager. The PIN sheet slides up; the action continues after it.

| State | Behaviour |
|---|---|
| First ever sign-in | Only the email in `OWNER_BOOTSTRAP_EMAIL` can request a link until the owner exists; `POST /api/v1/setup` with the `SETUP_TOKEN` creates the org and owner once, then refuses forever (§15.4). |
| Link expired or used | "This link has expired. Send a new one." |
| Email not arriving | After 60 s the screen offers "Use password instead" (if set) and "Resend" (3 per 15 min). |
| Owner PIN locked | Same rules as staff PIN; unlock by magic link sign-in. |

### 4.2 Install the PWA

| Platform | Detection | What we show | When |
|---|---|---|---|
| Android Chrome, Samsung Internet, Edge | `beforeinstallprompt` captured | Our own **Install** button; calls `prompt()` once; on dismiss, show again only after 3 days | Invite page; staff sign-in page; owner panel banner (dismissible) |
| iOS Safari 16.4+ | `navigator.standalone === false` and iOS UA | 3-step illustrated sheet (Share → Add to Home Screen → open from Home Screen) | Same places |
| iOS non-Safari browsers | iOS UA, not Safari | "Open in Safari to install" + copy link | Same places |
| Already installed | `matchMedia('(display-mode: standalone)')` or `navigator.standalone` | Nothing | |
| Desktop | Non-mobile | Owner panel: optional "Install on this computer" (Chromium only). Staff pages: "Open on your phone" with a QR | |

Rules:
- **Staff must install.** Every staff route other than `/join/*` checks `display-mode`. In a browser tab it shows the install sheet instead of the app ("The staff app works only after you add it to your home screen."). Reason: device binding and iOS push both depend on the installed context. A dev flag `?allowBrowser=1` works only on preview deployments, for tests.
- **The owner panel works in a tab**, but push on iPhone needs the installed app; the panel shows a one-time banner on iOS: "Add to Home Screen to get alerts on this iPhone."
- After install on Android, the onboarding checklist asks once: "On some phones (Xiaomi, Oppo, Vivo, Realme, Samsung) Chrome is put to sleep and alerts come late. Set Chrome's battery use to 'No restrictions'." with a link to the model's page on dontkillmyapp.com.

### 4.3 Check in and check out

#### 4.3.1 Happy path (target under 10 s)

1. Staff opens the app → Today screen. The one red button says **Check in** (or **Check out** when checked in).
2. Tap. In parallel, the app:
   - asks the server for a punch nonce and the signed server time (`POST /api/v1/punch/nonce`);
   - starts `watchPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })`, keeps every fix, stops after 10 s or as soon as a fix has `accuracy ≤ 30 m`;
   - if a selfie is required for this person, opens the front camera with a live preview in the same sheet.
3. The sheet shows progress in words, not a spinner: "Finding you… 42 m accuracy" → "Got it: at the salon".
4. Selfie (if on): one tap on the shutter or auto-capture once a face is centred (face detection P1). A still JPEG, 480 px on the long side, quality 0.7 (40–80 KB). Retake allowed.
5. PIN pad: "Enter your PIN". (Setting "Ask PIN on every punch", default on.)
6. The app signs the canonical punch payload with the device key (§10.3) and sends it (`POST /api/v1/punches`, multipart with the selfie, `Idempotency-Key` header).
7. Server checks, scores and stores the punch with server time (§4.4) and answers in under 800 ms (p95).
8. Success screen: the bindi lands (520 ms spring, the only celebration in the app), "You're in at 10:02." and a quiet line "At the salon · 18 m away". Haptic tick on Android (`navigator.vibrate(8)`, not with reduced motion). The Today screen now shows the live hours worked.

**Check-out** is the same flow with these differences: selfie is never asked (unless the owner turns on "Selfie on check-out", P1); location is still required; the success screen reads "You're out at 20:07. 9 h 05 m today." and, if they stayed past the shift end by 30 min or more, "Stayed 37 min after your shift. Urmi will see this as overtime to approve."

#### 4.3.2 When check-in is allowed

| Situation | Rule | Message |
|---|---|---|
| Before shift start − 60 min (setting "Earliest check-in", default 60 min) | Blocked unless an off-site duty or pre-approved overtime starts earlier | "Your shift starts at 10:00. You can check in from 9:00." + **Check in anyway** (goes to approval) |
| No shift today (week-off, holiday, approved leave) | Allowed after a confirm | "Today is your week off. Check in anyway? Urmi will see it as extra work." On leave: "You're on leave today. Checking in will cancel today's leave." |
| Already checked in | The button is Check out; a double tap is idempotent (same `Idempotency-Key` returns the first result) | |
| Device pending or revoked | Blocked | "Urmi hasn't approved this phone yet." / "This phone was removed. Ask Urmi." |
| Staff exited or suspended | Signed out on next request (401 `ACCOUNT_INACTIVE`) | "Your account is not active. Talk to Urmi." |

#### 4.3.3 Location states and errors

| State | Trigger | What the staff sees | Options |
|---|---|---|---|
| Pre-permission | Permission state is `prompt` (or unknown on iOS) and the app has never asked | "We check your location only when you tap Check in or Check out, to confirm you're at the salon. We never track you." | **Allow location** (calls `getCurrentPosition` from this tap) |
| Denied | Error code 1 (`PERMISSION_DENIED`) | "Location is off for this app." + platform fix-it sheet with screenshots (Android: lock icon → Permissions → Location → Allow, choose **Precise**; iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using, Precise on) | **Scan door code**, **Send to Urmi for approval** |
| Timeout | No fix in 20 s | Retry once automatically with `enableHighAccuracy: false`; then "We couldn't find your location. Step near a window or the door and try again." | **Try again**, **Scan door code**, **Send to Urmi** |
| Approximate | Best `accuracy ≥ 1000 m` | "Your phone is sharing only an approximate location. Turn on Precise location for this app." + fix-it sheet | Same as Denied |
| Pass | §4.4.1 PASS | Continues | |
| Uncertain | §4.4.1 UNCERTAIN | Continues; the punch is scored (UNCERTAIN adds risk). If the total stays under the flag threshold it is accepted. | |
| Outside | §4.4.1 OUTSIDE | "You're about 340 m from the salon." | **Scan door code**, **I'm at a venue** (if off-site is enabled), **Send to Urmi** |

The time recorded is always the server time of the **first** submission. If a punch ends up pending and the staff member then scans the door code or the owner approves it, the punch keeps that first time. Nobody is made later by the verification.

#### 4.3.4 Camera states (only when selfie is on)

| State | What the staff sees | Result |
|---|---|---|
| Camera permission denied | "Camera is off for this app." + fix-it sheet | **Send to Urmi without a photo** (punch pending, risk reason `selfie_missing`) |
| No camera or `getUserMedia` fails | "We couldn't open the camera." | Same |
| Photo too dark (mean luminance < 40 of 255) | "It's a bit dark. Face the light and try again." | Retake; after 2 tries allow sending anyway (flagged) |

#### 4.3.5 PIN and submit errors

| State | Message | Next |
|---|---|---|
| Wrong PIN | "Wrong PIN. 3 tries left." | Re-enter (the location fix is kept for 2 minutes) |
| PIN locked | "Too many wrong tries. Try again at 10:42." | Punch not saved; offer **Send to Urmi** with a note |
| Nonce expired (> 5 min since tap) | Silent: fetch a new nonce, re-sign, resend once | |
| Session expired | Sign-in sheet; after sign-in the punch is resent | |
| Server 5xx or network failure | "We couldn't reach the server. Your check-in is saved and will send by itself." | Goes to the offline queue (4.3.6) |
| `426 UPGRADE_REQUIRED` | "Please update the app." with **Update now** | Service worker update, then resend |

#### 4.3.6 Offline check-in

1. If the device is offline (or the request fails on the network), the punch is saved in IndexedDB `pendingPunches` with: kind, client time (`Date.now()`), the last signed server time and its `performance.now()` and `Date.now()` anchors, the fixes summary, the selfie blob, an offline nonce (the server pre-issues 2 per device, valid 24 h, single use), the signature, and the PIN sealed with the server's RSA-OAEP public key (only the server can open it; §10.3).
2. Today screen: a persistent banner "1 check-in waiting to send" and the status "In at 10:02 (waiting to send)".
3. Flush triggers: app open, the `online` event, `visibilitychange → visible`, and every 30 s while open. iOS has no Background Sync, so the app must be opened.
4. On sync the server bounds the time: `lastSignedServerTime ≤ eventTime ≤ receivedAt`. Accepted with the badge `offline` if it syncs within 12 h and the bound window is ≤ 2 h. Window > 2 h, or the app had no signed server time from the same work date: the punch is **pending** (owner approval). Older than 12 h: pending with reason `late_sync`.
5. The selfie blob is deleted from IndexedDB once uploaded.

| State | Behaviour |
|---|---|
| Two queued punches (in, then out) | Sent in order; the out waits for the in to be accepted |
| Queue item rejected (e.g. device revoked meanwhile) | Banner turns into "One check-in couldn't be sent. Tap to see why." with **Send to Urmi** |
| App update available while a punch is queued | The update prompt waits until the queue is empty |

### 4.4 Layered verification and the risk score

Every punch passes through the same server pipeline, in this order. Blocks stop the pipeline. Scores add up.

#### 4.4.1 Geofence and accuracy

Inputs: site centre C, radius R (default 100 m, 50–300 m in 25 m steps), maximum accuracy A_max (default 50 m, 30–100 m). Best fix = the fix with the smallest `accuracy`. `d` = haversine distance from the best fix to C; `a` = its accuracy.

```
if a >= 1000                  -> APPROXIMATE (block; fix-it guide)
elif d <= R and a <= A_max    -> PASS
elif d - a <= R               -> UNCERTAIN (accuracy circle overlaps the fence)
else                          -> OUTSIDE (the whole 95% circle is outside)
```

The site checked is: the salon, or the venue of an active off-site duty for this person whose time window (start − 2 h to end + 2 h) contains the server time. If both apply, PASS on either is enough.

#### 4.4.2 Hard blocks

| Check | Result |
|---|---|
| Device signature invalid, device unknown, pending or revoked, or bound to someone else | 403 `DEVICE_NOT_APPROVED`; nothing stored except a security audit row |
| Nonce unknown, already used or expired | 409 `NONCE_INVALID` (the client silently retries once with a fresh nonce) |
| PIN wrong or locked | 401 `PIN_WRONG` / 423 `PIN_LOCKED` |
| Fence APPROXIMATE | 422 `LOCATION_APPROXIMATE` |
| Fence OUTSIDE with no valid door QR and no off-site duty | Stored as **pending** with reason `outside_fence` only if the staff member chose "Send to Urmi"; otherwise 422 `OUTSIDE_FENCE` and nothing is stored |
| Selfie required but missing | Stored as **pending** with reason `selfie_missing` |

#### 4.4.3 Risk signals

| Signal | Points | Detail |
|---|---|---|
| Fence UNCERTAIN | +35 | |
| Zero jitter | +30 | ≥ 3 samples, all identical to 6 decimals, identical accuracy, and `altitude`, `altitudeAccuracy`, `speed` and `heading` null on every sample |
| Replayed point | +25 | Best fix equals, to 6 decimals, any of this person's punches in the last 14 days |
| Impossible jump | +60 | Speed between this fix and this person's previous punch fix (within 12 h) > 120 km/h |
| Network looks like a VPN, hosting provider or non-Indian | +25 | `request.cf.country ≠ IN`, or `request.cf.asn` in a maintained list of hosting and VPN ASNs (in `packages/engine/src/risk/asn.ts`) |
| Device time zone not `Asia/Kolkata` | +15 | From `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| Device clock skew > 5 min from server | +15 | |
| Device approved less than 24 h ago | +10 | |
| Offline punch | +10 | Plus the bounds in 4.3.6 |
| Salon network match | −30 | Request IP equals an IP seen from the owner's or the door device's sessions at the salon in the last 72 h (stored as an HMAC, never raw) |
| Valid door QR | −100 | Also overrides UNCERTAIN; OUTSIDE becomes acceptable |
| Off-site duty PASS | 0 | Treated like the salon PASS; tagged `offsite` |

#### 4.4.4 Outcome

| Score | Outcome | Staff sees | Owner sees |
|---|---|---|---|
| < 30 | **Accepted** | Success | Normal row |
| 30–60 | **Accepted + flagged** | Success (no warning; nothing blocks them) | Amber "Check" chip, a Needs-action item, push (batched) |
| > 60 | **Needs proof** (stored as pending with the original server time) | "We couldn't confirm you're at the salon. Scan the door code, or send this to Urmi." | Needs-action item after 5 minutes if the staff member does not scan the QR |

- Thresholds are settings (`risk.flag_at` = 30, `risk.proof_at` = 60).
- **Never** is pay deducted because of a flag alone. Flagged punches count as normal until the owner rejects them.
- Each punch stores `risk_score` and `risk_reasons` (array of codes) so the owner sees why ("Edge of the fence · New phone").
- Strong mode (setting, default off; also per person): every check-in needs a valid door QR. GPS is still recorded.

### 4.5 Door QR (strong mode and fallback)

**Pairing a door device.** Owner → Settings → Door code → **Pair a door device** (step-up PIN). The panel shows a one-time 8-character pairing code valid 10 min. On the old phone or tablet at the door, open `https://staff.feelingsbeautycare.in/door`, enter the code. The device receives a per-site secret (32 random bytes, stored encrypted at rest on the server with `QR_MASTER_KEY`, and on the device in IndexedDB) and a door session. The owner can unpair or rotate (new secret) at any time.

**The door screen** (`/door`, kiosk-friendly, screen kept awake with the Wake Lock API where supported):
- A large QR of `https://staff.feelingsbeautycare.in/q/<siteId>/<token>`, where `token = base32(HMAC-SHA256(secret, floor(unixTime / 30)))` truncated to 10 characters.
- "New code in 12 s" as text, updated every second (no looping animation).
- A social line: "Last check-in: Priya 10:04".
- Works offline once its clock has synced (it stores the offset from `GET /api/v1/time`; re-syncs hourly).

**Owner's phone as the door.** Owner panel → **Show door code** (no step-up). The server issues the current token for the salon site; the screen refreshes it every 30 s. Use this when there is no spare device.

**Scanning.** Staff app → **Scan door code** (or the needs-proof sheet). Uses `BarcodeDetector` where available (Chrome on Android), else `jsQR` in a Web Worker on frames from the rear camera at 640 px. The token is sent with the punch (or attached to an existing pending punch within 10 min of its first submission).

**Validation.** The server accepts the current and the previous 30 s step (≤ 60 s window), the token must belong to the punch's site, and the same person cannot use the same step twice. The token never works alone: device signature + PIN (+ selfie if on) are still required.

| State | Staff sees |
|---|---|
| Camera denied | Fix-it sheet; **Send to Urmi** |
| Code expired (older than 60 s) | "That code has changed. Scan the new one." |
| Code from another site | "That's not this salon's code." |
| Scanned a QR that is not ours | "That's not the door code." |
| Opened `/q/...` with the phone camera instead of the app | Page says "Open Feelings and tap Scan door code." (No punch is made from a URL.) |

Known limit (stated in the owner's help text): a photo of the code forwarded on WhatsApp works for up to 60 s. That is why the code never stands alone, and why the door screen shows the last check-in.

### 4.6 Off-site and wedding-venue mode

Two ways in. Both keep location at check-in and check-out only.

**A. Owner (or manager) creates an off-site duty** (P0)
1. Owner → Roster → **Add off-site duty** (or from a staff member's day).
2. Fields: staff (one or many), date, start and end time (can start before 06:00 or end after 21:00; night rules in §7.11), place name ("Hotel Aram, Jamnagar"), location, radius (default 200 m, 100–500 m), mode, note.
3. Location by one of: **Use my current location** (owner standing there), **Pick on map** (Leaflet + OpenStreetMap, lazy-loaded), or **Paste a Google Maps link**. The server expands short links (`maps.app.goo.gl`, `goo.gl/maps`) by following the redirect (max 3 hops, only Google hosts) and parses `@lat,lng`, `!3dLAT!4dLNG`, `q=lat,lng` or `ll=`.
4. Mode: **Venue geofence** (default; check-in must PASS or be UNCERTAIN at the venue), **Anywhere** (location recorded, no fence; for home visits where the address is fuzzy), or **Needs my approval** (every punch pending).
5. "Count hours outside the shift as overtime" (default on): duty minutes outside the scheduled shift are pre-approved overtime (§7.6).
6. Staff get a push: "Venue duty tomorrow 04:00–09:00 at Hotel Aram." The duty shows on their Today screen and in My month.

**B. Staff says "I'm at a venue"** (no duty created)
1. From the OUTSIDE state: **I'm at a venue** → place name (free text), note, the location fix already taken, selfie if on.
2. Stored as a pending punch with reason `offsite_unplanned`. Owner push: "Neha checked in at a venue: 'Patel wedding, Lal Bungalow'. Approve?"
3. Owner choices: **Approve**, **Approve and let others check in here today** (creates a duty for today with this point as the centre, radius 200 m, for the staff she selects), **Reject** (with a reason; the staff member sees it).

| State | Behaviour |
|---|---|
| Duty exists but staff is outside the venue fence | Same OUTSIDE options; approval request names the duty |
| Duty time window passed | Treated as no duty |
| Check-out at the salon after a venue check-in | Allowed; each punch is checked against whichever site PASSes |
| Pasted link cannot be parsed | "We couldn't read a location from that link. Pick it on the map instead." |

### 4.7 Breaks (P1)

Default: no break punches. The template's unpaid break is deducted automatically (§7.4). When the owner turns on **Break punches**:
1. Today screen shows a secondary button **Start break** under the red Check out button; then **End break**.
2. Break punches need no location and no PIN (low stakes), only the device signature.
3. Worked minutes subtract actual breaks. Break minutes beyond the template's allowance count as undertime ("over-break").
4. If no break was punched on a day long enough to need one, the automatic deduction applies and the day shows "Break not punched, 60 min taken off".

### 4.8 Missed check-out

| Time | Action |
|---|---|
| Shift end + 30 min, still checked in, no off-site duty running | Staff push: "Still at work? Check out when you leave." |
| Shift end + 30 min | Overtime clock: if they stay, it becomes an overtime candidate (§7.6) |
| Closing time + 60 min (default 21:00) | Owner push (batched): "2 people haven't checked out: Priya, Kajal." |
| Window end + 6 h (window = shift or duty end) | Auto-close: an `out` punch at the scheduled end (or duty end), `source = auto`, status flagged, no overtime credited. Needs-action item "Confirm Priya's check-out time". Staff push: "We closed your day at 20:00. If you left later, tell Urmi." with **Fix the time** (opens a regularisation) |

### 4.9 Leave requests

**Staff** → Requests → **Ask for leave**:
1. Leave type chips with balances: Casual 5 left · Sick 7 left · Comp-off 1 left · Unpaid.
2. Dates (from–to, a month calendar; week-offs and holidays inside the range are shown and not counted). Half day (first or second half) in P1.
3. Reason (optional for CL and comp-off, required for unpaid; max 300 characters).
4. Checks shown before sending:
   - Notice: CL needs 2 days' notice (setting); SL can be same day or backdated up to 3 days.
   - Balance: if the request exceeds the balance, "You have 2 casual leaves left. The other 1 day will be unpaid." The staff member confirms.
   - Blackout days: "26 Oct is a no-leave day (wedding season). Urmi may say no." Sending is still allowed.
   - Overlap with an existing request: blocked ("You already asked for 26 Oct.").
5. **Send**. Owner push (high urgency if the leave starts today or tomorrow).

**Owner** decides in Needs action: **Approve** / **Reject** (reason required for reject). Approval writes the leave into the affected days (status L, or LOP for the unpaid part) and the balance ledger. Staff push either way.

| State | Behaviour |
|---|---|
| Staff cancels before a decision | Allowed; owner item disappears |
| Staff cancels after approval | Allowed for future days only; the owner is told |
| Staff checks in on an approved leave day | Confirm dialog; on yes, that day's leave is cancelled, the balance restored, the owner told |
| Month already finalised | Requests touching a finalised month are blocked: "March is closed. Ask Urmi." |

### 4.10 Advances

**Owner records** (P0): Staff profile → Advances → **Give an advance**: amount, date, mode (cash, UPI, bank), reason, recovery plan (**Full next month** default, or N equal monthly instalments, 2–12), first recovery month (default next payroll). Optional staff acknowledgement: the staff member gets an inbox item "Urmi recorded an advance of ₹3,000 on 12 Oct. Recovery: ₹3,000 from October salary." with **That's right** (timestamped) or **Something's wrong** (opens a message to the owner).

**Staff requests** (P1): Requests → **Ask for an advance**: amount, reason, preferred recovery. Owner approves (then records how it was paid) or rejects.

The ledger shows given, recovered per month, carried forward because of the 50% cap (§7.10), and the balance.

### 4.11 Regularisation (fix a day)

Staff → My month → a day → **Something's wrong with this day**, or from a missed-checkout push.

| Kind | Staff enters |
|---|---|
| Forgot to check in | Time they arrived, reason |
| Forgot to check out | Time they left, reason |
| Wrong time recorded | Which punch, the right time, reason |
| Worked at a venue without a duty | Place, times, reason |

Rules: allowed for dates in the last 7 days (setting) and in a month that is not finalised; one open request per day; times must be within 04:00–23:59 of that work date (or the duty window). Owner approves (creates or replaces punches with `source = owner`, audit-logged, day recomputed) or rejects with a reason. An approved fix never creates overtime by itself; overtime still needs its own approval.

### 4.12 Owner approvals (Needs action)

One queue, newest first, grouped by type, with a count badge on the tab and the app icon (`setAppBadge`).

| Item | Shows | Actions |
|---|---|---|
| Flagged punch | Name, time, map pin with the fence circle, distance, accuracy, reasons, selfie thumbnail (tap to compare with the enrolled photo) | **Looks fine** (clears flag), **Reject punch** (reason; day recomputed; staff told) |
| Pending punch | Same + why it is pending | **Approve**, **Reject** |
| New device | Phone label, when, who | **Approve** (step-up), **Reject** |
| Leave request | Type, dates, balance after, blackout warning | **Approve**, **Reject** |
| Regularisation | Day, old vs proposed times | **Approve**, **Reject** |
| Overtime | Day, minutes, the punches; "pre-approved by duty" if so | **Approve all**, **Approve part** (minutes stepper in 15-min blocks), **Reject** |
| Off-site request | Place, map, note | **Approve**, **Approve and let others check in here**, **Reject** |
| Auto-closed day | Day, auto time | **Keep 20:00**, **Change time** |
| Advance request (P1) | Amount, reason, open balance | **Approve**, **Reject** |

- Bulk: select several of the same type → **Approve selected** (not for devices).
- Every decision writes an audit row and notifies the staff member.
- **Owner override** (any day, from the register): set the day status (P, H, A, L-type, WO, HO), add, edit or delete punches, with a required reason. The day shows "Edited by Urmi" with the history.
- Items older than 48 h get a gentle reminder in the morning summary, never a separate nag.

### 4.13 Payroll run

#### 4.13.1 Draft

- On the 1st of each month at 09:00 IST the cron creates the draft for the previous month (or the owner taps **Start payroll** any time after the month ends; a mid-month preview is available as "Payroll so far", read-only).
- The draft computes every active staff member (and anyone who exited in the month) with the engine (§7) and the settings snapshot at that moment.

#### 4.13.2 Blockers

Before finalising, the draft lists what is still open in that month:

| Blocker | Default if the owner proceeds anyway |
|---|---|
| Pending punches | Not counted (as if absent for that punch) |
| Flagged punches not reviewed | Counted as accepted |
| Overtime not decided | Not paid (shown as "pending overtime, not paid") |
| Leave requests not decided | Not applied (days stay as recorded) |
| Regularisations not decided | Not applied |
| Open sessions (no check-out) | Auto-closed per §4.8 |

The owner can resolve them inline or tap **Finalise anyway** after a confirm that lists the defaults above.

#### 4.13.3 Review

A table (desktop) or list of cards (phone), one per person: paid days, LOP days, late/early minutes, overtime approved, gross, deductions, net. Tap a person → their payslip preview with every line and its formula, plus:
- **Add incentive or bonus** (amount, note), **Add other earning**, **Add deduction** (damage needs a show-cause record, §7.9; other deductions need a note).
- **Change advance recovery for this month** (lower it; the rest carries forward).
- **Recompute** after any change in attendance.
- Warnings: minimum-wage check (§7.12), weekly hours over 48 in any week, overtime above 144 h in the quarter, deductions hitting the 50% cap ("₹1,250 of the advance moves to next month").

#### 4.13.4 Finalise

**Finalise March** (step-up PIN) → freezes a JSON snapshot per payslip, locks every `attendance_days` row of the month (`locked = 1`), queues the PDFs, and (setting "Show payslips to staff", default on) notifies staff: "Your March payslip is ready."

#### 4.13.5 Mark paid

Per person or **Mark all paid**: date (default today), mode (cash, UPI, bank transfer), reference (optional). On the 5th (setting "Pay day", 1–7) at 10:00 IST, if anything is unpaid, the owner gets "3 salaries for March are not marked paid. The legal deadline is the 7th."

#### 4.13.6 Reopen

**Reopen** (step-up, reason required) creates revision 2 of the run: unlocks the month, keeps revision 1's PDFs as superseded (still downloadable, watermarked "Replaced by revision 2"). Payslips already marked paid keep their paid record; differences show as "Arrears" or "Recovery" lines in the next month's run if the owner chooses "Settle the difference next month", or the revised amount if "Re-issue this month".

#### 4.13.7 Exit (P1 checklist; P0 data)

Owner → Staff → **Mark as left**: last working day, reason. P0: the person stops getting shifts, devices are revoked, sessions end, and the next payroll includes them pro rata. P1: an exit checklist computes full and final (salary to last day, leave encashment if the policy says so, advance balance) and reminds the owner that the law asks for it within 2 working days.

### 4.14 Payslip PDF and share

- Generated after finalising, one PDF per person, from an HTML template rendered by Cloudflare Browser Run (ADR-07), stored at `payslips/<org>/<yyyy-mm>/<payslipId>-r<revision>.pdf`.
- Contents (Form V style): salon name and address; staff name, code, designation, joining date; month; days in month; counts of P / H / A / L / WO / HO; salary, divisor and per-day rate; earnings (basic earned, overtime, extra for off-day work, incentive, other); deductions (LOP, late/early, advance recovery, fines if on, other); gross, total deductions, net, rounding; payment date and mode; leave balances; a QR and short URL to verify (`/v/<token>`, shows name, month, net and revision, nothing else); "Generated by Feelings Staff on 01 Nov 2026".
- Language: English (P0); Gujarati (P1.1, same template, Noto Sans Gujarati).
- **Share** (owner, per person): Web Share API Level 2 with the PDF file (Android Chrome, iOS Safari); fallback a `wa.me` link to the staff member's number with the text "Your March salary slip: <verify URL>".
- **Staff**: Payslips list → view (HTML version of the same template) → **Download PDF** / **Share**.

| State | Behaviour |
|---|---|
| PDF still generating | "Preparing the PDF…" with the HTML version shown meanwhile |
| Browser Run fails | Retry 3× with backoff (1, 5, 30 min); then the HTML version has **Print or save as PDF** (browser print with a print stylesheet), and the owner gets "1 payslip PDF couldn't be made. The online slip works." |

### 4.15 First-run setup and calibration

#### 4.15.1 Setup checklist (owner, first sign-in)

A one-time checklist; each step can be skipped and finished later from Settings.

1. **Salon**: name (prefilled "Feelings Beauty Care"), address (prefilled), phone.
2. **Location**: map centred on 22.4606479, 70.0565093 with a 100 m circle; **Calibrate** (4.15.2) or **Looks right**.
3. **Opening hours and shift templates**: prefilled Full day 10:00–20:00 (60 min unpaid break), Sunday 10:00–13:00, Morning 10:00–15:00, Evening 15:00–20:00, Split 10:00–14:00 + 17:00–21:00. Edit or delete.
4. **Holidays**: 26 Jan, 15 Aug, 2 Oct + 5 suggested (Uttarayan 14 Jan, Holi, Janmashtami, Dussehra, Diwali) with dates for the current year; blackout days (optional).
5. **Pay rules**: the defaults table (§7.13) with a one-line explanation each; **Use these** or edit.
6. **Selfie on check-in**: off (default) / on.
7. **Add your first staff member** → 4.1.1.
8. **Install and notifications** for the owner's phone.

#### 4.15.2 Geofence calibration

1. Owner stands at the salon counter → **Calibrate**. The app collects fixes for 60 s with `watchPosition` and shows the live accuracy.
2. It asks for the same on 2 more days, ideally with 2 different phones (an Android and an iPhone). Each session is stored in `calibration_samples`.
3. After at least 2 sessions the server proposes C = the median latitude and median longitude of each session's best fix, and R = max(75 m, p95 distance of all fixes from C + 25 m), rounded up to 25 m, capped at 300 m.
4. The map shows the old and new circles. **Use this** (step-up) or **Keep current**.
5. Default before calibration: C = 22.4606479, 70.0565093, R = 100 m, A_max = 50 m. (Never use the old pin 22.470722, 70.057711, which is about 1.1 km off.)

### 4.16 Exports

Owner → Reports. Month picker, staff filter, format.

| Export | CSV | PDF | Columns / content |
|---|---|---|---|
| Attendance register (Form IX-like muster roll) | P0 | P0 | Staff × days with P/H/A/L/WO/HO/OD codes, totals |
| Salary register (Form IV-like) | P0 | P0 | Per person: rate, paid days, earnings, overtime, deductions by kind, advances, net, paid date and mode |
| Punches log | P0 | | Every punch: time, kind, source, site, fence result, distance bucket, risk score and reasons, status, reviewer |
| Late and early report | P0 | | Per person per day: late min, early min, billable, deduction ₹ |
| Overtime report | P0 | | Candidate, approved, rejected minutes; rate; ₹ |
| Leave report and balances | P0 | | Requests and ledger |
| Advances ledger | P0 | | Given, recovered, carried, balance |
| Exceptions log | P0 | | Flags, overrides, auto-closes, device changes |

- CSVs are UTF-8 with a BOM (opens correctly in Excel), dates `DD-MM-YYYY`, money in rupees with 2 decimals, one header row.
- Generated asynchronously (Worker `waitUntil`), stored at `exports/<org>/<exportId>.<ext>` (R2 lifecycle 7 days), downloaded through `GET /api/v1/owner/exports/:id/file` (session-checked; R2 is never public).
- Every export writes an audit row (step-up required).

### 4.17 Settings (owner)

| Section | Contents |
|---|---|
| Salon | Name, address, phone, logo choice (bindi / wordmark), time zone (fixed Asia/Kolkata) |
| Location and door | Site centre, radius, max accuracy, calibration, door devices, strong mode (org and per person), earliest check-in |
| Shifts and roster | Templates; default week-off rules; 48 h weekly warning |
| Holidays and blackout days | Per year list; per holiday "If worked: comp-off / extra pay / both" |
| Attendance rules | Grace, early-leave tolerance, half-day and absent thresholds, make-up time, auto break, break punches, PIN on every punch, selfie (on check-in, on check-out), risk thresholds |
| Pay rules | Divisor, overtime threshold, block and multiplier, off-day work, sandwich rule, advance defaults, pay day, minimum wage, fines (P1), statutory (P2) |
| Leave policy | Types, quotas, accrual, notice, probation, comp-off expiry |
| Notifications | Per event on/off per channel, quiet hours, summary-only mode, WhatsApp fallback (P1) |
| People and roles | Managers and their permissions (P1) |
| Data and privacy | Retention (read-only defaults with a few owner choices), privacy notice text, grievance contact, export all data, delete a former staff member's data |
| Security | Owner email, password + PIN, active sessions (sign out others), audit log |
| App | Default staff language, show payslips to staff, minimum app version (read-only) |

Every settings change is audit-logged with before and after values; pay-rule changes apply from the next payroll draft (the current draft is recomputed only if the owner taps **Recompute**).

---

## 5. Screen inventory

One app, two homes. After sign-in the router sends staff to `/` and owners and managers to `/o/today`. Mobile-first at 390 px; the owner panel adds a desktop layout from 64rem (1024 px). Staff screens are phone-only (they render centred at max 30rem on larger screens).

**Shared states used below**

| State | Pattern |
|---|---|
| Loading | Skeleton blocks in `--bg-tint` that keep the final layout (no spinners on screens). The skeleton breathes at most 6 times, then stays still. Buttons that submit show their label changing ("Checking in…") and are disabled. |
| Offline | A slim banner under the header: "You're offline. Showing what we had at 10:05." Cached data from the service worker (§11.4); actions that need the server are disabled with a reason, except punches (queued). |
| Error | Inline card in place of the content: what happened, in plain words, and one action ("Try again"). Never a raw error code; the request id is in a "Details" disclosure for support. |
| Empty | One short sentence and, where it helps, one action. No illustrations of people; at most the bindi. |

**Copy tone.** Warm, plain, sentence case, short. First names. "Urmi" in staff copy (the owner's display name from settings, not hard-coded). Hinglish is fine where natural ("Chhutti" is not used in v1 English strings; Gujarati strings carry their own idiom). No exclamation marks except the success screen's none. Times as `10:02`, durations as `9 h 05 m`, money as `₹15,000` (Indian grouping, `en-IN`). Never "Oops", never "Something went wrong" alone, never blame ("You failed to…").

### 5.1 Staff app

Bottom tab bar (5): **Today · Month · Requests · Payslips · Me**. The bell in the header opens the inbox. The active tab is marked with the bindi dot.

| Screen (route) | Purpose | Components | Empty / loading / error | Copy examples |
|---|---|---|---|---|
| Invite (`/join/:code`, browser) | Explain install; carry the code | Bindi logo, greeting, platform install sheet, code with Copy, QR (desktop) | Invalid/expired/used code cards (§4.1.3) | "Welcome to the Feelings team, Priya." |
| Join (`/join`, installed) | Phone + code → notice → PIN → device → notifications → waiting | Stepper header (1 of 4), PhoneField, CodeField (auto-format `XXX-XXXXX`), notice card, PinPad ×2, permission card | Wrong code, too many tries, unsupported browser | "Let's set you up." / "Pick a PIN that's harder to guess." |
| Waiting for approval | Hold until the device is approved | Status card with the device label, "We've let Urmi know", **Call Urmi** link | Rejected state | "Urmi needs to approve this phone before you can check in." |
| Sign in (`/signin`) | Phone + PIN on an approved device | PhoneField, PinPad, "I have a new phone", "Forgot PIN?" | Wrong PIN, locked, device not approved | "Welcome back." |
| Install gate | Shown in a browser tab for staff routes | Platform install sheet | | "The staff app works after you add it to your home screen." |
| **Today** (`/`) | Check in/out; today at a glance | Greeting h1 ("Good morning, Priya" + bindi full stop; the sindoor line may appear here once, on the first screen of the day only), shift card ("Full day · 10:00–20:00"), status chip, live hours (tabular numerals, updated each minute), last punch row, off-site duty card if any, queued-punch banner, the one red **Check in / Check out** button in the bottom action bar (glass, safe-area padded), secondary **Start break** (P1) | Loading skeleton; no shift today ("Today is your week off."); on leave ("You're on leave today.") | "You're in since 10:02 · 3 h 14 m so far." |
| Check-in sheet | The punch flow | Bottom sheet (Radix Dialog), step text with accuracy, distance line, CameraView (if selfie), PinPad, result state | All states in §4.3.3–4.3.5 | "Finding you… 42 m accuracy" / "You're in at 10:02." |
| Needs-proof sheet | When the score or fence asks for more | Explanation, **Scan door code**, **I'm at a venue**, **Send to Urmi** (note field) | | "We couldn't confirm you're at the salon." |
| Scan (`/scan`) | Door QR scanner | Camera viewport with a square guide, torch toggle (where supported), manual "Type the code" fallback (10 chars) | Camera denied; wrong code | "Point at the code on the door screen." |
| Fix-it guides | Location, camera, notifications, precise location | Platform-specific steps with screenshots (Android Chrome, iPhone Safari), **Try again** | | "Location is off for this app. Here's how to turn it on." |
| **Month** (`/month`) | My calendar | Month header with prev/next, MonthCalendar (7 columns; each day a status chip with letter + icon; today ringed), totals row (present, half, absent, leave, late minutes, overtime approved), legend | Empty future days; loading skeleton grid | "October · 22 present · 1 half day · 35 min late" |
| Day detail (`/day/:date`) | One day explained | Timeline of punches (time, kind, place, "offline" or "edited by Urmi" tags), shift, worked vs scheduled, late/early/overtime lines with the pay effect ("−₹13.44 for 15 min late"), **Something's wrong with this day** | "No punches on this day." | "Late by 25 min. 10 min grace, so 15 min count." |
| **Requests** (`/requests`) | Leave and fixes | Segmented control (Leave · Fixes · Advances P1), list of requests with status chips, **Ask for leave** / **Fix a day** | "No requests yet." | "Approved by Urmi on 12 Oct." |
| Leave form | Ask for leave | Leave-type chips with balances, DateRange calendar, reason, warnings (notice, balance, blackout), **Send** | Validation inline above fields | "You have 2 casual leaves left. The other 1 day will be unpaid." |
| Fix-a-day form | Regularisation | Kind chips, time pickers (large 24 h wheels or native `input type=time`), reason, **Send** | | "Tell Urmi what happened." |
| **Payslips** (`/payslips`) | My pay | List by month with net amount and paid date | "Your first payslip will appear here after the month closes." | "March · ₹14,032 · paid 3 Apr by UPI" |
| Payslip (`/payslips/:id`) | One payslip | HTML payslip (same template as the PDF), every line with its formula, **Download PDF**, **Share** | PDF preparing state | "₹15,000 ÷ 31 days × 29 paid days" |
| Inbox (`/inbox`) | All notifications | List grouped Today / Earlier, unread dot, tap opens the target | "Nothing new." | |
| **Me** (`/me`) | Profile and settings | Name, role, phone, joining date, language switch (English or Gujarati; the Gujarati option is labelled in Gujarati script), notifications toggle and status, this phone (label, approved on), **My data**, **Privacy notice**, **Sign out** | | |
| My data (`/me/data`) | DPDP rights | Punches with location results (inside / edge / outside, distance bucket), selfies still kept (with deletion dates), consents given, **Ask for a correction**, grievance contact (owner name and phone) | | "Your selfies are deleted after 30 days. The next one goes on 28 Oct." |
| Update toast | New version | Toast: "A new version is ready." **Update** | | |

### 5.2 Owner panel

Phone: bottom tab bar **Today · Needs action · Register · Staff · More** (More: Payroll, Roster, Advances, Reports, Inbox, Show door code, Settings). Desktop (≥ 64rem): a left rail with all items, content max 76rem, the register and payroll tables get full width.

| Screen (route) | Purpose | Components | Empty / loading / error | Copy examples |
|---|---|---|---|---|
| Owner sign-in (`/auth/owner`) | Email link + code; password fallback | EmailField, **Send me a sign-in link**, CodeField (6 digits), "Use password instead" | Expired link; too many codes | "Check your email. Type the 6-digit code here, or tap the link." |
| Setup (`/o/setup`) | First-run checklist | Checklist card list with progress, each opening a focused screen (§4.15.1) | | "Five quick things, then you're ready." |
| **Today** (`/o/today`) | Live board | Date + "updated 10:42" (polls every 30 s while visible; refetch on push), counter chips (Present · Late · Not in yet · On leave · Week off · At a venue; tap filters), Needs-action card with count, **Who's in** list (avatar initials, name, in-time, late badge "+18 m", place badge Inside / Edge / Venue, hours so far), **Not in yet** list (shift start, **Call**, **WhatsApp**), **Checked out** list | Before the first shift: "No one is due yet. First shift starts at 10:00." Sunday/holiday: "Salon closed today (Diwali)." | "Priya is 18 min late. Checked in 10:28 at the salon." |
| **Needs action** (`/o/actions`) | One approvals queue | Filter chips by type with counts, ActionCards (§4.12), bulk select, step-up sheet for devices | "All clear. Nothing waiting." | "New phone for Priya · Redmi Note 12" |
| **Register** (`/o/register`) | Month grid | Month picker; desktop: DataGrid staff × days, sticky first column and header, each cell a letter + icon + tint, row totals (P, H, A, L, late min, OT h, LOP); phone: list of staff with a 7-day strip per week and a tap-through to a person's month | Loading skeleton grid; future days blank | Cell tooltip "Late 25 m · in 10:25 · out 20:04" |
| Day detail (`/o/register/:userId/:date`) | Evidence for one person-day | Timeline of punches with source tags, map (fence circle + pin, lazy Leaflet), accuracy, distance, risk reasons, selfie (tap to compare with enrolled photo), computed lines (worked, late, early, OT, status), **Edit day** (override sheet with reason), audit trail | "No punches. Marked absent at 02:00." | "Edited by Urmi on 3 Nov: status Absent → Present. Reason: 'Was at bridal trial, I asked her to'." |
| **Staff** (`/o/staff`) | People list | Search, filter (active, invited, left), rows with name, role, status, device state, **Add staff** | "Add your first staff member." | |
| Staff profile (`/o/staff/:id`) | One person | Tabs: Overview (today, month summary), Salary (type, amount, divisor override, effective-from history), Shift (template, week-off, strong mode), Leave (balances, ledger, adjust), Advances (ledger), Devices (approved/pending, revoke, reset PIN), Documents (P2), Exit | | "Salary ₹15,000 a month from 1 Apr 2026." |
| Add staff (`/o/staff/new`) | §4.1.1 | Form + share sheet | Duplicate phone, rehire | |
| **Roster** (`/o/roster`) | Week plan | Week grid staff × 7 days showing template or WO/HO/L/duty; tap a cell to change; drag to swap week-offs (desktop) or "Swap with…" (phone); weekly hours per person with a 48 h warning; **Add off-site duty** | | "Neha · 52 h this week, over 48." |
| Off-site duty form (`/o/duties/new`) | §4.6 A | Staff multi-select, date, times, place, location (current / map / paste link), radius stepper, mode chips, overtime toggle | Unparseable link | "Venue duty for Neha, Kajal · 9 Nov 04:00–09:00 · Hotel Aram" |
| **Payroll** (`/o/payroll`) | Runs list | One row per month: status (Draft, Finalised, Paid, Revision 2), totals; **Start payroll** | "Your first payroll will be ready on 1 Nov." | |
| Payroll run (`/o/payroll/:runId`) | Review and finalise | Blockers card, summary (gross, deductions, net, people), table/cards per person, warnings, **Finalise October** (step-up), **Mark all paid**, **Reopen** | Recomputing state | "3 things to check before you finalise." |
| Payslip review (`/o/payroll/:runId/:userId`) | One person's lines | Payslip preview with formulas, add incentive/earning/deduction, change advance recovery, **Share** (after finalise) | | |
| Advances (`/o/advances`) | All advances | Ledger list with balance per person, **Give an advance** | "No advances." | |
| Reports (`/o/reports`) | Exports | Export cards (§4.16) with month and format pickers, recent exports list with download links (7 days) | | |
| Show door code (`/o/door-code`) | Owner phone as the door | Full-screen QR, "New code in 12 s", **Done** | Offline: "You're offline. The door code needs the internet on this phone." | |
| Inbox (`/o/inbox`) | Notifications | As staff | | |
| Settings (`/o/settings/*`) | §4.17 | Sectioned list → focused forms; each change shows a one-line "what this does" | | "Grace: 10 min. Late arrivals within 10 min aren't counted." |
| Audit log (`/o/settings/audit`) | Who changed what | Filterable list: actor, action, entity, before → after, time | | |
| Door screen (`/door`) | Kiosk | QR, countdown text, last check-in line, pairing form if unpaired | Unpaired, clock not synced | "Scan this with the Feelings app to check in." |
| Payslip verify (`/v/:token`, public) | Authenticity check | Salon name, staff first name + initial, month, net, revision, "Valid" | "This payslip link isn't valid." | |

---

## 6. Notification matrix

**Channels.** *In-app*: a row in `notifications` (the inbox, always written, the source of truth). *Push*: Web Push (P0). *WhatsApp*: Cloud API utility template to the owner only (P1, needs Meta setup, Q15). *Email*: Cloudflare Email Service (magic links P0; digests P1).

**Delivery rules**
- Payload ≤ 2 KB, Declarative Web Push shape (`"web_push": 8030`, `notification.title`, `notification.body`, `notification.navigate`, `lang`, `app_badge`) plus `t` (type) and `e` (event id); the service worker always calls `showNotification` inside `event.waitUntil` (Safari removes subscriptions after 3 silent pushes).
- Headers: `TTL` 4 h for alerts, 12 h for summaries; `Urgency: high` for late, not-in-yet, flagged, device and missed check-out; `normal` otherwise. `Topic` (≤ 32 chars) collapses superseded alerts per staff per day, e.g. `notin-<staffId>-<yyyymmdd>` replaced by `late-<staffId>-<yyyymmdd>`.
- **Batching**: owner alerts of the same type within 5 minutes merge into one push ("2 people are late: Priya 18 m, Kajal 12 m").
- **Quiet hours** (owner, default 21:30–08:00 IST): pushes are held and delivered at 08:00 as one summary, except new-device alerts. Staff quiet hours: none by default, but staff reminders are only sent inside their own shift ± 2 h.
- **WhatsApp escalation** (P1, owner opt-in): if a critical push (not-in-yet, flagged needing proof, new device) is not opened within 15 minutes and it is outside quiet hours, send the WhatsApp template. Cap 10 WhatsApp messages a day.
- Failed push handling: `404`/`410` → delete the subscription; `413` → log and send a shorter payload; `429` → retry after `Retry-After` once.
- Every recipient can turn each event's push on or off in their settings (except security events).

| # | Event | Recipient | Channels | Timing | Default copy (title · body) |
|---|---|---|---|---|---|
| N1 | Morning summary | Owner | In-app, push, WhatsApp (P1) | First shift start + 45 min (10:45) | "Today at 10:45" · "8 in · 1 late · 1 not in yet · 1 on leave" |
| N2 | Late check-in | Owner | In-app, push (batched) | On the punch, if in-time > shift start + grace | "Priya is 18 min late" · "Checked in 10:28 at the salon" |
| N3 | Not in yet | Owner | In-app, push, WhatsApp escalation (P1) | Shift start + 30 min, no punch, not on leave/off | "Kajal hasn't checked in" · "Shift started 10:00. Tap to call or WhatsApp." |
| N4 | Check-in reminder | Staff | Push | Shift start + 5 min, no punch | "Your shift started at 10:00" · "Tap to check in." |
| N5 | Flagged punch | Owner | In-app, push (batched) | On the punch (score 30–60) | "Check Priya's check-in" · "Edge of the fence · new phone" |
| N6 | Punch needs proof / approval | Owner | In-app, push, WhatsApp escalation (P1) | 5 min after a pending punch if no QR scanned | "Neha needs approval" · "Checked in 340 m from the salon: 'Patel wedding'" |
| N7 | Punch approved / rejected | Staff | In-app, push | On decision | "Your check-in at 10:04 was approved" / "Urmi didn't accept your 10:04 check-in" · reason |
| N8 | Early check-out | Owner | In-app only (push optional) | On the punch, if out < shift end − early tolerance | "Kajal left at 18:30" · "1 h 30 m before her shift ends" |
| N9 | Overtime running | Owner | In-app, push | Still checked in at shift end + 30 min | "Neha is still working" · "Shift ended 20:00. Approve overtime later in Needs action." |
| N10 | Check-out reminder | Staff | Push | Shift end + 30 min, still in, no duty | "Still at work?" · "Check out when you leave." |
| N11 | Missed check-outs | Owner | In-app, push (batched) | Closing + 60 min (21:00) | "2 people haven't checked out" · "Priya, Kajal" |
| N12 | Day auto-closed | Staff | In-app, push | At auto-close | "We closed your day at 20:00" · "If you left later, tell Urmi." |
| N13 | Leave request | Owner | In-app, push (high if today or tomorrow) | On submit | "Priya asked for leave" · "26–27 Oct · casual · 'Sister's engagement'" |
| N14 | Leave decided | Staff | In-app, push | On decision | "Your leave for 26–27 Oct is approved" / "…wasn't approved" · reason |
| N15 | Regularisation request | Owner | In-app (push optional) | On submit | "Priya asked to fix 14 Oct" · "Forgot to check out. Left at 20:15." |
| N16 | Regularisation decided | Staff | In-app, push | On decision | "Your fix for 14 Oct is approved" |
| N17 | Off-site request | Owner | In-app, push | On submit | "Neha checked in at a venue" · "'Patel wedding, Lal Bungalow'. Approve?" |
| N18 | Off-site duty assigned or changed | Staff | In-app, push | On save; reminder at duty start − 12 h if created earlier | "Venue duty tomorrow 04:00–09:00" · "Hotel Aram" |
| N19 | New device / re-enrolment | Owner | In-app, push (ignores quiet hours), WhatsApp escalation (P1) | On join or new-phone request | "New phone for Priya" · "Approve it before she can check in." |
| N20 | Device approved / rejected | Staff | In-app, push | On decision | "Your phone is approved" · "You can check in now." |
| N21 | Many wrong PIN tries | Owner | In-app, push | 10 wrong tries in 24 h | "Several wrong PIN tries on Priya's account" |
| N22 | Advance recorded | Staff | In-app | On save | "Urmi recorded an advance of ₹3,000" · "Recovery: ₹3,000 from October salary. Is this right?" |
| N23 | Advance request (P1) | Owner | In-app, push | On submit | "Kajal asked for an advance" · "₹2,000 · 'Mother's medicine'" |
| N24 | Payroll draft ready | Owner | In-app, push, email (P1) | 1st of the month 09:00 | "October payroll is ready to check" · "3 things need a look first." |
| N25 | Payslip ready | Staff | In-app, push | On finalise (if payslips shown to staff) | "Your October payslip is ready" |
| N26 | Salary not marked paid | Owner | In-app, push | Pay day (default 5th) 10:00 | "3 salaries for October are not marked paid" · "The legal deadline is the 7th." |
| N27 | Schedule or week-off changed | Staff | In-app, push | On save, if it affects the next 14 days | "Your week off moved to Wednesday 29 Oct" |
| N28 | Holiday announced | Staff (all) | In-app, push | On save | "Salon closed on 8 Nov for Diwali" |
| N29 | Needs-action reminder | Owner | Folded into N1 | Items older than 48 h | Line in the summary: "2 requests are waiting more than 2 days." |
| N30 | Weekly digest (P1) | Owner | Email | Monday 09:00 | "Last week: 94% on time, 6 h overtime approved, 1 leave." |
| N31 | Sign-in link | Owner | Email | On request | Subject "Your Feelings Staff sign-in code: 482913" · link + code, valid 15 min |

Gujarati copy for staff events ships with the Gujarati strings (phase 1.1). Push `lang` follows the recipient's language.

---

## 7. Payroll and time rules

> Not legal advice. The defaults follow the Code on Wages 2019 (in force since 21 Nov 2025) and use the Gujarat Shops and Establishments Act 2019 (as amended in 2026) as a policy template; that Act's main provisions bind only establishments with 20 or more employees. A local CA or labour consultant should confirm the defaults before the first real payroll (Q19).

All rules live in one pure TypeScript package, `packages/engine`, with no I/O. The API loads the data, calls the engine, and stores the result. Every number on a payslip can be reproduced from the stored inputs and the settings snapshot.

### 7.1 Principles

1. **Money is integer paise.** Rates are kept as exact fractions (numerator and denominator as `bigint`) inside a calculation. Each payslip line is rounded **once**, to the nearest paisa, half up. The net is rounded to the nearest rupee, half up, and the difference is shown as a "Rounding" line (never more than ±₹0.50).
2. **Time is integer minutes.** Every punch instant is floored to the minute in IST before calculation (10:10:59 counts as 10:10).
3. **Server time only.** Client clocks are stored for audit and never used for pay (§4.3.6 for offline bounds).
4. **Never pay for less than the time missed** (Code on Wages s.20): absence and undertime deductions are proportional. Anything disproportionate is a fine (§7.9) and is off by default.
5. **No silent changes.** Owner overrides, approvals and rule changes are audit-logged; payroll uses a settings snapshot frozen into the run.
6. **One rule set per org**, with per-person overrides only where the table in §7.14 says so.

### 7.2 Time zone and work date

- IST is Asia/Kolkata, UTC+05:30, no daylight saving. Instants are stored as UTC epoch milliseconds (`INTEGER`). Wall-clock times in templates are `"HH:MM"` strings in IST.
- Cron triggers run in UTC (10:30 IST = 05:00 UTC).
- **Work date of a punch:**
  - An `in` punch belongs to the date of an off-site duty whose window (start − 2 h to end) contains it; otherwise to its IST calendar date.
  - An `out` (or break) punch belongs to the work date of the open `in` it closes.
  - An `in` still open 20 h after it was made is auto-closed (§4.8) and cannot absorb later punches.
- A duty from 22:00 to 02:00 belongs entirely to its start date.

### 7.3 Schedule for a person-day

Resolution order for (person, date), first match wins:

| # | Rule | Day type |
|---|---|---|
| 1 | Date before joining or after the exit date | `NE` (not employed; excluded from everything) |
| 2 | Roster override for that date (a template, `WO`, or "no shift") | as set |
| 3 | Org holiday on that date | `HO` (paid holiday) |
| 4 | The person's weekly off weekday | `WO` (paid weekly off for monthly staff) |
| 5 | The person's default shift template | Working day |

- Approved leave on a working day sets the day to `L` (with its leave type) or LOP. Leave on `WO`/`HO` days is not counted.
- An off-site duty adds a window to the day. On a working day the shift stays the reference; on `WO`/`HO` the day becomes "worked on an off day" if there is presence.
- **Shift template**: one or more segments `[start, end]` (end may be past midnight), `break_min` (unpaid), optional `color`. Defaults:

| Template | Segments | Unpaid break | `S_day` (scheduled minutes) |
|---|---|---|---|
| Full day | 10:00–20:00 | 60 | 540 |
| Sunday | 10:00–13:00 | 0 | 180 |
| Morning | 10:00–15:00 | 0 | 300 |
| Evening | 15:00–20:00 | 0 | 300 |
| Split | 10:00–14:00, 17:00–21:00 | 0 | 480 |

- `S_day` = sum of segment lengths − `break_min`.
- `S_std` = `S_day` of the person's **default** template (their standard day). It is used for hourly rates, so a short Sunday never inflates the overtime rate.

### 7.4 Worked minutes and breaks

- **Presence** = the union of `[in, out)` intervals, minus `[break_start, break_end)` intervals when break punches are on.
- `raw_in` = presence minutes inside the shift segments.
- **Automatic break** (break punches off, the default): `brk = clamp(raw_in − break_after, 0, break_min)`, where `break_after` = 300 min (setting "Take the break off after", default 5 h). After 5 hours of presence, the next `break_min` minutes are treated as the break. This is continuous, so there is no cliff at the threshold.
- **Break punches on** (P1): `brk` = actual break minutes inside the segments. If no break was punched and `raw_in > break_after`, the automatic rule applies and the day carries the note `break_not_punched`. `overbreak = max(0, actual_break − break_min)` counts as undertime.
- `worked = raw_in − brk`.

### 7.5 Late, early, make-up and undertime

For each segment *k* with presence inside it:

- `late_k` = first presence minute in the segment − segment start (0 if they were there at the start).
- `early_k` = segment end − last presence minute in the segment.
- A segment with no presence at all has no late or early minutes; the missing time shows up in the day status instead (§7.7).

Then, with `grace` (default 10) and `early_tolerance` (default 15):

- `late_billable = Σ max(0, late_k − grace)`. Example: 25 min late → 15 billable; 10 min late → 0; 11 min → 1.
- `early_billable = Σ (early_k > early_tolerance ? early_k : 0)`. Example: left 15 min early → 0; left 20 min early → 20.
- `after` = presence minutes after the last segment ends. `before` = presence minutes before the first segment starts.
- **Make-up time** (setting, default on): staying after the shift first pays back that day's undertime. `makeup = min(late_billable + early_billable + overbreak, after_not_preapproved)`, then from pre-approved minutes if needed.
- `undertime = late_billable + early_billable + overbreak − makeup`.
- Undertime is only charged on days with status **P**. A half day or absent day is already paid by the day fraction, so there is no double penalty.
- **Undertime deduction for the day** = `r_day × undertime / S_day` (it uses that day's scheduled minutes, so 15 minutes of a 3-hour Sunday cost the same share of the day as 45 minutes of a 9-hour day).

### 7.6 Overtime

- **Candidates**:
  - `after` minutes not used for make-up count only if they reach the threshold: `after_rest = after − makeup`; counted when `after_rest ≥ ot_threshold` (default 30). Then all of `after_rest` counts, not just the part past 30.
  - `before` minutes count only inside a pre-approved window (an off-site duty with "count hours outside the shift as overtime" on, or an explicit overtime pre-approval). Early arrival on its own is never overtime.
  - Presence inside a pre-approved window needs no threshold.
- **Blocks**: `ot_min = floor(candidate / ot_block) × ot_block` (block default 15 min, rounded down), computed separately for pre-approved and not-pre-approved minutes.
- **Approval**: pre-approved minutes are approved automatically. All others need the owner's decision (approve all, approve part in 15-min steps, reject). Undecided overtime is not paid.
- **Rate**: `ot_hourly = r_day / (S_std / 60)`; **overtime pay** = `ot_hourly × ot_multiplier × ot_min / 60` = `r_day × ot_multiplier × ot_min / S_std`. Multiplier default **2** (Code on Wages s.14). Options: 1, 1.5, 2, flat ₹ per hour, comp-off (every 4 h of approved overtime = 0.5 comp-off day), or tracked but unpaid. Picking anything below 2 shows: "Below 2× may not comply with the Code on Wages."
- **Warnings** (never blocks): more than 48 worked hours in a Monday–Sunday week; more than 144 overtime hours in a calendar quarter.

### 7.7 Day status

For a working day: `ratio = worked / S_day`.

| Ratio | Status | Pay effect (monthly staff) |
|---|---|---|
| ≥ 75% (setting) | **P** present | Full day, minus undertime (§7.5) |
| ≥ 40% and < 75% (setting) | **H** half day | 0.5 LOP day; no minute deductions |
| < 40%, or no presence | **A** absent | 1 LOP day (unless covered by paid leave) |

Other statuses: **L** (paid leave of a type), **LOP** (unpaid leave), **WO** (weekly off), **HO** (holiday), **NE** (not employed). Tags shown with the status: `late`, `early`, `ot`, `offsite`, `offline`, `auto_closed`, `edited`.

**Worked on an off day (WO or HO):** all presence counts, with the automatic break rule. `credit = 1.0` if worked ≥ 75% of `S_std`, `0.5` if ≥ 40%, else the minutes become overtime candidates. Then, per the setting for week-offs (default **comp-off**) or for that holiday (default **extra pay**):
- **Comp-off**: credit days added to the comp-off balance (expire after 60 days).
- **Extra pay**: the day is paid at `offday_multiplier` (default 2) in total. For monthly staff the off day is already paid, so the extra is `r_day × (offday_multiplier − 1) × credit`. For daily-wage staff it is `daily_rate × offday_multiplier × credit`.
- **Both** (holiday option, mirrors Gujarat S&E s.18(7)): extra pay and a comp-off.

The owner can override any status with a reason.

### 7.8 Week-offs, holidays and leave

| Type | Default | Rules |
|---|---|---|
| Weekly off | 1 day per week, fixed weekday per person (rotates across people because the salon opens 7 days) | Paid for monthly staff; unpaid for daily-wage staff unless the setting says so. The owner can swap an off in the roster |
| Festival holidays | 8 a year: 26 Jan, 15 Aug, 2 Oct + 5 owner-chosen | Paid for monthly staff; paid for daily-wage staff by default (setting) |
| Casual leave (CL) | 7 a year, credited 1 Jan, lapses 31 Dec | Joiners get `round_half(7 × months_left_including_joining_month / 12)`; usable after 90 days of service (setting); 2 days' notice |
| Sick leave (SL) | 7 a year, as CL | Same day or backdated up to 3 days; no notice |
| Earned leave (EL, P1) | 1 day per 20 days worked in the previous calendar year, if worked ≥ 240 days | Accumulates up to 63 |
| Comp-off (CO) | Earned per §7.7 | Expires 60 days after it is earned; used oldest first |
| Unpaid leave (LOP) | Unlimited, owner-approved | Counts as LOP days |

- `round_half` rounds to the nearest 0.5.
- **Sandwich rule** (setting, default **off**): when on, WO/HO days that sit between two LOP or absent working days (directly before and after, no worked day between) also become LOP.
- **Blackout days**: leave requests on them are allowed but flagged to the owner.
- Balances are a ledger (`leave_ledger`): credits, debits, adjustments, expiries; the balance is the sum.

### 7.9 Fines and damage (P1, off by default)

- Fines are allowed under the Code on Wages s.19 only for acts listed in a notice approved in advance, after a show-cause step, capped at **3%** of the month's wages, recovered within 90 days, and recorded in a fines register.
- When the owner turns fines on, they must: write the notice text (shown to staff and logged), and choose the rule "N lates beyond grace in a month = ½ day" (N default 3). The fine is `0.5 × r_day` per N lates, counted only on P days.
- Each fine creates a show-cause item for the staff member ("You were late 3 times in October. Under the salon's notice this is a fine of ₹241.94. Anything to say?"). The fine applies only after the staff member acknowledges or 3 days pass, and the owner confirms.
- Monthly fines total ≤ 3% of gross. The excess is dropped (not carried).
- **Damage or loss**: amount ≤ the actual loss, needs a show-cause record, sits in the capped group (§7.10).

### 7.10 Advances and the 50% cap

- An advance is recovered per its plan: the full amount in the first recovery month (default) or N equal instalments (the last one absorbs paise rounding).
- **The cap** (Code on Wages s.18): total deductions in a month ≤ 50% of gross wages `G`.
  1. Absence (LOP) and undertime deductions are applied in full first; they are time not worked.
  2. `room = max(0, 50% × G − absence − undertime)`.
  3. Other deductions are taken from `room` in this order: statutory (P2), fines, damage, other deductions, advance recovery.
  4. What does not fit carries forward: advance recovery to the next month; damage and other deductions to the next month; fines are dropped after 90 days from the fine date.
  5. The payslip shows "₹X of the advance moves to next month" for anything carried.
- If absence and undertime alone exceed 50% of `G`, nothing else is deducted that month and the payroll review shows a note for the owner. (Whether absence counts toward the 50% cap is a point for the CA to confirm, Q19. This default is the more protective reading for the worker.)

### 7.11 Night work

A shift segment or off-site duty that starts before 06:00 or ends after 21:00 shows a "night hours" tag. For each staff member who gets one, the app asks once for a consent tick from them in the app ("I agree to work early-morning or late venue duties when asked."), stored in `consents`. This mirrors the Gujarat S&E 2026 amendment (women may work 21:00–06:00 with consent). It is advisory while the salon has fewer than 20 employees.

### 7.12 Minimum wage check

Setting: on, with the owner entering the current minimum wage for her zone and category (a monthly figure, or a daily figure × 26). The app never hard-codes it. Warning (not a block) when a person's full-attendance monthly pay (monthly salary, or daily rate × 26) is below it: on the staff form, in the payroll review and on the payroll blockers card.

### 7.13 Monthly pay formulas

Symbols: `M` monthly salary; `R` daily rate; `D` days in the month; `E` employed days in the month (join and exit inclusive); `div` divisor days.

| Divisor (setting; per-person override allowed) | `div` |
|---|---|
| **Calendar days** (default) | `D` |
| Fixed 30 | 30 |
| Fixed 26 | 26 |
| Working days | `W` = scheduled working days in the month for that person (excludes WO and HO, includes leave days) |

**Monthly staff**

```
r_day          = M / div
M_pro          = M × E / D                       (calendar proration for joining or leaving mid-month)
LOP_days       = A + 0.5 × H + unpaid_leave_days (+ sandwich days)
absence        = min(M_pro, r_day × LOP_days)
undertime      = Σ_days r_day × undertime_d / S_day_d          (P days only)
overtime       = Σ_days r_day × ot_mult × ot_approved_d / S_std
offday_extra   = Σ r_day × (offday_mult − 1) × credit           (extra-pay mode)
G (gross)      = M_pro + overtime + offday_extra + incentives + other_earnings + arrears
capped         = §7.10 applied to statutory, fines, damage, other, advance
net            = G − absence − undertime − capped
net_rounded    = round_half_up_to_rupee(net);   rounding = net_rounded − net
```

**Daily-wage staff**

```
basic      = R × (P + 0.5 × H + paid_leave_days + paid_holidays + paid_week_offs)
undertime  = Σ_days R × undertime_d / S_day_d
overtime   = Σ_days R × ot_mult × ot_approved_d / S_std
offday     = Σ R × offday_mult × credit                         (extra-pay mode)
G          = basic + overtime + offday + incentives + other_earnings
net        = G − undertime − capped
```

`paid_holidays` is on by default for daily-wage staff; `paid_week_offs` is off by default.

**Mid-month salary change**: the month is split at each `salary_history.effective_from` date inside it; each part is prorated by calendar days exactly like joining (`M_part × days_in_part / D`), and `r_day` for days in each part uses that part's salary.

**Display on the payslip**: rate line "₹15,000 ÷ 31 days = ₹483.87 a day"; "Paid days 29.5 of 31"; each deduction with its formula ("15 min late × ₹0.90 a minute"). Displayed per-minute and per-hour rates are rounded for reading only; the line amounts use exact fractions.

### 7.14 Owner-configurable defaults

| Setting | Default | Options | Per person? |
|---|---|---|---|
| Salary type | Monthly | Daily (per-booking is P2) | Yes |
| Divisor | Calendar days | 30, 26, working days | Yes |
| Grace on check-in | 10 min | 0–30 | No |
| Early-leave tolerance | 15 min | 0–60 | No |
| Make-up time | On | Off | No |
| Present / half-day thresholds | 75% / 40% of `S_day` | Any % | No |
| Take the break off after | 5 h | 3–8 h | No |
| Break punches | Off | On (P1) | No |
| Overtime starts after | Shift end + 30 min | 0–60 min | No |
| Overtime block | 15 min, rounded down | 15, 30, 60 | No |
| Overtime rate | 2× (needs approval) | 1×, 1.5×, flat ₹/h, comp-off, unpaid | Yes (rate only) |
| Week-off worked | Comp-off | Extra pay at 2× total | No |
| Holiday worked | Extra pay at 2× total | Comp-off, both | Per holiday |
| Weekly off | 1 fixed weekday | Any weekday | Yes |
| Festival holidays | 8 (3 national + 5 chosen) | Edit list | No |
| CL / SL / EL | 7 / 7 / 1 per 20 days worked (EL P1) | Edit | No |
| Leave usable after | 90 days | 0–180 | No |
| Comp-off expiry | 60 days | 30–120 | No |
| Sandwich rule | Off | On | No |
| Advance recovery | Full next month, 50% cap | 2–12 instalments | Per advance |
| Fines | Off | On (P1) with notice + 3% cap | No |
| Pay day reminder | 5th | 1–7 | No |
| Minimum-wage check | On (owner enters the figure) | Off | No |
| Earliest check-in | 60 min before shift | 15–180 | No |
| Selfie on check-in | Off | On | Yes |
| Strong mode (door QR always) | Off | On | Yes |
| Geofence radius / max accuracy | 100 m / 50 m | 50–300 / 30–100 | Per site |
| Risk flag / proof thresholds | 30 / 60 | 10–90 | No |

### 7.15 Worked examples

Common setup unless stated: **Priya**, monthly ₹15,000, calendar divisor, **October 2026 (31 days)**, Full day template 10:00–20:00 with a 60-min break (`S_day = S_std = 540`), grace 10, early tolerance 15, make-up on, overtime after 30 min in 15-min blocks at 2×.

`r_day = 15,000 / 31 = ₹483.870967…` (shown as ₹483.87). Per minute = r_day / 540 ≈ ₹0.896. Overtime hour at 2× = 2 × 483.87 / 9 ≈ ₹107.53.

**Example 1: two absent days**

| Line | Working | Amount |
|---|---|---|
| Monthly salary | | ₹15,000.00 |
| LOP | 2 × 15,000/31 | −₹967.74 |
| Net before rounding | | ₹14,032.26 |
| Net paid | rounded | **₹14,032** (rounding −₹0.26) |

**Example 2: late and early**

| Day | Punches | Raw | Billable | Deduction |
|---|---|---|---|---|
| 7 Oct | in 10:25, out 20:00 | late 25 | 25 − 10 = 15 | 483.87 × 15/540 = ₹13.44 |
| 8 Oct | in 10:12, out 20:00 | late 12 | 2 | ₹1.79 |
| 9 Oct | in 10:00, out 19:50 | early 10 | 0 (≤ 15) | ₹0.00 |
| 13 Oct | in 10:00, out 19:40 | early 20 | 20 (> 15) | ₹17.92 |

Each line is computed exactly; the payslip's undertime line rounds the month's exact total once.

**Example 3: half day and the break plateau**

| Punches | `raw_in` | Break taken off | Worked | Ratio | Status | Effect |
|---|---|---|---|---|---|---|
| in 10:00, out 15:00 | 300 | clamp(300 − 300, 0, 60) = 0 | 300 | 55.6% | H | −0.5 day = −₹241.94 |
| in 10:00, out 15:30 | 330 | 30 | 300 | 55.6% | H | same |
| in 10:00, out 17:15 | 435 | 60 | 375 | 69.4% | H | same |
| in 10:00, out 18:15 | 495 | 60 | 435 | 80.6% | P | early 105 min → −₹94.09 |

**Example 4: overtime**

In 09:55, out 22:10. `before` = 5 (not pre-approved, ignored). `after` = 130, no undertime so no make-up, 130 ≥ 30 → floor(130/15) × 15 = **120 min**. Owner approves all.
Overtime pay = 483.87 × 2 × 120/540 = **₹215.05**.

**Example 5: make-up time**

| Punches | Late billable | After | Make-up | Undertime | Overtime candidate | Overtime |
|---|---|---|---|---|---|---|
| in 10:20, out 20:40 | 10 | 40 | 10 | 0 | 30 (≥ 30) | 30 min → ₹53.76 if approved |
| in 10:20, out 20:25 | 10 | 25 | 10 | 0 | 15 (< 30) | 0 |
| in 10:40, out 20:10 | 30 | 10 | 10 | 20 → −₹17.92 | 0 | 0 |

**Example 6: Sunday short shift**

Priya's Sunday template is 10:00–13:00 (`S_day = 180`, no break); her standard day stays 540.
- In 10:15, out 13:00: late 15, billable 5 → 483.87 × 5/180 = **₹13.44** (5 min is the same share of a 3-hour day as 15 min of a 9-hour day).
- In 10:00, out 13:50: after 50 → 45 min overtime → uses `S_std`: 483.87 × 2 × 45/540 = **₹80.65** (not inflated by the short day).

**Example 7: advance and the 50% cap**

**Kajal**, monthly ₹12,000, **November 2026 (30 days)**, 9 absent days, advance ₹6,000 with full recovery planned.

| Line | Working | Amount |
|---|---|---|
| Gross `G` | | ₹12,000.00 |
| LOP | 9 × 12,000/30 = 9 × 400 | −₹3,600.00 |
| Cap | 50% × 12,000 | ₹6,000.00 |
| Room for other deductions | 6,000 − 3,600 | ₹2,400.00 |
| Advance recovered | min(6,000, 2,400) | −₹2,400.00 |
| Carried to December | | ₹3,600.00 |
| Net | 12,000 − 3,600 − 2,400 | **₹6,000** |

**Example 8: joining mid-month on a fixed-26 divisor**

**Neha**, monthly ₹13,000, divisor fixed 26, joined **12 Oct 2026** → E = 20 of 31 days. 1 absent day.

| Line | Working | Amount |
|---|---|---|
| Salary for days employed | 13,000 × 20/31 | ₹8,387.10 |
| LOP | 1 × 13,000/26 | −₹500.00 |
| Net | | ₹7,887.10 → **₹7,887** |

**Example 9: working the weekly off**

Priya's off is Tuesday. On Tue 20 Oct she works 10:00–19:30: presence 570, break 60 → worked 510 = 94% of `S_std` → credit 1.0.
- Comp-off mode (default): +1 comp-off day, expires 19 Dec 2026. No pay change.
- Extra-pay mode at 2× total: extra = 483.87 × (2 − 1) × 1 = **₹483.87**.

**Example 10: daily-wage staff**

**Meena**, helper, ₹550 a day, October 2026: 24 present, 2 half days, 2 Oct holiday (paid for daily staff by default), 4 week-offs (unpaid by default), no absences.
Basic = 550 × (24 + 0.5 × 2 + 1) = 550 × 26 = **₹14,300**.

**Example 11: a full month on one payslip**

Priya, October 2026: 1 absent, 1 half day; late billable 47 min on full days and 5 min on a Sunday; 150 min overtime approved; incentive ₹500; advance ₹3,000 to recover in full.

| Line | Working | Amount |
|---|---|---|
| Salary | | ₹15,000.00 |
| Overtime | 483.87 × 2 × 150/540 | ₹268.82 |
| Incentive | | ₹500.00 |
| **Gross** | | **₹15,768.82** |
| LOP | 1.5 × 483.87 | −₹725.81 |
| Late/early | 483.87 × 47/540 + 483.87 × 5/180 (exact sum, rounded once) | −₹55.56 |
| Cap check | 50% × 15,768.82 = 7,884.41; room 7,884.41 − 781.37 = 7,103.04 | |
| Advance recovery | min(3,000, 7,103.04) | −₹3,000.00 |
| Net before rounding | | ₹11,987.45 |
| **Net paid** | rounded | **₹11,987** (rounding −₹0.45) |

**Example 12: fines turned on (P1)**

Rule "3 lates beyond grace = ½ day". Priya has 4 such lates in October → 1 fine = 0.5 × 483.87 = **₹241.94**. Cap 3% × 15,000 = ₹450 → allowed, after her show-cause acknowledgement. The 4th late counts toward nothing (no partial fines).

### 7.16 Engine contract

`packages/engine` exports pure functions (types live in `packages/contracts`):

```ts
resolveSchedule(person: PersonPolicy, date: WorkDate, ctx: OrgCalendar): DaySchedule
computeDay(input: {
  schedule: DaySchedule; punches: PunchForCalc[]; preapprovals: OtWindow[];
  leave: LeaveOnDay | null; rules: TimeRules; override: DayOverride | null;
}): DayResult   // worked, brk, late, early, makeup, undertime, ot candidates, status, credit, tags
computePayslip(input: {
  person: PersonPay; month: YearMonth; days: DayResult[]; approvals: OtDecision[];
  advances: AdvanceSchedule[]; adjustments: Adjustment[]; fines: Fine[];
  rules: PayRules; carryIn: CarryForward;
}): PayslipResult  // lines[] with code, label, formula, amountPaise; totals; carryOut; warnings
riskScore(input: RiskInput): { score: number; reasons: RiskReason[]; outcome: 'accept'|'flag'|'proof'|'block' }
fenceCheck(fix: Fix, site: Site): { result: 'pass'|'uncertain'|'outside'|'approximate'; distanceM: number }
```

Every function is deterministic for its inputs. `DayResult` and `PayslipResult` carry a `version` (engine semver) so stored results can be traced to the code that made them.

---

## 8. Data model

### 8.1 Conventions

- One D1 database per environment: `fbc-staff` (production, location hint `apac`) and `fbc-staff-preview` (previews and CI smoke). Bound as `DB`.
- IDs are ULIDs (26-char `TEXT`, time-sortable), generated in the Worker.
- Instants are `INTEGER` UTC epoch milliseconds (`*_at`, `*_ts`). Local dates are `TEXT` `YYYY-MM-DD` (`*_date`). Months are `TEXT` `YYYY-MM`.
- Money is `INTEGER` paise (`*_paise`). Day counts that can be halves are `REAL` restricted to multiples of 0.5 by a `CHECK`.
- Booleans are `INTEGER` 0/1. JSON is `TEXT` with `CHECK (json_valid(col))`.
- **Every table except `orgs` and `app_meta` has `org_id`**, and every query goes through the data-access layer that injects it (§10.8). Foreign keys are enforced (D1 default).
- Migrations live in `migrations/` as `NNNN_name.sql`, applied with `wrangler d1 migrations apply`. `0001_init.sql` is the schema below; later changes are new files, never edits.

### 8.2 Schema (`migrations/0001_init.sql`)

```sql
-- Tenancy and people ------------------------------------------------------
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  owner_display_name TEXT NOT NULL,          -- "Urmi" in staff copy
  address TEXT,
  phone_e164 TEXT,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  settings_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  name TEXT NOT NULL,
  phone_e164 TEXT,                            -- required for staff and managers
  email TEXT,                                 -- required for the owner
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','gu')),
  status TEXT NOT NULL CHECK (status IN ('invited','active','suspended','exited')),
  pin_hash TEXT, pin_salt TEXT, pin_set_at INTEGER,
  pin_failures INTEGER NOT NULL DEFAULT 0,
  pin_failures_24h INTEGER NOT NULL DEFAULT 0,
  pin_window_start INTEGER,
  pin_locked_until INTEGER,
  password_hash TEXT, password_salt TEXT, password_iter INTEGER,
  permissions_json TEXT CHECK (permissions_json IS NULL OR json_valid(permissions_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  exited_at INTEGER
);
CREATE UNIQUE INDEX users_org_phone ON users(org_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND status <> 'exited';
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX users_org_role ON users(org_id, role, status);

CREATE TABLE shift_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  segments_json TEXT NOT NULL CHECK (json_valid(segments_json)), -- [{"start":"10:00","end":"20:00"}]
  break_min INTEGER NOT NULL DEFAULT 0 CHECK (break_min BETWEEN 0 AND 180),
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX shift_templates_org ON shift_templates(org_id, active);

CREATE TABLE staff_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  employee_code TEXT,
  designation TEXT NOT NULL,
  join_date TEXT NOT NULL,
  exit_date TEXT,
  exit_reason TEXT,
  default_template_id TEXT NOT NULL REFERENCES shift_templates(id),
  week_off_dow INTEGER CHECK (week_off_dow BETWEEN 0 AND 6),   -- 0 = Sunday
  selfie_required INTEGER,                     -- NULL = org default
  strong_mode INTEGER NOT NULL DEFAULT 0,
  divisor_override TEXT CHECK (divisor_override IN ('calendar','fixed30','fixed26','working')),
  ot_rate_override_json TEXT CHECK (ot_rate_override_json IS NULL OR json_valid(ot_rate_override_json)),
  enrolled_photo_key TEXT,                     -- R2 key, only if selfies are on
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX staff_profiles_org ON staff_profiles(org_id);

CREATE TABLE salary_history (                  -- effective-dated pay
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  effective_from TEXT NOT NULL,                -- YYYY-MM-DD
  salary_type TEXT NOT NULL CHECK (salary_type IN ('monthly','daily')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX salary_history_user ON salary_history(user_id, effective_from);

-- Auth --------------------------------------------------------------------
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,              -- HMAC(SESSION_SECRET, code)
  purpose TEXT NOT NULL CHECK (purpose IN ('join','pin_reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  failed_tries INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_user ON invites(user_id, created_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  public_jwk TEXT NOT NULL CHECK (json_valid(public_jwk)),
  jwk_thumbprint TEXT NOT NULL UNIQUE,         -- RFC 7638
  label TEXT NOT NULL,                         -- "Redmi Note 12 · Chrome"
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','desktop','other')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
  requested_at INTEGER NOT NULL,
  decided_at INTEGER, decided_by TEXT,
  approved_at INTEGER,
  revoked_reason TEXT,
  last_seen_at INTEGER
);
CREATE UNIQUE INDEX devices_one_approved ON devices(user_id) WHERE status = 'approved';
CREATE INDEX devices_org_status ON devices(org_id, status);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                 -- SHA-256 of the cookie token
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('user','door')),
  user_id TEXT REFERENCES users(id),
  device_id TEXT,                              -- devices.id or door_devices.id
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  step_up_until INTEGER,
  ip_hmac TEXT,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE challenges (                      -- login challenges and punch nonces
  nonce TEXT PRIMARY KEY,                      -- 32 random bytes, base64url
  org_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','punch','offline')),
  user_id TEXT, device_id TEXT,
  expires_at INTEGER NOT NULL,                 -- 5 min (login, punch), 24 h (offline)
  used_at INTEGER
);
CREATE INDEX challenges_expiry ON challenges(expires_at);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  ip_hmac TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX magic_links_email ON magic_links(email, created_at);

-- Places ------------------------------------------------------------------
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('salon','venue')),
  name TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  radius_m INTEGER NOT NULL CHECK (radius_m BETWEEN 50 AND 500),
  max_accuracy_m INTEGER NOT NULL CHECK (max_accuracy_m BETWEEN 30 AND 100),
  active INTEGER NOT NULL DEFAULT 1,
  valid_from INTEGER, valid_to INTEGER,        -- venues only
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sites_org ON sites(org_id, kind, active);

CREATE TABLE door_devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  label TEXT NOT NULL,
  secret_enc TEXT NOT NULL,                    -- AES-GCM with QR_MASTER_KEY
  secret_version INTEGER NOT NULL DEFAULT 1,
  pairing_code_hash TEXT, pairing_expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pairing','active','revoked')),
  paired_at INTEGER, last_seen_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE calibration_samples (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  session_id TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, accuracy_m REAL NOT NULL,
  platform TEXT, taken_at INTEGER NOT NULL
);
CREATE INDEX calibration_site ON calibration_samples(site_id, session_id);

CREATE TABLE salon_networks (                  -- positive risk signal
  org_id TEXT NOT NULL,
  ip_hmac TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (org_id, ip_hmac)
);

-- Schedule ----------------------------------------------------------------
CREATE TABLE roster_overrides (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('template','week_off','no_shift')),
  template_id TEXT REFERENCES shift_templates(id),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX roster_org_date ON roster_overrides(org_id, work_date);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1,
  worked_comp TEXT NOT NULL DEFAULT 'extra_pay' CHECK (worked_comp IN ('comp_off','extra_pay','both')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX holidays_org_date ON holidays(org_id, date);

CREATE TABLE blackout_days (
  org_id TEXT NOT NULL, date TEXT NOT NULL, note TEXT,
  PRIMARY KEY (org_id, date)
);

CREATE TABLE offsite_duties (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT REFERENCES sites(id),          -- NULL for mode 'anywhere'
  work_date TEXT NOT NULL,
  start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL CHECK (end_ts > start_ts),
  mode TEXT NOT NULL CHECK (mode IN ('geofence','anywhere','approval')),
  ot_preapproved INTEGER NOT NULL DEFAULT 1,
  place_name TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX offsite_org_date ON offsite_duties(org_id, work_date);
CREATE TABLE offsite_duty_staff (
  duty_id TEXT NOT NULL REFERENCES offsite_duties(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (duty_id, user_id)
);
CREATE INDEX offsite_staff_user ON offsite_duty_staff(user_id);

CREATE TABLE ot_preapprovals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
  note TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX ot_pre_user_date ON ot_preapprovals(user_id, work_date);

-- Attendance --------------------------------------------------------------
CREATE TABLE punches (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT,                              -- NULL for owner/auto
  kind TEXT NOT NULL CHECK (kind IN ('in','out','break_start','break_end')),
  server_ts INTEGER NOT NULL,                  -- first receipt
  effective_ts INTEGER NOT NULL,               -- the time used for pay
  client_ts INTEGER,
  work_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('online','offline','owner','auto')),
  site_id TEXT REFERENCES sites(id),
  offsite_duty_id TEXT REFERENCES offsite_duties(id),
  place_name TEXT,                             -- unplanned venue
  lat REAL, lng REAL,                          -- best fix, 5 decimals; NULLed after 90 days
  accuracy_m REAL,
  distance_m INTEGER,
  distance_bucket TEXT CHECK (distance_bucket IN ('0-50','50-100','100-200','200-500','500+')),
  fence_result TEXT CHECK (fence_result IN ('pass','uncertain','outside','approximate','none')),
  samples_n INTEGER, samples_spread_m REAL,
  qr_step INTEGER,                             -- floor(t/30) of the accepted door token
  pin_verified INTEGER NOT NULL DEFAULT 0,
  sig_verified INTEGER NOT NULL DEFAULT 0,
  selfie_key TEXT, selfie_sha256 TEXT, selfie_deleted_at INTEGER,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risk_reasons_json)),
  status TEXT NOT NULL CHECK (status IN ('accepted','flagged','pending','rejected','superseded')),
  pending_reason TEXT,
  ip_country TEXT, ip_asn INTEGER,
  device_tz TEXT, clock_skew_ms INTEGER,
  app_version TEXT, client_duration_ms INTEGER,
  idempotency_key TEXT NOT NULL,
  note TEXT,
  reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT,
  replaces_punch_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX punches_idem ON punches(user_id, idempotency_key);
CREATE UNIQUE INDEX punches_qr_once ON punches(user_id, qr_step) WHERE qr_step IS NOT NULL;
CREATE INDEX punches_user_date ON punches(user_id, work_date);
CREATE INDEX punches_org_date ON punches(org_id, work_date);
CREATE INDEX punches_review ON punches(org_id, status) WHERE status IN ('flagged','pending');

CREATE TABLE attendance_days (                 -- derived, recomputed by the engine
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('work','WO','HO','NE')),
  template_id TEXT,
  scheduled_min INTEGER NOT NULL DEFAULT 0,
  worked_min INTEGER NOT NULL DEFAULT 0,
  break_min INTEGER NOT NULL DEFAULT 0,
  late_min INTEGER NOT NULL DEFAULT 0, late_billable_min INTEGER NOT NULL DEFAULT 0,
  early_min INTEGER NOT NULL DEFAULT 0, early_billable_min INTEGER NOT NULL DEFAULT 0,
  overbreak_min INTEGER NOT NULL DEFAULT 0,
  makeup_min INTEGER NOT NULL DEFAULT 0,
  undertime_min INTEGER NOT NULL DEFAULT 0,
  ot_preapproved_min INTEGER NOT NULL DEFAULT 0,
  ot_candidate_min INTEGER NOT NULL DEFAULT 0,
  ot_approved_min INTEGER NOT NULL DEFAULT 0,
  ot_status TEXT NOT NULL DEFAULT 'none' CHECK (ot_status IN ('none','pending','approved','partial','rejected')),
  status TEXT NOT NULL CHECK (status IN ('P','H','A','L','LOP','WO','HO','NE','OPEN')),
  leave_type_code TEXT,
  offday_credit REAL NOT NULL DEFAULT 0 CHECK (offday_credit IN (0, 0.5, 1)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  override_json TEXT CHECK (override_json IS NULL OR json_valid(override_json)),
  engine_version TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  payroll_run_id TEXT,
  PRIMARY KEY (user_id, work_date)
);
CREATE INDEX attendance_org_date ON attendance_days(org_id, work_date);
CREATE INDEX attendance_org_status ON attendance_days(org_id, status, work_date);

CREATE TABLE ot_decisions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL, work_date TEXT NOT NULL,
  candidate_min INTEGER NOT NULL, approved_min INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','partial','rejected','auto')),
  decided_by TEXT, decided_at INTEGER NOT NULL, note TEXT
);
CREATE INDEX ot_decisions_user_date ON ot_decisions(user_id, work_date);

CREATE TABLE regularisations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('missed_in','missed_out','wrong_time','offsite_unplanned')),
  target_punch_id TEXT,
  proposed_in_ts INTEGER, proposed_out_ts INTEGER,
  place_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT, decided_at INTEGER, decision_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX regularisation_open ON regularisations(user_id, work_date) WHERE status = 'pending';
CREATE INDEX regularisation_org ON regularisations(org_id, status);

-- Leave -------------------------------------------------------------------
CREATE TABLE leave_types (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  code TEXT NOT NULL CHECK (code IN ('CL','SL','EL','CO','LOP')),
  name TEXT NOT NULL,
  paid INTEGER NOT NULL,
  annual_quota REAL,
  accrual TEXT NOT NULL CHECK (accrual IN ('annual','earned','event','none')),
  carry_max REAL,
  usable_after_days INTEGER NOT NULL DEFAULT 0,
  notice_days INTEGER NOT NULL DEFAULT 0,
  backdate_days INTEGER NOT NULL DEFAULT 0,
  expiry_days INTEGER,                         -- comp-off
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX leave_types_org_code ON leave_types(org_id, code);

CREATE TABLE leave_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','debit','expire','adjust')),
  days REAL NOT NULL CHECK (days * 2 = CAST(days * 2 AS INTEGER)),
  ref_type TEXT, ref_id TEXT,
  expires_on TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX leave_ledger_user ON leave_ledger(user_id, leave_type_id, entry_date);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  half TEXT NOT NULL DEFAULT 'none' CHECK (half IN ('none','first','second')),
  days_paid REAL NOT NULL, days_unpaid REAL NOT NULL,
  reason TEXT,
  blackout_hit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT, decided_at INTEGER, decision_note TEXT,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX leave_requests_org ON leave_requests(org_id, status, from_date);
CREATE INDEX leave_requests_user ON leave_requests(user_id, from_date);

-- Money -------------------------------------------------------------------
CREATE TABLE advances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  given_on TEXT,
  mode TEXT CHECK (mode IN ('cash','upi','bank')),
  reason TEXT,
  plan TEXT NOT NULL CHECK (plan IN ('full','instalments')),
  instalments_n INTEGER CHECK (instalments_n BETWEEN 1 AND 12),
  first_month TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','active','closed','rejected','cancelled')),
  staff_ack TEXT NOT NULL DEFAULT 'pending' CHECK (staff_ack IN ('pending','confirmed','disputed')),
  staff_ack_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX advances_user ON advances(user_id, status);

CREATE TABLE advance_recoveries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  advance_id TEXT NOT NULL REFERENCES advances(id),
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL,
  scheduled_paise INTEGER NOT NULL,
  recovered_paise INTEGER NOT NULL,
  carried_paise INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX advance_recovery_once ON advance_recoveries(advance_id, payroll_run_id);

CREATE TABLE fines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL,
  month TEXT NOT NULL, rule_code TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  show_cause_at INTEGER NOT NULL,
  staff_response TEXT, acknowledged_at INTEGER, owner_confirmed_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed','applied','waived','lapsed')),
  payroll_run_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  month TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft','finalised','superseded')),
  settings_snapshot_json TEXT NOT NULL CHECK (json_valid(settings_snapshot_json)),
  engine_version TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  opened_at INTEGER,
  finalised_by TEXT, finalised_at INTEGER,
  reopened_reason TEXT
);
CREATE UNIQUE INDEX payroll_runs_month ON payroll_runs(org_id, month, revision);

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incentive','bonus','other_earning','arrears','damage','other_deduction','recovery')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note TEXT NOT NULL,
  show_cause_ref TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX adjustments_run_user ON adjustments(payroll_run_id, user_id);

CREATE TABLE payslips (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)), -- PayslipResult + display data
  gross_paise INTEGER NOT NULL, deductions_paise INTEGER NOT NULL,
  net_paise INTEGER NOT NULL, rounding_paise INTEGER NOT NULL,
  pdf_key TEXT,
  pdf_status TEXT NOT NULL DEFAULT 'pending' CHECK (pdf_status IN ('pending','ready','failed')),
  verify_token TEXT NOT NULL UNIQUE,
  paid_on TEXT, pay_mode TEXT CHECK (pay_mode IN ('cash','upi','bank')), pay_ref TEXT,
  paid_marked_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX payslips_run_user ON payslips(payroll_run_id, user_id);
CREATE INDEX payslips_user ON payslips(user_id, created_at);

-- Notifications, consent, audit, ops ---------------------------------------
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT REFERENCES users(id),
  device_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  platform TEXT,
  created_at INTEGER NOT NULL,
  last_success_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subs_user ON push_subscriptions(user_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                          -- N1..N31 codes, e.g. 'late_checkin'
  title TEXT NOT NULL, body TEXT,
  url TEXT NOT NULL,
  data_json TEXT CHECK (data_json IS NULL OR json_valid(data_json)),
  priority TEXT NOT NULL CHECK (priority IN ('high','normal')),
  topic TEXT, batch_key TEXT,
  push_status TEXT NOT NULL DEFAULT 'none' CHECK (push_status IN ('none','held','queued','sent','failed')),
  push_sent_at INTEGER, opened_at INTEGER,
  wa_status TEXT, email_status TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);
CREATE INDEX notifications_held ON notifications(org_id, push_status) WHERE push_status = 'held';

CREATE TABLE notification_prefs (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  push INTEGER NOT NULL DEFAULT 1,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  email INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_type)
);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('privacy_notice','selfie','night_work','fines_notice')),
  version TEXT NOT NULL, lang TEXT NOT NULL,
  accepted_at INTEGER NOT NULL, withdrawn_at INTEGER
);
CREATE INDEX consents_user ON consents(user_id, kind);

CREATE TABLE audit_log (                       -- append-only: no UPDATE or DELETE except retention
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('change','security','access','export')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system','door')),
  actor_id TEXT,
  action TEXT NOT NULL,                        -- e.g. 'punch.reject', 'settings.update'
  entity TEXT NOT NULL, entity_id TEXT,
  before_json TEXT, after_json TEXT,
  reason TEXT,
  ip_hmac TEXT, request_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_org_time ON audit_log(org_id, created_at);
CREATE INDEX audit_entity ON audit_log(entity, entity_id);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL, format TEXT NOT NULL CHECK (format IN ('csv','pdf')),
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','ready','failed')),
  r2_key TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE cron_runs (                       -- idempotency for scheduled rules
  job TEXT NOT NULL, org_id TEXT NOT NULL, slot TEXT NOT NULL,   -- slot: e.g. '2026-10-19|late|<userId>'
  ran_at INTEGER NOT NULL, result TEXT,
  PRIMARY KEY (job, org_id, slot)
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- min_app_version, schema notes
```

**Mid-month salary change**: the engine splits the month at each `salary_history.effective_from` inside it and prorates each part by calendar days, exactly like joining (§7.13).

**Settings JSON** (`orgs.settings_json`) is validated by the `OrgSettings` zod schema in `packages/contracts`; it holds every value in §7.14 plus notification, quiet-hours, risk and retention settings. Shape versioned by `settings_version`.

### 8.3 Retention

| Data | Kept | Then | Job |
|---|---|---|---|
| `punches.lat`, `lng`, `accuracy_m`, `distance_m` | 90 days | Set to NULL; keep `fence_result`, `distance_bucket`, `risk_*` | Nightly purge |
| Selfies (R2 `selfies/`) | 30 days | R2 lifecycle deletes; nightly job sets `selfie_deleted_at` | R2 rule + nightly |
| Disputed selfies (R2 `hold/`) | Until the dispute is decided + 30 days | Deleted | Nightly |
| Attendance, payslips, advances, fines, leave, payroll runs, salary history | 5 years after the last entry of that person | Deleted | Monthly purge |
| Audit log `change` and `export` rows | 5 years (part of wage records) | Deleted | Monthly |
| Audit log `security` and `access` rows | 1 year (DPDP Rules 2025, Rule 8(3)) | Deleted | Nightly |
| Sessions, challenges, magic links | Until expiry + 7 days | Deleted | Nightly |
| Notifications | 180 days | Deleted | Nightly |
| Push subscriptions | Until 410/404, device revoked, or staff exit | Deleted at once | On event |
| Devices | Until revoked + 30 days | Deleted (keep id for audit references) | Nightly |
| Calibration samples | 30 days after the calibration is applied | Deleted | Nightly |
| Salon network IPs (HMAC) | 7 days since last seen | Deleted | Nightly |
| Exports (R2 `exports/`) | 7 days | R2 lifecycle | R2 rule |
| Staff profile after exit | Statutory fields (name, code, designation, dates, wage records) 5 years; phone, photo, consents detail deleted 30 days after exit | Partial delete | Nightly |

### 8.4 R2 layout

Bucket `fbc-staff-media` (production) and `fbc-staff-media-preview`. Private; no public access, no custom domain. Objects are served only through Worker routes that check the session.

| Prefix | Content | Lifecycle rule |
|---|---|---|
| `selfies/<orgId>/<yyyy>/<mm>/<dd>/<punchId>.jpg` | Check-in selfies, JPEG ~480 px | Delete after 30 days |
| `hold/<orgId>/<punchId>.jpg` | Selfies under dispute (copied from `selfies/`) | None (nightly job) |
| `photos/<orgId>/<userId>.jpg` | Enrolled reference photo (only if selfies are on) | None (deleted on exit + 30 days) |
| `payslips/<orgId>/<yyyy-mm>/<payslipId>-r<rev>.pdf` | Payslip PDFs | None (5-year purge job) |
| `exports/<orgId>/<exportId>.<csv\|pdf>` | Report exports | Delete after 7 days |
| `backups/d1/<yyyy-mm-dd>.sql.gz` (P1) | Weekly D1 export | Delete after 90 days |

Object metadata: `content-type`, `x-org-id`, `x-sha256`. Selfie thumbnails for the owner are served at `GET /api/v1/owner/punches/:id/selfie` with `Cache-Control: private, max-age=604800`.

---

## 9. API

### 9.1 Conventions

- Base path `/api/v1`. JSON in and out (`application/json; charset=utf-8`), except `POST /punches` (multipart) and file downloads.
- Hono app in `app/worker/`. Every route validates its input with a zod schema from `packages/contracts` via `@hono/zod-validator`; responses are typed with the same package (`ApiResponse<T>`), and the client uses the same types.
- **Auth**: a session cookie `fs_session` (32 random bytes, base64url; `HttpOnly; Secure; SameSite=Strict; Path=/`; staff 30 days sliding, owner and manager 14 days sliding, door 365 days). The server stores only its SHA-256.
- **CSRF**: `SameSite=Strict` plus, for every non-GET request, an `Origin` header that equals the app origin, and a custom header `X-FS-Client: <appVersion>`. Missing or wrong → 403 `CSRF`.
- **Versioning**: the client sends `X-FS-Client`; if it is below `app_meta.min_app_version` the API answers 426 `UPGRADE_REQUIRED`.
- **Idempotency**: `POST /punches`, decision endpoints and payroll actions accept an `Idempotency-Key` header; a repeat returns the first response.
- **Times** in JSON are epoch ms (`*At`, `*Ts`), dates `YYYY-MM-DD`, money integer paise (`*Paise`).
- **Request id**: every response has `X-Request-Id`; logs carry it.

### 9.2 Error shape

```json
{ "error": { "code": "PIN_WRONG", "message": "Wrong PIN. 3 tries left.",
             "details": { "triesLeft": 3 }, "requestId": "01JB…" } }
```

`message` is safe to show; the client maps `code` to translated copy where it has one.

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION` (details: zod issues by path), `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED`, `PIN_WRONG`, `CODE_WRONG`, `SIGNATURE_INVALID` |
| 403 | `FORBIDDEN` (role/permission), `CSRF`, `DEVICE_NOT_APPROVED`, `ACCOUNT_INACTIVE`, `STEP_UP_REQUIRED`, `INSTALL_REQUIRED` |
| 404 | `NOT_FOUND` (also for other orgs' ids; never 403 for cross-tenant) |
| 409 | `CONFLICT`, `NONCE_INVALID`, `ALREADY_DECIDED`, `MONTH_LOCKED`, `DUPLICATE` |
| 410 | `INVITE_EXPIRED`, `LINK_EXPIRED` |
| 413 | `PAYLOAD_TOO_LARGE` (selfie > 200 KB) |
| 422 | `LOCATION_APPROXIMATE`, `OUTSIDE_FENCE`, `TOO_EARLY`, `RULE_VIOLATION` (details explain) |
| 423 | `PIN_LOCKED` (details: `until`) |
| 426 | `UPGRADE_REQUIRED` |
| 429 | `RATE_LIMITED` (header `Retry-After`) |
| 500 / 503 | `INTERNAL`, `UNAVAILABLE` (never leak stack traces) |

### 9.3 Rate limits

Short windows use the Workers rate-limit binding (periods of 10 or 60 s; counts are per Cloudflare location, so they are a first line only). Lockouts that must hold for minutes or hours are counted in D1.

| Scope | Limit | Mechanism |
|---|---|---|
| Any request per IP | 300 / 60 s | Binding `RL_IP` |
| Authenticated API per session | 120 / 60 s | Binding `RL_SESSION` |
| PIN tries per user | 5 wrong → 15 min lock; 10 wrong in 24 h → owner alert | D1 (`users.pin_*`) |
| Join code tries per phone | 5 / hour | D1 (`invites.failed_tries` + window) |
| Magic link requests | 3 per email per 15 min; 10 per IP per hour | D1 count on `magic_links` |
| Magic code tries per link | 5, then the link dies | D1 |
| Punch submissions per user | 6 / 60 s | Binding `RL_PUNCH` |
| Exports per org | 10 / hour | D1 count on `exports` |
| Door status per door device | 12 / 60 s | Binding |
| Google Maps link resolve per org | 20 / hour | D1 |

### 9.4 Endpoints

Roles: **P** public, **S** staff, **M** manager (with the named permission), **O** owner, **D** door device, **T** test-only (preview and local, `E2E_TOKEN` header). "Step-up" means the owner PIN within the last 10 minutes. Schema names refer to `packages/contracts`.

**System and auth**

| Method and path | Role | Request → response | Notes |
|---|---|---|---|
| `GET /health` | P | → `{ ok, version, commit }` | No DB call |
| `GET /config` | P | → `{ minAppVersion, vapidPublicKey, punchEncPublicJwk, orgDisplayName? }` | Cached 5 min |
| `GET /time` | S, O, D | → `{ serverTime, timeSig }` | `timeSig = HMAC(TIME_SIGNING_KEY, serverTime‖deviceId)` |
| `POST /setup` | P + `SETUP_TOKEN` | `SetupRequest` (org, owner email, name) → `{ orgId }` | Works once; 409 after |
| `POST /join/verify` | P | `{ phone, code }` → `{ staffFirstName, orgName }` | Rate-limited |
| `POST /join/complete` | P | `JoinCompleteRequest { phone, code, pin, deviceJwk, deviceLabel, platform, consents[] }` → `Me` + cookie | Device `pending` |
| `GET /auth/challenge` | P | `?purpose=login` → `{ nonce, expiresAt }` | 5 min |
| `POST /auth/staff/login` | P | `{ phone, pin, deviceId, nonce, signature }` → `Me` + cookie | Approved device only |
| `POST /auth/staff/new-device` | P | `{ phone, pin, deviceJwk, deviceLabel, platform }` → `{ status: 'pending' }` | Notifies owner |
| `POST /auth/owner/magic` | P | `{ email }` → 202 | Always 202 |
| `POST /auth/owner/verify` | P | `{ token }` or `{ email, code }` → `Me` + cookie | |
| `POST /auth/owner/password` | P | `{ email, password, pin }` → `Me` + cookie | |
| `POST /auth/step-up` | O, M | `{ pin }` → `{ stepUpUntil }` | |
| `POST /auth/logout` | any | → 204 | Revokes the session |
| `GET /me` | S, O, M | → `Me { user, org, device, permissions, flags }` | |

**Staff: attendance**

| Method and path | Role | Request → response | Notes |
|---|---|---|---|
| `POST /punch/nonce` | S | `{ purpose: 'punch' \| 'offline' }` → `{ nonce, expiresAt, serverTime, timeSig }` or `{ nonces: [..2] }` | |
| `POST /punches` | S | multipart: `payload` = `PunchRequest`, `selfie` = JPEG (optional, ≤ 200 KB); header `Idempotency-Key` → `PunchResult { punch, outcome, riskReasons, day }` | §4.3, §4.4 |
| `POST /punches/:id/proof` | S | `{ qrToken, signature }` → `PunchResult` | Upgrade a pending punch within 10 min |
| `POST /punches/:id/request-approval` | S | `{ note, placeName? }` → `PunchResult` | |
| `GET /me/today` | S | → `TodayView { schedule, punches, day, duty, queuedHint }` | NetworkFirst-cached |
| `GET /me/days?month=YYYY-MM` | S | → `MonthView { days[], totals }` | |
| `GET /me/days/:date` | S | → `DayDetail { punches, day, lines[] }` | |

`PunchRequest`: `{ v: 1, kind, nonce, deviceId, clientTs, idempotencyKey, fix: { lat, lng, accuracy, samples, spreadM, altitudeNullAll, speedNullAll } | null, selfieSha256 | null, qrToken | null, offsiteDutyId | null, placeName | null, deviceTz, offline: { lastServerTime, timeSig, perfDeltaMs, wallDeltaMs, pinEnvelope } | null, pin | null, clientDurationMs, signature }`. The signature is ECDSA P-256/SHA-256 over the RFC 8785 canonical JSON of every field except `signature`, `pin` and `pinEnvelope`.

**Staff: requests, pay, profile**

| Method and path | Role | Request → response |
|---|---|---|
| `GET /me/leave` | S | → `{ balances[], requests[] }` |
| `POST /leave-requests` | S | `LeaveRequestCreate { typeCode, fromDate, toDate, half?, reason?, acceptUnpaidSplit }` → `LeaveRequest` |
| `POST /leave-requests/:id/cancel` | S | → `LeaveRequest` |
| `POST /regularisations` | S | `RegularisationCreate` → `Regularisation` |
| `POST /regularisations/:id/cancel` | S | → `Regularisation` |
| `POST /advance-requests` (P1) | S | `{ amountPaise, reason, plan }` → `Advance` |
| `POST /advances/:id/ack` | S | `{ answer: 'confirmed' \| 'disputed', note? }` → `Advance` |
| `GET /me/payslips` | S | → `PayslipSummary[]` |
| `GET /me/payslips/:id` | S | → `PayslipView` |
| `GET /payslips/:id/pdf` | S (own), O, M(payroll) | → `application/pdf` (302 to a signed Worker route when ready; 202 while pending) |
| `GET /me/data` | S | → `MyData { punches[], selfies[], consents[], retention }` |
| `PATCH /me` | S, O, M | `{ lang?, name? (owner only) }` → `Me` |

**Notifications (all roles)**

| Method and path | Request → response |
|---|---|
| `GET /notifications?cursor=` | → `{ items: Notification[], nextCursor, unread }` |
| `POST /notifications/read` | `{ ids[] }` or `{ all: true }` → 204 |
| `POST /notifications/:id/opened` | → 204 (from `notificationclick`; feeds escalation) |
| `POST /push/subscribe` | `PushSubscriptionJSON + { platform }` → 201 |
| `DELETE /push/subscribe` | `{ endpoint }` → 204 |
| `GET /me/notification-prefs` / `PUT` | `NotificationPrefs` |

**Owner and manager**

| Method and path | Role | Notes |
|---|---|---|
| `GET /owner/today` | O, M | `TodayBoard { counters, in[], notIn[], out[], actionsCount, updatedAt }` |
| `GET /owner/actions?type=` | O, M | `ActionItem[]` (union by `type`) |
| `POST /owner/punches/:id/review` | O, M(approve_attendance) | `{ decision: 'clear' \| 'approve' \| 'reject', note? }` |
| `POST /owner/devices/:id/decide` | O (step-up) | `{ decision: 'approve' \| 'reject' }` |
| `POST /owner/leave-requests/:id/decide` | O, M(approve_leave) | `{ decision, note? }` |
| `POST /owner/regularisations/:id/decide` | O, M(approve_attendance) | `{ decision, note?, adjustedTimes? }` |
| `POST /owner/overtime/:userId/:date/decide` | O, M(approve_overtime) | `{ approvedMin, note? }` (0 = reject) |
| `POST /owner/days/:userId/:date/auto-close` | O, M | `{ keep: true } \| { outTs }` |
| `GET /owner/register?month=` | O, M | `RegisterView { staff[], days[][], totals[] }` |
| `GET /owner/days/:userId/:date` | O, M | `OwnerDayDetail` (punches with selfie URLs, map data, audit) |
| `PUT /owner/days/:userId/:date/override` | O | `DayOverride { status?, punches?: PunchEdit[], reason }` |
| `GET /owner/punches/:id/selfie` | O, M | JPEG |
| `GET /owner/staff`, `POST /owner/staff` | O | `StaffCreate` → `{ staff, invite: { url, code, message } }` |
| `GET /owner/staff/:id`, `PATCH /owner/staff/:id` | O | Salary changes need step-up |
| `POST /owner/staff/:id/invite` | O | Re-issue invite (old revoked) |
| `POST /owner/staff/:id/reset-pin` | O | Issues a `pin_reset` invite |
| `POST /owner/staff/:id/exit` | O (step-up) | `{ lastDay, reason }` |
| `GET /owner/staff/:id/leave`, `POST /owner/staff/:id/leave-adjust` | O | Ledger adjust with note |
| `GET /owner/roster?week=YYYY-Www`, `PUT /owner/roster` | O, M(roster) | `RosterChange[]` |
| `CRUD /owner/shift-templates` | O | |
| `CRUD /owner/holidays`, `CRUD /owner/blackout-days` | O | |
| `GET /owner/sites`, `PATCH /owner/sites/:id` | O (step-up for centre/radius) | |
| `POST /owner/sites/:id/calibration-samples` | O | `{ sessionId, samples[] }` |
| `POST /owner/sites/:id/calibration/propose` | O | → `{ centre, radiusM, stats }` |
| `CRUD /owner/offsite-duties` | O, M(offsite) | Creates a venue site per duty |
| `POST /owner/maps/resolve` | O, M | `{ url }` → `{ lat, lng, label? }` (Google hosts only, 3 redirects max) |
| `POST /owner/offsite-requests/:punchId/decide` | O, M(offsite) | `{ decision: 'approve' \| 'approve_and_open' \| 'reject', staffIds?, note? }` |
| `GET /owner/door-code` | O, M(door) | `{ url, token, expiresAt }` |
| `POST /owner/door-devices` | O (step-up) | → `{ pairingCode, expiresAt }` |
| `DELETE /owner/door-devices/:id`, `POST /owner/door-devices/:id/rotate` | O (step-up) | |
| `CRUD /owner/advances`, `POST /owner/advances/:id/decide` | O | |
| `GET /owner/payroll-runs`, `POST /owner/payroll-runs` | O | `{ month }` → draft |
| `GET /owner/payroll-runs/:id` | O | `PayrollRunView { blockers[], totals, lines[] }` |
| `POST /owner/payroll-runs/:id/recompute` | O | |
| `POST /owner/payroll-runs/:id/adjustments`, `DELETE …/adjustments/:adjId` | O | `AdjustmentCreate` |
| `PATCH /owner/payroll-runs/:id/advance-recovery` | O | `{ userId, advanceId, recoverPaise }` |
| `POST /owner/payroll-runs/:id/finalise` | O (step-up) | `{ acceptDefaults: boolean }` |
| `POST /owner/payroll-runs/:id/reopen` | O (step-up) | `{ reason, settleMode: 'next_month' \| 'reissue' }` → new revision |
| `POST /owner/payslips/:id/mark-paid`, `POST /owner/payroll-runs/:id/mark-all-paid` | O | `{ paidOn, mode, ref? }` |
| `POST /owner/exports` | O (step-up) | `{ kind, month, format, userIds? }` → `{ exportId }` |
| `GET /owner/exports/:id`, `GET /owner/exports/:id/file` | O | |
| `GET /owner/settings`, `PATCH /owner/settings` | O | `OrgSettingsPatch` (step-up for retention, strong mode, risk thresholds) |
| `GET /owner/audit?entity=&cursor=` | O | |
| `CRUD /owner/managers` (P1) | O (step-up) | Permissions: `approve_attendance`, `approve_leave`, `approve_overtime`, `offsite`, `roster`, `door`, `payroll`, `staff`, `exports` |

**Door device**

| Method and path | Role | Notes |
|---|---|---|
| `POST /door/pair` | P | `{ pairingCode }` → `{ siteId, secret, siteName }` + door cookie |
| `GET /door/status` | D | → `{ lastCheckIn: { firstName, at } \| null, serverTime }` |

**Public**

| Method and path | Notes |
|---|---|
| `GET /verify/payslip/:token` | → `{ orgName, staffName: "Priya S.", month, netPaise, revision, valid }` |

**Test-only** (absent from production builds; the router refuses them unless `ENV !== 'production'` and the `X-E2E-Token` header matches `E2E_TOKEN`)

| Method and path | Purpose |
|---|---|
| `POST /__test/reset` | Truncate and seed fixtures (named scenarios: `basic-salon`, `payroll-october`) |
| `POST /__test/clock` | `{ nowMs \| null }` sets a fake server clock for this preview |
| `POST /__test/cron` | `{ job, at }` runs a scheduled job now (crons do not run on Worker Previews) |
| `GET /__test/outbox` | Pushes, emails and WhatsApp messages captured instead of sent |

### 9.5 Scheduled jobs

Two cron triggers on the production Worker (they do not run on Previews; tests use `/__test/cron`):

| Cron (UTC) | Job | What it does |
|---|---|---|
| `*/5 * * * *` | `rules` | For each org, in IST: reminders (N4, N10), not-in-yet (N3), late batching flush, overtime-running (N9), missed check-outs (N11), auto-close (§4.8), held-notification release at quiet-hours end, WhatsApp escalation (P1), morning summary (N1), payroll draft on the 1st at 09:00 (N24), pay-day reminder (N26), duty reminders (N18). Each action is guarded by a `cron_runs` row so it runs once per slot. |
| `30 21 * * *` (03:00 IST) | `nightly` | Close the previous work date: compute `A` for no-shows, recompute changed `attendance_days`, retention purge (§8.3), comp-off expiry, CL/SL credit on 1 Jan, delete stale sessions and challenges, prune `salon_networks`, refresh offline nonces' expiry. Monthly on the 1st: 5-year purge. |

Each run logs one structured line per org with counts and duration. A job that fails retries on the next tick (idempotent by `cron_runs`).

---

## 10. Security, anti-spoofing, privacy and audit

### 10.1 Threat model

| Threat | Control | Residual risk |
|---|---|---|
| A colleague checks in for an absent friend with the friend's phone | Device-bound key + PIN on every punch; optional selfie the owner can see | Low if the PIN is private |
| A colleague checks in for a friend from their own phone | One approved device per person; a second device needs owner approval | Very low |
| Checking in from home with a fake-GPS app or browser override | Accuracy gating, zero-jitter and replay detection, impossible-jump check, VPN/ASN check, salon Wi-Fi signal, door QR in strong mode | **GPS spoofing cannot be detected reliably in a browser.** We discourage and flag; strong mode with the door QR is the real answer |
| A forwarded photo of the door QR | 30 s rotation, 60 s window, one use per person per step, still needs device + PIN | Works within 60 s if someone inside forwards it; the door screen shows the last check-in |
| Stolen or borrowed unlocked phone | PIN on every punch; 5-try lockout; owner alert at 10 | Low |
| Brute-forcing a 4–6 digit PIN offline | Never possible: PIN hashes use a server-side pepper; verification only on the server with rate limits | None offline |
| Session theft (XSS) | Strict CSP (no inline scripts), React escaping, HttpOnly cookies, no tokens in JS | Low |
| CSRF | `SameSite=Strict`, Origin check, custom header | Very low |
| Cross-tenant data access (future multi-tenant) | `org_id` injected by the data layer; tests prove cross-org reads return 404 | Low |
| Owner account takeover through email | Magic links 15 min single use; step-up PIN for sensitive actions; session list with "sign out others" | Medium (email is the root); passkeys in P2 |
| Insider tampering (owner edits history to underpay) | Every edit audit-logged with before/after; staff see "edited by Urmi" on their day; payslips show formulas | Accepted; the owner is the employer |
| Leaked selfie or location data | Private R2, short retention, no public URLs, minimal fields | Low |
| Replay of a captured punch request | Single-use nonces (5 min), idempotency key, signature over the nonce | Very low |
| Device clock tampering for offline punches | Server-signed time anchors, bounds, flagging | Low |

### 10.2 Roles and permissions

| Capability | Owner | Manager (default) | Manager (grantable) | Staff | Door |
|---|---|---|---|---|---|
| Own punches, days, leave, fixes, payslips, data | ✓ (as staff, if she checks in) | ✓ | | ✓ | |
| Today board, register (view) | ✓ | ✓ | | | |
| Approve flagged/pending punches, regularisations | ✓ | | `approve_attendance` | | |
| Approve leave | ✓ | | `approve_leave` | | |
| Approve overtime | ✓ | | `approve_overtime` | | |
| Off-site duties and requests | ✓ | | `offsite` | | |
| Roster and week-offs | ✓ | | `roster` | | |
| Show door code | ✓ | | `door` | | Shows its own |
| Staff profiles (non-salary) | ✓ | | `staff` | | |
| Salaries, advances, payroll, payslips of others | ✓ | | `payroll` | | |
| Exports | ✓ | | `exports` | | |
| Devices, settings, managers, retention, door pairing | ✓ only | | | | |

The owner is a single user per org in v1. Harsh has no in-app super-admin; see §10.11.

### 10.3 Credentials and cryptography

| Item | Design |
|---|---|
| Staff and owner PIN | `HMAC-SHA256(PIN_PEPPER, salt ‖ pin)`, 16-byte random salt per user. Security comes from the pepper and server-side rate limits, not hash cost. |
| Owner password | PBKDF2-SHA256, 100,000 iterations (the Workers ceiling), 16-byte salt, then HMAC with `PIN_PEPPER`. Minimum 10 characters; rejected if in a bundled list of the 10,000 most common passwords. |
| Sessions | 32 random bytes; cookie holds the token; D1 holds SHA-256(token). Sliding expiry; revoked on logout, device revoke, exit, PIN reset (staff) and "sign out others". |
| Device key | ECDSA P-256 generated in the browser with `extractable: false`, stored in IndexedDB; public JWK on the server with its RFC 7638 thumbprint. |
| Punch signature | ECDSA P-256 with SHA-256 over the RFC 8785 (JCS) canonical JSON of the punch payload (§9.4); verified with `crypto.subtle.verify` in the Worker. |
| Offline PIN envelope | The client seals `{ pin, idempotencyKey }` with RSA-OAEP-256 using the server public key from `GET /config` (`PUNCH_ENC_PRIVATE_JWK` holds the private key, 2048-bit). The plaintext PIN is never stored on the device. |
| Signed server time | `HMAC-SHA256(TIME_SIGNING_KEY, serverTime ‖ deviceId)`; issued with nonces and by `GET /time`. |
| Door secrets | 32 random bytes per site; stored AES-256-GCM-encrypted with `QR_MASTER_KEY`; rotation bumps `secret_version`. |
| Join codes, magic codes, pairing codes | Stored as `HMAC-SHA256(SESSION_SECRET, code)`; compared in constant time. |
| IP addresses | Never stored raw; `HMAC-SHA256(IP_HMAC_KEY, ip)` for rate limits, salon-network matching and audit. |
| Payslip verify token | 16 random bytes, base64url; reveals only name initial, month, net and revision. |
| Key rotation | Every secret has a documented rotation procedure in `docs/runbooks/secrets.md`; `PIN_PEPPER` rotation forces PIN resets, so it is rotated only on compromise. |

### 10.4 Anti-spoofing summary and the selfie

- Layers, in order of value per cost: one device per person → PIN → geofence with accuracy → risk signals → door QR (fallback and strong mode) → selfie (owner option). Face matching is **not** in v1.
- The PRD states plainly, and the owner's help screen repeats: "A phone can be made to report a fake location. The app catches common tricks and flags them, but cannot prove where a phone is. If you suspect someone, turn on the door code for them."
- **Selfie** (when on): live `getUserMedia` stream from the front camera, no file input, no gallery. One JPEG ~480 px, quality 0.7, its SHA-256 included in the signed payload; the server recomputes and compares. Owner sees thumbnails beside punches and can compare with the enrolled photo (taken at the first selfie punch, replaceable by the owner). P1: on-device face detection (presence of exactly one face) and a blink check with MediaPipe Face Landmarker, lazy-loaded only when selfies are on; weak devices fall back to face-present only.
- Selfie consent is separate from the privacy notice and can be withdrawn; if withdrawn while selfies are required, that person's check-ins go to approval (the owner sees why) until the owner switches selfies off for them.

### 10.5 HTTP security headers

Set by the Worker on every response (HTML and API):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org;
  font-src 'self'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:;
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none';
  upgrade-insecure-requests
Permissions-Policy: geolocation=(self), camera=(self), microphone=(), payment=(), usb=(),
  bluetooth=(), interest-cohort=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Robots-Tag: noindex, nofollow
```

- `'wasm-unsafe-eval'` is only for the P1 MediaPipe and the jsQR worker if built as WASM; drop it if unused.
- `style-src 'unsafe-inline'` exists because Radix's scroll lock injects a `<style>` tag. P1 hardening: inject a per-request nonce into `index.html` with HTMLRewriter and pass it to `get-nonce`, then remove `'unsafe-inline'`.
- `robots.txt` disallows everything. No analytics or ad scripts anywhere.

### 10.6 Privacy (DPDP Act 2023 and Rules 2025)

| Topic | Design |
|---|---|
| Roles | The salon (owner) is the **Data Fiduciary** for staff data. Harsh, who builds and runs the app, is a **Data Processor**; a one-page processor agreement is signed with the salon before launch (Q17). |
| Lawful basis | s.7(i), "for the purposes of employment", for attendance, location at the moment of a punch, and payroll. A clear notice is still shown and acknowledged at enrolment. |
| Selfie | Explicit, separate consent (also satisfies the SPDI Rules 2011, which treat facial images used for identification carefully). No face templates in v1. |
| Notice | Plain language, English and Gujarati, shown at join and kept under Me → Privacy notice: what is collected, why, how long, who sees it, rights, grievance contact. Versioned; a new version asks for a fresh acknowledgement. |
| Minimisation | Location read only during a check-in or check-out action; only the best fix stored (5 decimals); no route history, contacts, device identifiers beyond our key, or analytics SDKs. Gender and date of birth are not collected. |
| Purpose limitation | Attendance, payroll and disputes only. Never performance scoring or marketing (stated in the notice). |
| Staff rights | My data screen (§5.1): view punches, location results, selfies while kept, consents; ask for a correction (a regularisation); withdraw selfie consent; grievance contact. "On exit, your selfies and locations are deleted within 30 days; wage records are kept 5 years as the law requires." |
| Children | v1 does not enrol anyone under 18. The owner confirms "18 or older" when adding staff (a required tick). Academy trainees under 18 are out of scope until a guardian-consent flow exists (Q21). |
| Retention | §8.3, enforced by jobs and R2 lifecycle rules. |
| Security | §10.3 and §10.5; D1 and R2 encrypted at rest by Cloudflare; TLS everywhere. |
| Breach | Incident runbook (§10.10). DPDP Rules require informing the Board and affected people; a detailed report within 72 hours. |
| Timeline | Most DPDP obligations apply from 13 May 2027; we build to them now. |

### 10.7 Audit log

- Append-only table `audit_log` (§8.2); the data layer exposes only `insert` and `select`.
- Logged: every create, update and delete by a user (before and after JSON, reason where required); every approval and rejection; settings and rule changes; payroll create, recompute, finalise, reopen, mark paid; exports and payslip downloads (`export`); sign-ins, failed PINs, lockouts, device changes, step-ups (`security`); owner views of selfies (`access`).
- System actions (auto-close, absent marking, comp-off expiry, retention purge counts) are logged with `actor_type = system`.
- The owner can view and filter the log (Settings → Audit log) and export it as CSV. Staff see the audit entries that touch their own days on the day detail ("Edited by Urmi").

### 10.8 Tenant isolation

- All database access goes through `app/worker/db/` repositories that take an `OrgContext` (from the session) and add `org_id = ?` to every statement; raw `env.DB.prepare` is banned outside that folder by a lint rule (Biome `noRestrictedImports` plus a CI grep).
- A test suite seeds two orgs and asserts, for every GET route, that an id from the other org returns 404 and no data, and for every mutation that it changes nothing.
- R2 keys always start with the org id, and the Worker checks it against the session before serving.

### 10.9 Retention purge

The nightly job (§9.5) performs every row of §8.3 in batches of 500 statements per D1 batch, logs counts to `audit_log` (`system`, `retention.purge`), and is idempotent. R2 lifecycle rules (selfies 30 days, exports 7 days, backups 90 days) are created by a one-time script in `scripts/r2-lifecycle.ts` run from CI with the API token, and verified by a CI check that lists the bucket's rules.

### 10.10 Incident runbook (summary; full text in `docs/runbooks/incident.md`)

1. Contain: rotate the affected secret (`wrangler secret put`), revoke sessions (`UPDATE sessions SET revoked_at`), disable door devices if QR secrets leaked.
2. Assess: what data, which people, which period (Workers Logs, audit log, R2 access).
3. Tell Urmi (the fiduciary) the same day; she informs affected staff in plain language; Harsh helps draft the notice to the Data Protection Board within 72 hours.
4. Fix and record: root cause, change, test added, entry in `docs/ops-log.md`.

### 10.11 Operator access

There is no hidden admin or support login. Harsh operates the system only through Cloudflare (wrangler and the dashboard) with his own account. Any direct database action on production data happens only at the owner's request, is written to `docs/ops-log.md` with the date, reason and SQL, and is mirrored as an `audit_log` row (`actor_type = system`, `action = ops.manual`).

---

## 11. PWA

### 11.1 Manifest (`/manifest.webmanifest`)

```json
{
  "id": "/",
  "name": "Feelings Staff",
  "short_name": "Feelings",
  "description": "Attendance and pay for the Feelings Beauty Care team.",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "lang": "en-IN",
  "dir": "ltr",
  "categories": ["business", "productivity"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ],
  "shortcuts": [
    { "name": "Check in", "url": "/?action=punch", "icons": [{ "src": "/icons/sc-checkin-96.png", "sizes": "96x96" }] },
    { "name": "Today (owner)", "url": "/o/today", "icons": [{ "src": "/icons/sc-today-96.png", "sizes": "96x96" }] }
  ],
  "screenshots": [
    { "src": "/screens/staff-today-390.png", "sizes": "780x1688", "type": "image/png", "form_factor": "narrow", "label": "Check in from the salon" },
    { "src": "/screens/owner-register-1280.png", "sizes": "1280x800", "type": "image/png", "form_factor": "wide", "label": "Monthly register" }
  ]
}
```

`short_name` is "Feelings" because "Feelings Staff" (14 characters) is truncated on most home screens. `theme_color` stays white, matching the website's chrome. Screenshots are produced by the visual test job and committed by the release workflow.

### 11.2 Icons

Built from the website's `public/favicon.svg` (the red bindi, `#b3121b`, circle r=20 in a 64 box: 62.5% of the canvas, inside the maskable safe zone).

| File | Spec |
|---|---|
| `icons/icon.svg` | The bindi on white |
| `icons/icon-192.png`, `icon-512.png` | Bindi on white, `purpose: any` |
| `icons/maskable-192.png`, `maskable-512.png` | Bindi centred, diameter 50% of the canvas, white full-bleed background, `purpose: maskable` |
| `icons/apple-touch-icon-180.png` | Bindi on white, no transparency |
| `icons/badge-96.png` | Monochrome white bindi on transparent (Android notification badge) |
| `favicon.svg`, `favicon-32.png` | As the website |
| `icons/sc-*.png` | Shortcut icons: Phosphor `sign-in` and `calendar-check` in sindoor on white |

Generated in CI by `@vite-pwa/assets-generator` from `icon.svg`; the iOS splash images (`apple-touch-startup-image`) for current iPhone sizes come from the same step (white background, centred bindi).

### 11.3 HTML head

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Feelings">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
```

Layout pads with `env(safe-area-inset-*)`. Every input is at least 16 px so iOS does not zoom.

### 11.4 Service worker (vite-plugin-pwa, `injectManifest`, Workbox)

| Request | Strategy | Notes |
|---|---|---|
| App shell: `index.html`, JS, CSS, fonts, icons | Precache (revisioned), `cleanupOutdatedCaches` | Navigation fallback to `index.html` for in-scope routes except `/api/*`, `/v/*`, `/q/*` |
| `GET /api/v1/me`, `/me/today`, `/me/days*`, `/me/leave`, `/me/payslips`, `/owner/today`, `/owner/register*` | NetworkFirst, 3 s timeout, cache `api-v1`, max 50 entries, 7 days | Responses carry `X-FS-Cached-At` so the UI can say "Showing what we had at 10:05" |
| `GET /api/v1/owner/punches/:id/selfie` | StaleWhileRevalidate, cache `selfies`, max 200 entries, 7 days | Purged on sign-out |
| `GET /api/v1/payslips/:id/pdf` | CacheFirst, cache `payslips`, max 24 entries | |
| OSM tiles | CacheFirst, cache `tiles`, max 300 entries, 30 days | Owner screens only |
| Everything else under `/api` (all POST, PUT, PATCH, DELETE) | NetworkOnly | Punches use the app-level queue (§11.5), not Workbox Background Sync |

On sign-out the app clears `api-v1`, `selfies` and `payslips` caches and the IndexedDB stores except the device key.

### 11.5 IndexedDB stores (`idb` library, database `feelings`, version 1)

| Store | Key | Content |
|---|---|---|
| `device` | `"current"` | `{ deviceId, privateKey: CryptoKey (non-extractable), publicJwk, approved }` |
| `timeAnchor` | `"current"` | `{ serverTime, timeSig, perfNow, dateNow, pageSessionId }` |
| `offlineNonces` | nonce | `{ nonce, expiresAt }` (2 kept) |
| `pendingPunches` | idempotencyKey | Full signed `PunchRequest` + selfie `Blob` + attempts + lastError |
| `prefs` | key | Language, dismissed tips |

Flush algorithm: oldest first; on 2xx delete; on 4xx other than 401/409-nonce mark failed and stop the chain for that person; on 5xx or network error back off (30 s, 2 min, 5 min) and keep. Never auto-reload the app while the queue is non-empty.

### 11.6 Push handling

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const n = data.notification ?? { title: 'Feelings', body: 'Open the app to see what changed.' };
  event.waitUntil(Promise.all([
    self.registration.showNotification(n.title, {
      body: n.body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
      tag: data.topic, renotify: data.t !== 'summary', lang: n.lang ?? 'en-IN',
      data: { url: n.navigate, e: data.e }
    }),
    navigator.setAppBadge?.(data.badge ?? undefined),
    notifyClients({ type: 'push', t: data.t })   // open tabs refetch
  ]));
});
self.addEventListener('notificationclick', (event) => { /* focus or open data.url; POST /notifications/:e/opened */ });
self.addEventListener('pushsubscriptionchange', (event) => { /* resubscribe and POST /push/subscribe */ });
```

Every path calls `showNotification` inside `waitUntil`, including parse errors, so Safari never counts a silent push.

### 11.7 Update flow

- `registerType: 'prompt'`. On `onNeedRefresh` show the toast "A new version is ready." with **Update**; `updateSW(true)` reloads.
- Never prompt or reload while the check-in sheet is open or `pendingPunches` is non-empty; the toast waits.
- Check for updates on `visibilitychange → visible` and every 60 minutes.
- Breaking API changes bump `min_app_version`; old clients get 426 and a full-screen "Please update" with **Update now**.

### 11.8 iOS specifics (checklist for builders)

- Web Push only in the installed Home Screen app (iOS 16.4+); permission requested only from a tap.
- Home Screen apps have storage separate from Safari: enrol and sign in inside the installed app (join code, magic code).
- No Background Sync: the punch queue flushes when the app is open.
- No `BarcodeDetector`: use jsQR in a Web Worker.
- `navigator.permissions.query({ name: 'geolocation' })` can report `prompt` after a denial: rely on the error from the real request.
- Camera works in standalone mode via `getUserMedia`; the video element needs `playsinline` and `muted`.
- `navigator.storage.persist()` after install; Home Screen apps are not subject to the 7-day storage cap on their own origin.
- Declarative Web Push payload shape works on iOS 18.4+ without the service worker; the SW handler covers older versions.
- `display-mode: standalone` media query and `navigator.standalone` both checked.
- Status bar style `default` (dark text on the white header).

### 11.9 Internationalisation

- `i18next` + `react-i18next`, JSON catalogs in `packages/i18n/{en,gu}/*.json` by namespace (`common`, `staff`, `owner`, `errors`, `notify`, `payslip`). Keys are semantic (`staff.today.checkIn`), never English sentences.
- Numbers, dates and money through `Intl` with `en-IN` or `gu-IN`; digits stay Latin by default (setting for Gujarati digits in P2).
- Gujarati font: `@fontsource/noto-sans-gujarati` (400, 600, 700), loaded only when `lang = gu` (CSS `unicode-range`), stacked after Plus Jakarta Sans so Latin text keeps the brand face.
- CI fails if any key used in code is missing in `en`, and reports (warning in P0, error from 1.1) keys missing in `gu`.
- Staff screens, staff notifications and the payslip are translated in 1.1; the owner panel stays English (Gujarati in P2).
- Gujarati strings are drafted by the team and reviewed by a native speaker (Urmi or a staff member she picks) before release.

### 11.10 Performance budgets (enforced in CI)

| Budget | Limit |
|---|---|
| Staff initial JS (gzip) | ≤ 170 KB |
| Owner route chunks (gzip, each) | ≤ 120 KB; Leaflet and the map are a separate lazy chunk |
| CSS (gzip) | ≤ 25 KB |
| Fonts preloaded | 1 file (Plus Jakarta Sans latin variable, ~30 KB) |
| Lighthouse mobile (Moto G Power, slow 4G) on `/` and `/o/today` | Performance ≥ 85, Accessibility 100, Best Practices ≥ 95; LCP ≤ 2.5 s; CLS ≤ 0.05 |
| `POST /punches` server time | p95 ≤ 800 ms (excluding selfie upload) |

### 11.11 Accessibility

WCAG 2.2 AA. One `h1` per screen. Every control labelled; errors linked with `aria-describedby`; status never by colour alone (icon + word); visible 2 px sindoor focus ring; tap targets ≥ 44 px; inputs ≥ 16 px; the PIN pad is a real `input type=password inputmode=numeric autocomplete=one-time-code` behind the visual keypad so screen readers and password managers behave; motion respects `prefers-reduced-motion` (tiers in §12.8); live regions announce check-in results and queue status; the register grid is a real `table` with row and column headers on desktop.

---

## 12. Design system

### 12.1 Source of truth

- `packages/ui/src/styles/tokens.css` is a **byte-for-byte copy** of the brand tokens in `research/brand-and-stack.md` §6.1 (from `harshbhx/feelings-beauty-care` `src/styles/tokens.css` at `88eab55`). Never edited; app additions go in `app-tokens.css`.
- Tailwind v4 uses the locked `@theme` from `research/brand-and-stack.md` §6.3: `--color-*: initial`, `--font-*: initial`, `--radius-*: initial`, `--shadow-*: initial`, `--text-*: initial`, `--breakpoint-*: initial`, then only brand values. Tailwind's default grey, slate, zinc, blue and friends do not exist in this build.
- Semantic class names in markup (`bg-bg-soft`, `text-text-muted`, `bg-accent`), never raw palette names in components.
- Font: `@fontsource-variable/plus-jakarta-sans` (wght + wght-italic), weights 400 / 600 / 700 / 800 only. Icons: `@phosphor-icons/core` regular weight, inlined as SVG components, one set only.

### 12.2 Colour rules

- White page, blush (`--bg-soft`, `--bg-tint`) for grouped surfaces, maroon only for one deep element per screen at most (the owner's payroll summary band, the door screen header), sindoor for actions.
- **One red (sindoor) button per view.** Secondary actions are white pills with a `--border-strong` outline. Destructive actions are secondary pills with `--status-absent` text and a confirm step, never a second red fill.
- 3–5 red placements per screen at most (the button, the bindi, focus, one emphasis word).
- No gold, no gradients, no glows, no blur orbs, no grain. Depth from white space, hairlines (`--border`) and the two brand shadows, used sparingly (sheets and the sticky action bar only).
- Text on red or maroon is white; text on white is ink.

### 12.3 Status colours (extends the brand; Q1 asks Urmi to approve the green)

| Status | Text / icon | Tint (chip background) | Contrast on tint | Icon (Phosphor regular) | Letter |
|---|---|---|---|---|---|
| Present | `#2f6b47` muted forest (new hue) | `#eef5f0` | 5.72:1 | `check-circle` | P |
| Late (tag) | `--henna-600` `#9a3b1b` | `#fbf0ea` | 6.22:1 | `clock` | — |
| Half day | `--coral-600` `#c2412d` | `#fdf1ee` | 4.65:1 | `circle-half` | H |
| Absent | `--red-700` `#8f0e16` | `--rose-100` `#fbeceb` | 8.16:1 | `x-circle` | A |
| Leave (paid or unpaid) | `--plum-700` `#6e1e4e` | `#f6edf2` | 9.35:1 | `airplane-tilt` | L |
| Week off / holiday / not scheduled | `--ink-500` `#76656a` | `--rose-50` `#fff7f6` | 5.18:1 | `minus` / `confetti` (holiday) | WO / HO |
| Needs a look (flagged) | `--ink-700` `#4b3b3e` | `#f4f0ef` | 9.30:1 | `warning-circle` (icon in sindoor) | — |
| Waiting (pending) | `--ink-700` | white with a 1 px dashed `--border-control` | 10.5:1 on white | `hourglass` | — |
| At a venue (tag) | `--plum-700` | `#f6edf2` | 9.35:1 | `map-pin` | OD |

```css
/* packages/ui/src/styles/app-tokens.css */
:root {
  --status-present: #2f6b47;  --status-present-bg: #eef5f0;
  --status-late: var(--henna-600);  --status-late-bg: #fbf0ea;
  --status-half: var(--coral-600);  --status-half-bg: #fdf1ee;
  --status-absent: var(--red-700);  --status-absent-bg: var(--rose-100);
  --status-leave: var(--plum-700);  --status-leave-bg: #f6edf2;
  --status-off: var(--ink-500);     --status-off-bg: var(--rose-50);
  --status-flag: var(--ink-700);    --status-flag-bg: #f4f0ef;
  --app-bar-h: 4.75rem;   /* bottom action bar, + env(safe-area-inset-bottom) */
  --tabbar-h: 4rem;
}
```

All pairs were checked against WCAG 2.2 (contrast on the tint, normal text). Chips always combine colour, icon and a word or letter. If Urmi rejects the green, present becomes `--ink-900` with a filled `check-circle` (Q1 default keeps the green).

### 12.4 Typography in the app

| Use | Token | Weight | Notes |
|---|---|---|---|
| Screen title (h1) | `--text-xl` (22–28 px) | 800, tracking −0.025em | One per screen; may end with the bindi |
| Big time on Today and the success screen | `--text-3xl` (40–72 px), clamped to 56 px max on phones | 800, `tabular-nums` | "10:02" |
| Section heading (h2) | `--text-lg` 20 px | 700 | |
| Body | `--text-base` 17 px, leading 1.65 | 400 | |
| Secondary text, captions | `--text-sm` 15 px, `--text-muted` | 400–600 | |
| Labels, chips, table headers | `--text-xs` 13 px | 700 (chips), 600 (labels) | Nothing smaller than 13 px |
| Money and times in tables | `--text-sm` | 600, `tabular-nums` | Right-aligned money |

Sentence case everywhere. `text-wrap: balance` on headings, `pretty` on paragraphs. One emphasised word per screen at most (italic, sindoor), used only on the greeting.

### 12.5 Layout

- Phone shell: sticky header (`--bg-glass`, 4 rem) with the screen title and the bell; content with `--gutter` side padding; the bottom action bar (`--app-bar-h`, glass, safe-area padded) holds the single primary action; the tab bar sits under it.
- Owner desktop (≥ 64rem): a 15rem left rail (logo mask in maroon, nav items with the bindi marking the active one), content up to `--container` (76rem), two-column layouts for detail screens.
- Cards: white with a 1 px `--border` and `--radius-md`; no shadow by default. Lists are hairline-separated rows, not stacks of shadowed cards.
- Breakpoints: 30rem, 48rem, 56rem, 64rem (the brand's).

### 12.6 Components (`packages/ui`)

Radix primitives (Dialog, Popover, Tabs, Toast, Tooltip, Checkbox, RadioGroup, Switch, Select, ScrollArea, VisuallyHidden) wrapped and restyled with brand tokens. Any shadcn source copied in must be restyled before merging (no default zinc, no `rounded-xl`, no `shadow-sm` on every card).

| Component | Brand rules |
|---|---|
| `Button` (`primary`, `secondary`, `ghost`, `danger-secondary`; sizes 48 px and 40 px) | Pill, 700 weight, icon 1.2em with 0.55em gap, press `scale(0.98)`, hover lift 1 px and `--shadow-accent` on primary only |
| `IconButton` | 44 px circle, `aria-label` required by the type |
| `StatusChip` | §12.3; 13 px 700; icon + text; never clickable-looking |
| `Chip` / `ChipGroup` | Real radios/checkboxes drawn as pills (from the website's `Chip.astro`) |
| `PinPad` | 3×4 grid of 64 px keys, white with hairline, digits 800 weight; dots fill with sindoor; hidden real input |
| `Stepper` | ± 44 px circles (from the website) for minutes and radius |
| `Field`, `Input`, `Textarea`, `Select`, `PhoneField`, `CodeField`, `TimeField` | Hint above the field; 16 px+; `min-height` 3.25 rem; error text in `--status-absent` with icon |
| `Sheet` | Bottom sheet on phones (Radix Dialog), centred dialog on desktop; drag handle; `--shadow-md` |
| `Toast` | Bottom, above the action bar; ink text on white with a hairline; one at a time |
| `Banner` | Offline, queued punches, install, update: full-width hairline strip with an icon |
| `TabBar` | 5 items, icon + label, active item marked by the bindi under the icon |
| `ListRow` | Avatar or icon, primary and secondary text, trailing chip or value, 56 px+ |
| `Avatar` | Initials in 700 on `--bg-tint`, maroon text; no stock photos |
| `MonthCalendar`, `DateRange` | 7 columns, 44 px cells, status letter + icon dot; today ringed in ink |
| `RegisterGrid` | Desktop `table` with sticky header and first column, 36 px cells, letters + tints, keyboard navigable |
| `Timeline` | Punch list with times in `tabular-nums`, source tags |
| `MoneyLine` | Label, formula in muted text, amount right-aligned |
| `MapView` | Lazy Leaflet; circle stroke sindoor 2 px, fill 8% sindoor; pin is a bindi; attribution visible |
| `CameraView`, `QRScanner` | Rounded `--radius-lg` viewport, square guide in white hairline |
| `Skeleton` | `--bg-tint` blocks; breathes ≤ 6 times |
| `EmptyState` | One sentence, optional action; no illustrations |
| `Bindi` | The dot: 0.17em on headings, 6 px marker in nav, 24 px on the success screen |

A static "kit" page (`/__kit`, preview builds only) renders every component in every state; the visual tests snapshot it.

### 12.7 Iconography

Phosphor regular only. Set used: `sign-in`, `sign-out`, `clock`, `check-circle`, `x-circle`, `circle-half`, `warning-circle`, `hourglass`, `map-pin`, `navigation`, `calendar-blank`, `calendar-check`, `airplane-tilt`, `confetti`, `coffee`, `user`, `users`, `camera`, `qr-code`, `scan`, `fingerprint`, `lock`, `bell`, `gear`, `chart-bar`, `currency-inr`, `file-pdf`, `share-network`, `whatsapp-logo`, `phone`, `plus`, `minus`, `caret-left`, `caret-right`, `arrow-right`, `x`, `wifi-slash`, `arrows-clockwise`. Buttons 1.2em; standalone 1.25em; decorative icons `aria-hidden`.

### 12.8 Motion

- Tokens from the brand (`--ease-out`, `--ease-soft`, 140 / 220 / 420 ms). Animate opacity and transform only.
- Allowed moments: sheet slide-up (220 ms), toast fade (140 ms), press scale (0.97–0.98), screen enter fade + 8 px rise (220 ms), **the bindi landing on a successful check-in or check-out** (520 ms, `cubic-bezier(0.34, 1.5, 0.5, 1)`, from `scale(0)`), one 8 ms haptic tick on Android.
- Not allowed: spinners on whole screens, looping animations, shimmer, confetti, number counters, parallax, auto carousels, custom cursors.
- Reduced motion tiers (from the brand): tier 1 (slides, lifts, the bindi spring) removed; tier 2 (enters) become 160 ms fades; tier 3 (colour and focus changes) stay. No haptics.

### 12.9 The bindi signature

The bindi is the brand's mark and appears in exactly these places: the app icon and favicon; the full stop on the Today greeting ("Good morning, Priya●"); the active tab marker; the success moment (it lands, once); the map pin; the PIN pad's filled dots; the owner's left-rail active marker. The sindoor brush line appears at most once in the whole app, under the first greeting of the day, and may be cut entirely if it competes with the check-in button.

### 12.10 Voice

"You're in at 10:02." "Late by 12 min. Add a note for Urmi?" "You're outside the studio. Move closer, or mark this as a venue visit." "All clear. Nothing waiting." Never: "Oops!", "Awesome!", "You failed to…", "Streak", "Score", exclamation marks, emoji, guilt. Numbers are real (no invented stats). Labels: one verb pair per intent ("Check in" / "Check out"; "Approve" / "Reject"; "Send to Urmi").

### 12.11 How we avoid AI-slop UI (review checklist for every PR with UI)

1. No colour outside the brand tokens and §12.3; no Tailwind default palette, no purple or blue accents, no `gray-*`, `slate-*`, `zinc-*`.
2. One sindoor button per view; everything else is outline, ghost or text.
3. No gradients, glassmorphism (beyond the brand's header glass), glows, blobs, noise or 3D.
4. No emoji in UI copy or as icons; one icon set (Phosphor regular).
5. No "dashboard of stat cards with sparklines"; numbers appear where they are needed, with labels in words.
6. Lists are hairline rows, not stacks of rounded shadowed cards; cards have hairlines, not drop shadows.
7. Plus Jakarta Sans only, four weights, nothing under 13 px, sentence case, tight tracking on large sizes.
8. Real copy from this PRD, in the salon's voice; no lorem ipsum, no "Welcome back!" with a waving-hand emoji, no "Unlock your productivity".
9. Empty states are one sentence and one action; no stock illustrations or people.
10. No skeleton shimmer, no spinners on screens, no looping motion; the bindi lands once.
11. Layout aligns to the 4 px spacing scale and the brand gutters; no centred-everything hero layouts in the app.
12. Status is colour + icon + word, always.
13. Every interactive element has a visible sindoor focus ring and a 44 px target.
14. Tables are real tables with tabular numbers, right-aligned money, sticky headers.
15. Screenshots at 390 px and 1280 px are reviewed side by side with the website (review.feelingsbeautycare.in) before merging.

**Enforcement in CI**: Biome lint; a `scripts/check-ui.mjs` that fails on hex colours outside `packages/ui/src/styles/`, on `gray-|slate-|zinc-|neutral-|stone-` classes, on `rounded-xl|rounded-2xl|shadow-lg|shadow-xl|bg-gradient`, on emoji code points in `packages/i18n` and `app/src`, and on imports from `lucide-react` or other icon sets.

---

## 13. Architecture and decisions

### 13.1 System overview

```
 Staff phone (installed PWA)         Owner phone / laptop            Door device (/door)
 React SPA + service worker          React SPA (/o/*)                React SPA (kiosk)
 IndexedDB: device key, queue        push, inbox                      TOTP from local secret
          |  HTTPS, same origin, cookie session                          |
          v                                                              v
 +-------------------------- Cloudflare Worker "feelings-staff" ---------------------------+
 |  Static assets (Vite build)      run_worker_first: /api/*, /v/*, /q/*, /__kit           |
 |  Hono API /api/v1  -> zod validation -> services -> repositories (org-scoped)           |
 |  scheduled(): */5 rules engine, 03:00 IST nightly                                       |
 |  packages/engine (pure rules)    PushSender (@pushforge/builder)   EmailSender (CF)     |
 +-----+-------------------+-------------------+-------------------+-----------------------+
       |                   |                   |                   |
   D1 "fbc-staff"    R2 "fbc-staff-media"   Browser Run (PDF)   Push services (FCM, APNs web,
   (apac)            selfies, payslips,                         Mozilla), Email Service,
                     exports                                    WhatsApp Cloud API (P1)
```

### 13.2 A check-in, end to end

1. Client: `POST /api/v1/punch/nonce` while `watchPosition` runs.
2. Client: builds `PunchRequest`, signs the canonical JSON with the device key, posts multipart with the selfie.
3. Worker: CSRF and version checks → session → rate limit → zod → load device (approved, same user) → verify signature → consume nonce → verify PIN (or decrypt the offline envelope) → selfie hash check → R2 put → `fenceCheck` → `riskScore` → insert punch (idempotent) → `computeDay` for that work date → upsert `attendance_days` → enqueue notifications (`waitUntil`) → respond with `PunchResult`.
4. All D1 writes for the punch, day and notification rows go in one `DB.batch()` so they commit together.

### 13.3 Repository layout (`harshbhx/feelings-staff`, pnpm workspaces, Node 22)

```
feelings-staff/
  app/                          Vite project: SPA + Worker (@cloudflare/vite-plugin)
    index.html
    src/                        client
      main.tsx, router.tsx      React Router; role-based homes
      api/                      typed client implementing contracts.ApiClient; mock client for kit/dev
      features/auth/            join, sign-in, owner auth, step-up            (WP-3)
      features/staff/           today, punch sheet, month, requests, payslips  (WP-7)
      features/owner/           today board, actions, register, staff, roster,
                                duties, payroll, reports, settings, door code (WP-6)
      features/door/            door kiosk                                     (WP-4 logic, WP-7 UI)
      pwa/                      sw.ts, register.ts, queue.ts, device-key.ts, push.ts (WP-7, WP-8)
      lib/                      geolocation, camera, qr, format, i18n setup
    worker/                     server
      index.ts                  fetch + scheduled entry, Hono app, headers, CSP
      middleware/               session, csrf, version, rate limits, org context, errors
      routes/auth/*             (WP-3)
      routes/attendance/*       punches, days, duties, door, regularisations, leave (WP-4)
      routes/payroll/*          advances, payroll runs, payslips, exports      (WP-5)
      routes/notify/*           notifications, push, prefs                     (WP-8)
      routes/owner/*            today, actions, register, staff, settings      (WP-6 server part, WP-4/5 where noted)
      services/                 punch, risk, fence, day, payroll, pdf, notify, email, push, maps
      db/                       repositories (org-scoped), batch helpers       (WP-1)
      cron/                     rules.ts, nightly.ts                           (WP-8)
      test-routes.ts            /__test/* (excluded from prod)                 (WP-9)
    wrangler.jsonc
  packages/
    contracts/                  zod schemas, TS types, error codes, ApiClient interface (WP-1)
    engine/                     pure rules: schedule, day, payroll, risk, fence (WP-5; risk/fence WP-4)
    ui/                         tokens, Tailwind theme, components, kit page   (WP-2)
    i18n/                       en, gu catalogs                                (WP-7)
  migrations/                   0001_init.sql, …                               (WP-1)
  e2e/                          Playwright specs, fixtures, fake camera, visual baselines (WP-9)
  scripts/                      check-ui.mjs, r2-lifecycle.ts, seed.ts, size budgets
  docs/                         PRD.md, runbooks/, ops-log.md, decisions/
  .github/workflows/            ci.yml, e2e.yml, preview.yml, deploy.yml, nightly.yml, snapshots.yml
```

### 13.4 Main libraries

| Area | Choice |
|---|---|
| Runtime and build | Cloudflare Workers, Wrangler 4 (≥ 4.135 for Worker Previews), `@cloudflare/vite-plugin`, Vite, TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Server | Hono, `@hono/zod-validator`, zod |
| Client | React 19, React Router 7 (library mode), TanStack Query, Radix primitives, Tailwind v4, `@fontsource-variable/plus-jakarta-sans`, `@phosphor-icons/core` |
| PWA | `vite-plugin-pwa` (injectManifest, Workbox), `idb`, `@vite-pwa/assets-generator` |
| Location, camera, QR | Geolocation API; `getUserMedia`; `BarcodeDetector` with `jsqr` in a Web Worker fallback; `uqr` to draw the door QR |
| Maps | Leaflet + OpenStreetMap tiles (lazy) |
| Crypto | WebCrypto only (ECDSA P-256, RSA-OAEP-256, HMAC-SHA256, AES-GCM, PBKDF2); `canonicalize` (RFC 8785) |
| Push | `@pushforge/builder` (pinned, wrapped in `PushSender`) |
| Email | Cloudflare Email Service `send_email` binding (wrapped in `EmailSender`; Resend adapter as fallback) |
| PDF | Cloudflare Browser Run binding (`browser`) with `@cloudflare/puppeteer` |
| i18n | `i18next`, `react-i18next` |
| Tests | Vitest, `@cloudflare/vitest-pool-workers`, Playwright, `@axe-core/playwright`, Lighthouse CI |
| Lint and format | Biome; `scripts/check-ui.mjs` |

### 13.5 Architecture decision records

**ADR-01. One Worker for assets, API and cron.**
*Context*: the reference site uses Cloudflare Pages with Functions; Pages Functions have no cron triggers, and a separate cron Worker would split the code. *Decision*: a single Worker with static assets (`not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*", "/v/*", "/q/*", "/__kit"]`), a Hono API and `scheduled()`. *Consequences*: one deploy unit, same-origin cookies, Worker Previews per PR, cron available. Requires **Workers Paid ($5/month)**, which we need anyway for CPU time (signature checks, push encryption), Email Sending and Browser Run.

**ADR-02. React + Vite SPA, not Astro.**
*Context*: the website is Astro with plain CSS. This app is stateful (punch state machine, offline queue, register grid, payroll editing) and needs a service worker with precise control. *Decision*: React 19 SPA with Vite and `vite-plugin-pwa`. *Consequences*: the brand is carried by copying the token file unchanged and by the component rules in §12, not by sharing Astro components.

**ADR-03. Tailwind v4 with a locked theme.**
*Decision*: Tailwind v4 with every default scale cleared and replaced by brand tokens (`research/brand-and-stack.md` §6.3). *Why*: speed for several parallel builders, and Radix composition. *Risk*: generic look. *Mitigation*: no default palette exists to reach for; CI `check-ui.mjs`; review checklist §12.11.

**ADR-04. D1 with application-level tenancy.**
*Decision*: one D1 database, `org_id` on every row, enforced by the repository layer and tested. No row-level security exists in D1, so the tests are mandatory. *Alternative rejected*: Supabase (new vendor, free tier pauses, the salon is already on Cloudflare).

**ADR-05. Staff auth = PIN + device-bound key; no SMS OTP.**
*Decision*: invite + join code, 4–6 digit PIN, non-extractable ECDSA key per device, owner approves devices. *Why*: SMS OTP in India needs DLT registration and costs per message; the owner knows every staff member in person. *Twist*: iOS Home Screen apps do not share storage with Safari, so the join code (and the owner's 6-digit magic code) is typed inside the installed app rather than relying on the link alone.

**ADR-06. Server time, IST work dates, integer paise, exact fractions.**
*Decision*: the server's receive time is canonical; offline punches are bounded by signed server time; money is integer paise; rates are exact fractions rounded once per line. *Why*: disputes are about minutes and rupees; every number must be reproducible.

**ADR-07. PDFs through Browser Run from HTML templates.**
*Context*: payslips need Gujarati in 1.1. `pdf-lib` in a Worker cannot shape Gujarati conjuncts. *Decision*: render a print HTML template (the same one used on screen) and convert with Cloudflare Browser Run (Workers Paid includes 10 browser-hours a month; a payslip takes about 2–3 s). *Fallback*: the HTML payslip with a print stylesheet. *Consequence*: one template for screen and PDF.

**ADR-08. Web Push with `@pushforge/builder` behind an interface.**
*Context*: the classic `web-push` package fails on Workers. *Decision*: `@pushforge/builder` (Web Crypto, zero dependencies), pinned and wrapped in `PushSender` so it can be swapped (`web-push-neo` is the alternative). Declarative Web Push payload shape.

**ADR-09. Email through Cloudflare Email Service.**
*Decision*: the `send_email` binding (Email Sending, beta, Workers Paid: 3,000 emails a month included) with the domain onboarded in the same account. Wrapped in `EmailSender` with a Resend adapter selected by `EMAIL_PROVIDER` if the beta misbehaves. Owner sign-in also has a password + PIN fallback, so email is never the only door.

**ADR-10. Two crons and an idempotency table, no Queues in v1.**
*Decision*: a 5-minute rules cron evaluating each org's IST rules, and a nightly job. Fan-out with `ctx.waitUntil(Promise.allSettled(...))` is enough for one salon. *Later*: Cloudflare Queues for multi-tenant push fan-out.

**ADR-11. Selfie optional, no biometrics.**
*Decision*: selfie off by default (Harsh's default), owner toggle per org and per person; no face matching or templates. *Why*: proportionality under DPDP and the SPDI rules, and less friction. The risk score does not penalise a missing selfie unless the owner requires it.

**ADR-12. Contracts first, monorepo.**
*Decision*: pnpm workspaces; `packages/contracts` (zod) is written first and frozen at v1; server and client import the same schemas. Changes after the freeze need a PR labelled `contract-change` that updates both sides.

**ADR-13. Polling for the live board.**
*Decision*: the owner's Today board polls every 30 s while visible and refetches on push. *Later*: Durable Objects WebSockets (P2) if more salons use it.

**ADR-14. Leaflet and OpenStreetMap, lazily.**
*Decision*: maps only on owner screens (calibration, duties, day detail), loaded on demand; tiles from `tile.openstreetmap.org` with attribution (usage is tiny and within the tile policy). *Alternative*: a static SVG distance diagram if tiles are ever blocked.

---

## 14. Testing strategy and definition of done

All test runs happen in GitHub Actions (never on the 2-CPU VM). Locally, builders run only single quick checks.

### 14.1 Layers

| Layer | Tool | Where | Gate |
|---|---|---|---|
| Static | `tsc --noEmit` (strict), Biome, `check-ui.mjs`, i18n key check, size budgets | `ci.yml` | Required |
| Engine unit | Vitest, table-driven | `ci.yml` | Required; 100% branch coverage on `packages/engine` |
| Contracts | Vitest: every schema has valid and invalid fixtures | `ci.yml` | Required |
| API | Vitest with `@cloudflare/vitest-pool-workers` (real D1 and R2 in Miniflare, migrations applied per test file) | `ci.yml` | Required; ≥ 85% line coverage on `app/worker` |
| E2E | Playwright against `wrangler dev` (local D1, seeded) in CI | `e2e.yml` | Required |
| Visual | Playwright `toHaveScreenshot` at 390×844 and 1280×800 in the Playwright Docker image | `e2e.yml` | Required (max diff ratio 0.1%) |
| Accessibility | `@axe-core/playwright` on every visited screen | `e2e.yml` | Required: 0 serious/critical |
| PWA and performance | Lighthouse CI on `/` and `/o/today` | `e2e.yml` | Required at the budgets in §11.10 |
| Preview smoke | Playwright subset against the PR's Worker Preview URL | `preview.yml` | Required |
| Nightly | Full E2E on the shared preview + dependency audit | `nightly.yml` | Reported |

### 14.2 Engine tests (minimum cases; each a row in a table-driven test)

| Group | Cases (at least) |
|---|---|
| Schedule resolution | NE before joining and after exit; roster override beats holiday; holiday beats week-off; week-off; default template; leave on a working day; leave on WO is ignored; duty on WO; split template; template crossing midnight |
| Worked and breaks | Break plateau 300→360; break not reached; break punches on with actual break; break not punched (auto + note); overbreak; presence outside segments excluded from `raw_in`; two separate in/out pairs |
| Late and early | Exactly at grace (0); grace + 1; late beyond grace; early ≤ tolerance; early = tolerance + 1; split shift late in segment 2 only; missed segment (no late/early); arrival before start |
| Make-up and overtime | Make-up covers all; partial; make-up off; OT below threshold; exactly threshold; block rounding down (44 → 30, 45 → 45); before-start ignored; before-start inside duty; duty after midnight; approvals partial; rejected |
| Status | 75% boundary both sides; 40% boundary both sides; no punches; leave paid; LOP leave; override wins; worked on WO credit 1.0 / 0.5 / minutes only |
| Monthly pay | Each divisor; join mid-month; exit mid-month; salary change mid-month; LOP clamp at `M_pro`; daily wage with and without paid holidays/week-offs; off-day extra pay; comp-off mode; OT multipliers 1/1.5/2/flat/comp-off/unpaid |
| Cap and advances | Advance fits; partial and carry; absence alone ≥ 50%; instalments with paise remainder; fines + damage + advance ordering; fines lapse after 90 days |
| Rounding | Line half-up at .5 paise; net rounding ±0.50; examples 1–12 of §7.15 reproduced exactly |
| Leave | CL proration for joiners; usable-after; comp-off expiry; sandwich on/off; blackout flag; split paid/unpaid |
| Fence and risk | PASS, UNCERTAIN, OUTSIDE, APPROXIMATE at boundaries; haversine against known pairs; every risk signal on/off; thresholds 29/30/60/61; QR override |

Property-based tests (fast-check) for: net = gross − deductions; deductions ≤ 50% gross unless absence alone exceeds it; day minutes never negative; `computeDay` is idempotent.

### 14.3 API tests (Workers pool)

Suites: auth (join, PIN rules, lockouts, device approval, new device, owner magic link + code, password, step-up, CSRF, version 426); punches (signature valid/invalid, nonce reuse, idempotency, fence outcomes, risk outcomes, selfie hash mismatch, offline bounds and envelope, QR window and reuse, too-early rule); days and overrides; leave and regularisation lifecycles; advances; payroll (draft, blockers, adjust, finalise locks, reopen revision, mark paid); exports (CSV shape, BOM); notifications (inbox rows, quiet-hours holding, batching, topic, 410 cleanup with a mocked push endpoint); cron jobs with a fake clock; retention purge; tenant isolation (two orgs, every route); rate limits; error shape for every code.

### 14.4 End-to-end (Playwright)

Projects: `staff-android` (Chromium, 390×844, touch, mobile UA), `staff-ios` (WebKit, 390×844, mobile Safari UA; no camera), `owner-desktop` (Chromium, 1280×800), `owner-phone` (Chromium, 390×844).

Fixtures: `context.setGeolocation` + `grantPermissions(['geolocation'])` per scenario (inside 22.4606479, 70.0565093; edge; 340 m outside; accuracy 1500 m); Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=e2e/assets/face.y4m`; `page.clock` for client time plus `/__test/clock` for server time; `/__test/reset` scenarios; `/__test/outbox` to assert pushes and emails; standalone display emulated with `?allowBrowser=1` on preview only.

| ID | Flow |
|---|---|
| E2E-01 | Owner setup checklist end to end |
| E2E-02 | Owner adds staff → invite → staff joins (Android path) → owner approves device |
| E2E-03 | Staff join on WebKit with the typed code (iOS path) |
| E2E-04 | Check in inside the fence → success → Today board shows her in |
| E2E-05 | Check in at the edge → flagged → owner clears the flag |
| E2E-06 | Check in outside → needs proof → scan door QR (owner's "Show door code" screen in a second page) → accepted with original time |
| E2E-07 | Approximate location → fix-it guide; permission denied → fix-it guide → send to owner → approved |
| E2E-08 | Selfie on: camera flow, thumbnail visible to owner |
| E2E-09 | Off-site duty created from a pasted Google Maps link → staff checks in at the venue |
| E2E-10 | Unplanned venue → owner "approve and let others check in here" → second staff checks in |
| E2E-11 | Offline punch queued (context offline) → back online → synced with `offline` tag |
| E2E-12 | Missed check-out → staff reminder → auto-close → regularisation → approved |
| E2E-13 | Leave request with blackout warning and paid/unpaid split → approved → month view |
| E2E-14 | Overtime: stays late → owner approves part |
| E2E-15 | Advance recorded → staff acknowledges |
| E2E-16 | Payroll October scenario: blockers → finalise anyway → numbers equal §7.15 example 11 → PDF ready → share fallback link → staff sees payslip → mark paid |
| E2E-17 | Reopen payroll → revision 2 → superseded PDF watermark |
| E2E-18 | Exports: register CSV and PDF downloaded and parsed |
| E2E-19 | Push: subscribe, server sends N2, service worker shows it (asserted through the SW in Chromium), click navigates |
| E2E-20 | Update prompt waits while a punch is queued |
| E2E-21 | Owner sign-in with the 6-digit code; password fallback; step-up before finalise |
| E2E-22 | Language switch to Gujarati on staff screens (from 1.1; until then asserts the fallback to English) |

### 14.5 Visual baselines

Every screen in §5 at 390 px (staff and owner phone) and the owner screens at 1280 px, in their main state plus empty, loading (skeleton frozen) and one error state; the `/__kit` page at both widths. Fake clock fixed at 10:42 IST on 19 Oct 2026; seeded data. Baselines are generated only in CI (`snapshots.yml`, manual dispatch) and committed to the PR branch; reviewers look at the diff images in the uploaded artifact.

### 14.6 Real-device checks before launch (Harsh, once, with the preview URL)

One low-end Android (Redmi or Realme, Chrome) and one iPhone (iOS 18 or 26): install, join, check in inside the salon (real GPS indoors), door QR scan, push received with the app closed, offline check-in in airplane mode then sync, payslip PDF share to WhatsApp. Results recorded in the release PR.

### 14.7 Definition of done (every work package and PR)

1. Code merged through a PR with green required checks; no AI attribution anywhere.
2. Acceptance criteria for the touched features (§14.8) pass in automated tests, each test named with the AC id (e.g. `S-04.3`).
3. Types strict, no `any` without a comment, no lint warnings.
4. New UI has visual baselines at 390 and 1280 (owner) and passes axe with 0 serious/critical.
5. Copy comes from the i18n catalog; no hard-coded user-facing strings.
6. Audit rows for every new mutation; zod schemas for every new input.
7. Docs updated: `docs/PRD.md` if behaviour changed (with a changelog line), runbooks if ops changed.
8. Budgets in §11.10 still met.

### 14.8 Acceptance criteria for P0 features

| ID | Acceptance criteria |
|---|---|
| S-01 | 1) A valid code + phone shows the staff name. 2) PINs `1111`, `1234`, `4321`, `0000` and the phone's last digits are rejected. 3) Completing join creates a `pending` device with a non-extractable key and a privacy-notice consent row. 4) The owner gets N19 within 5 s. 5) After approval the waiting screen switches to Today without reload. 6) An expired, used or unknown code shows its specific message. 7) 6th wrong code in an hour returns 429. |
| S-02 | 1) Phone + PIN + device signature signs in on an approved device. 2) A pending or revoked device cannot sign in. 3) 5 wrong PINs lock for 15 min with the unlock time shown; 10 in 24 h trigger N21. |
| S-03 | 1) Android shows our Install button only after `beforeinstallprompt`. 2) iOS Safari shows the 3-step sheet; other iOS browsers show "Open in Safari". 3) Staff routes in a browser tab show the install gate. 4) The installed app never shows install UI. |
| S-04 | 1) Inside the fence with accuracy ≤ 50 m, a check-in is accepted and stored with server time. 2) The success screen shows the server time, not the device time. 3) A second tap with the same idempotency key returns the first result. 4) Check-out works the same and shows hours worked. 5) Before the earliest check-in window, the API returns `TOO_EARLY` unless a duty or pre-approval covers it. 6) p95 server time ≤ 800 ms in the CI timing test. |
| S-05 | 1) Each risk signal adds its exact points (unit-tested). 2) Score 29 → accepted, 30 → flagged, 61 → pending. 3) A flagged punch never changes pay by itself. 4) Reasons are stored and shown to the owner in words. |
| S-06 | 1) The door token for the current and previous 30 s step is accepted; older is rejected with "That code has changed". 2) The same person cannot reuse a step. 3) A token from another site is rejected. 4) Scanning upgrades a pending punch and keeps its original time. 5) Works with `BarcodeDetector` and with the jsQR fallback. |
| S-07 | 1) With selfie off, no camera permission is ever requested. 2) With selfie on, only the live camera is used (no file input in the DOM). 3) The uploaded JPEG is ≤ 200 KB and its hash matches the signed hash. 4) Camera denied → the punch can go to approval with reason `selfie_missing`. 5) Selfies disappear from R2 after 30 days (lifecycle rule verified in CI). |
| S-08 | 1) Inside a duty's venue fence within its window, check-in is accepted and tagged `offsite`. 2) Mode "anywhere" accepts any location and records it. 3) "I'm at a venue" creates a pending punch and N17. 4) "Approve and let others check in here" creates a duty that a second staff member can use. |
| S-09 | 1) Offline, a punch is stored with a sealed PIN and shown as waiting. 2) It syncs on reconnect, app open and visibility change. 3) The server accepts it with `offline` when bounds hold, else pending. 4) No plaintext PIN exists in IndexedDB (asserted). 5) The update prompt waits while the queue is non-empty. |
| S-10 | 1) Today shows shift, status chip, live hours (updates each minute) and the last punch. 2) Week-off, leave and holiday states show their messages. 3) Offline shows cached data with the "Showing what we had at…" banner. |
| S-11 | 1) Month calendar statuses match `attendance_days`. 2) Day detail lists punches with tags and the pay effect in rupees. 3) Totals match the payroll engine's day results. |
| S-12 | 1) Balances shown per type. 2) Notice, blackout and balance warnings appear before sending. 3) Overlapping requests are blocked. 4) Approval updates days and the ledger; rejection keeps a reason. 5) Requests in a finalised month are blocked. |
| S-13 | 1) Only dates in the last 7 days of an open month. 2) One open request per day. 3) Approval creates `owner`-source punches, recomputes the day, and writes audit rows. |
| S-14 | 1) Staff see only their own payslips after finalise. 2) The PDF downloads and its numbers equal the snapshot. 3) Share uses the Web Share API with the file, else a wa.me link. |
| S-15 | 1) Every event in §6 writes an inbox row for the right recipient. 2) Push permission is requested only from a tap. 3) Unread count shows on the bell and the app badge. |
| S-16 | 1) My data lists punches with fence results and distance buckets, selfies still kept with deletion dates, and consents. 2) "Ask for a correction" opens a regularisation. |
| S-17 | 1) All staff strings come from `packages/i18n`. 2) Switching language re-renders without reload and persists. 3) Missing `gu` keys fall back to English. |
| O-01 | 1) The magic email contains a link and a 6-digit code, both valid 15 min, single use. 2) The code works inside the installed iOS app. 3) Password + PIN fallback works. 4) Step-up is required for the actions listed in §4.1.7 and lasts 10 min. 5) Responses never reveal whether an email exists. |
| O-02 | 1) `POST /setup` works once with `SETUP_TOKEN`. 2) The checklist prefills salon facts, location 22.4606479, 70.0565093, the five templates and the holidays. 3) Every step can be skipped and resumed. |
| O-03 | 1) Counters match the day's data. 2) The board refreshes within 30 s and immediately on a push. 3) Not-in-yet rows have working tel: and wa.me links. |
| O-04 | 1) Every item type in §4.12 appears with its actions. 2) Decisions notify the staff member and write audit rows. 3) Bulk approve works for same-type items except devices. 4) The count badge equals the number of open items. |
| O-05 | 1) The grid shows every staff × day with letter, icon and tint. 2) Row totals equal the engine. 3) Day detail shows punches, map with fence, selfie (if any), risk reasons and audit trail. |
| O-06 | 1) Overrides need a reason. 2) The staff member sees "Edited by Urmi" with the change. 3) Locked months refuse overrides until reopened. |
| O-07 | 1) Add, edit, invite, re-invite, reset PIN, exit. 2) Salary changes are effective-dated and need step-up. 3) Duplicate phone and rehire handled as in §4.1.1. |
| O-08 | 1) Week grid shows templates, WO, HO, leave and duties. 2) Swapping week-offs updates both days and notifies staff (N27). 3) Weekly hours above 48 show a warning. |
| O-09 | 1) Calibration stores samples per session. 2) The proposal follows the median/p95 rule. 3) Applying it needs step-up and is audit-logged. 4) Radius and accuracy limits are enforced. |
| O-10 | 1) Pairing with a one-time code gives the door device its secret. 2) The door screen shows a token that the API accepts. 3) "Show door code" on the owner's phone works without a door device. 4) Rotate invalidates old tokens immediately. |
| O-11 | 1) Duties accept current location, map pick, or a pasted Google Maps link (short links expanded; only Google hosts). 2) The duty window pre-approves overtime when the toggle is on. 3) Staff get N18. |
| O-12 | 1) Advances record amount, mode, plan. 2) Recovery follows the plan and the cap; carried amounts appear in the next draft. 3) Staff acknowledgement is recorded. |
| O-13 | 1) The draft appears on the 1st at 09:00 IST (cron, tested with the fake clock). 2) Blockers list with the stated defaults. 3) Finalise locks the month and freezes snapshots. 4) Reopen creates revision 2 and keeps revision 1 PDFs as superseded. 5) Mark paid per person and for all. 6) The October fixture reproduces §7.15 example 11 to the paisa. |
| O-14 | 1) A PDF per payslip is produced through Browser Run within 2 min of finalising. 2) It contains every field in §4.14. 3) The verify URL shows only the allowed fields. 4) On Browser Run failure the HTML fallback and owner notice appear. |
| O-15 | 1) Each export in §4.16 downloads in the stated formats. 2) CSVs open in Excel with correct Indian characters (BOM) and the stated column order. 3) Exports need step-up, are audit-logged and expire after 7 days. |
| O-16 | 1) Every setting in §4.17 is editable with validation and a "what this does" line. 2) Changes are audit-logged with before/after. 3) Pay-rule changes affect only new or recomputed drafts. |
| O-17 | 1) Each owner event in §6 fires at the stated time with the stated copy (fake-clock tests). 2) Quiet hours hold pushes until 08:00 except N19. 3) Batching merges same-type alerts within 5 min. 4) Topics collapse not-in-yet into late for the same person and day. |
| O-18 | 1) The audit log lists every mutation with actor, before/after and reason. 2) Filters by entity and date work. 3) No API exists to edit or delete audit rows. |
| X-01 | 1) One `wrangler deploy` ships assets, API and cron. 2) `/api/*` never returns `index.html`; unknown SPA routes do. |
| X-02 | 1) Lighthouse installability passes. 2) The app shell loads offline after the first visit. 3) Manifest, icons (any + maskable), apple-touch-icon and splash images are present and valid. |
| X-03 | 1) Every response carries the headers in §10.5. 2) The retention job removes data per §8.3 (fake-clock test). 3) Rate limits return 429 with `Retry-After`. |
| X-04 | 1) All suites in §14.1 run in Actions on every PR. 2) A failing suite blocks merge. |
| X-05 | 1) Every same-repo PR gets a Worker Preview URL posted as a comment. 2) The preview uses the preview D1 and R2, never production. |

---

## 15. CI/CD, environments, secrets and domain

### 15.1 Environments

| Environment | URL | Worker | D1 / R2 | Crons | Purpose |
|---|---|---|---|---|---|
| Local (CI only) | `http://localhost:8787` | `wrangler dev` | Miniflare local | Manual via `/__test/cron` | E2E and API tests in Actions |
| Preview (per PR) | The stable Preview URL that `wrangler preview --name pr-<n> --json` returns (posted on the PR) | `feelings-staff` (Preview) | `fbc-staff-preview` / `fbc-staff-media-preview` (shared by all previews, reset per E2E run with `/__test/reset`) | Do not run on Previews | Harsh reviews on his phone; smoke E2E |
| Production | `https://staff.feelingsbeautycare.in` | `feelings-staff` | `fbc-staff` / `fbc-staff-media` | Run | Live |

`wrangler.jsonc` sketch:

```jsonc
{
  "name": "feelings-staff",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-10-19",
  "compatibility_flags": ["nodejs_compat"],
  "upload_source_maps": true,
  "observability": { "enabled": true },
  "assets": { "not_found_handling": "single-page-application", "binding": "ASSETS",
              "run_worker_first": ["/api/*", "/v/*", "/q/*", "/__kit"] },
  "d1_databases": [{ "binding": "DB", "database_name": "fbc-staff", "database_id": "<prod-id>", "migrations_dir": "../migrations" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "fbc-staff-media" }],
  "browser": { "binding": "BROWSER" },
  "send_email": [{ "name": "EMAIL", "allowed_sender_addresses": ["staff@feelingsbeautycare.in"] }],
  "ratelimits": [
    { "name": "RL_IP", "namespace_id": "4101", "simple": { "limit": 300, "period": 60 } },
    { "name": "RL_SESSION", "namespace_id": "4102", "simple": { "limit": 120, "period": 60 } },
    { "name": "RL_PUNCH", "namespace_id": "4103", "simple": { "limit": 6, "period": 60 } }
  ],
  "triggers": { "crons": ["*/5 * * * *", "30 21 * * *"] },
  "vars": { "ENV": "production", "APP_ORIGIN": "https://staff.feelingsbeautycare.in", "EMAIL_PROVIDER": "cloudflare" },
  "previews": {
    "vars": { "ENV": "preview", "EMAIL_PROVIDER": "outbox" },
    "d1_databases": [{ "binding": "DB", "database_name": "fbc-staff-preview", "database_id": "<preview-id>" }],
    "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "fbc-staff-media-preview" }],
    "browser": { "binding": "BROWSER" }
  }
}
```

The custom domain is attached once in the dashboard (§15.4), not in the config, because the CI token has no DNS edit rights.

### 15.2 GitHub Actions workflows

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | PR, push to `main` | pnpm install (cached) → typecheck → Biome → `check-ui.mjs` → i18n check → engine and contracts tests → Workers API tests → build → size budgets → upload coverage |
| `e2e.yml` | PR, push to `main` | Playwright Docker image → build → apply migrations to local D1 → `wrangler dev` → Playwright (4 projects) with axe and visual → Lighthouse CI → upload report, traces, screenshots and diffs as artifacts |
| `preview.yml` | PR from a branch in this repo | Apply migrations to `fbc-staff-preview` (`wrangler.preview-migrations.jsonc`) → `wrangler preview --name pr-<n> --json` → comment the URL on the PR → smoke E2E against it |
| `deploy.yml` | Push to `main` (after `ci` and `e2e` pass) | `wrangler d1 export fbc-staff` to an artifact (pre-migration backup, kept 30 days) → `wrangler d1 migrations apply fbc-staff --remote` → `wrangler deploy` → smoke (`/api/v1/health`, `/api/v1/config`, home page) → tag `vYYYY.MM.DD-N` |
| `nightly.yml` | 02:00 IST daily | Full E2E against a fresh preview; `pnpm audit`; weekly D1 export to R2 `backups/` (P1) |
| `snapshots.yml` | Manual dispatch on a PR branch | Regenerate visual baselines in the Docker image and push a commit to the branch |

Rules: branch protection on `main` (required: `ci`, `e2e`, `preview`); merge commits (Harsh's convention); conventional commits with scopes (`feat(punch): …`); branches `feat/…`, `fix/…`; PR body with a **Preview:** line, what changed, results, and numbered acceptance checks; **no AI attribution** in commits, PRs or code.

**Rollback**: `wrangler rollback` to the previous Worker version (assets included). Migrations are additive only (never drop or rename in the same release as code that stops using a column); a bad migration is fixed forward, and D1 Time Travel (30 days) restores the database if needed.

### 15.3 Secrets and variables (names only)

**GitHub Actions secrets**

| Name | Use |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Wrangler deploys, previews, D1 migrations and exports, R2 lifecycle script. Account scopes: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read, plus any scope Wrangler asks for on the first preview or Browser Run deploy. No zone or DNS scopes |
| `CLOUDFLARE_ACCOUNT_ID` | Same |
| `E2E_TOKEN` | Header for `/__test/*` on previews |

**Worker secrets** (set per environment with `wrangler secret put` and `wrangler preview secret put`)

| Name | Use |
|---|---|
| `SESSION_SECRET` | HMAC for codes and tokens |
| `PIN_PEPPER` | PIN and password hashing |
| `TIME_SIGNING_KEY` | Signed server time |
| `IP_HMAC_KEY` | IP hashing |
| `QR_MASTER_KEY` | Encrypts door secrets (AES-256-GCM) |
| `PUNCH_ENC_PRIVATE_JWK` | RSA-OAEP private key for offline PIN envelopes (public key derived at runtime and served by `/config`) |
| `VAPID_PRIVATE_JWK` | Web Push signing |
| `SETUP_TOKEN` | One-time org setup |
| `RESEND_API_KEY` | Only if `EMAIL_PROVIDER=resend` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | P1 WhatsApp fallback |
| `E2E_TOKEN` | Preview only |

**Worker variables**: `ENV`, `APP_ORIGIN`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`mailto:` address), `OWNER_BOOTSTRAP_EMAIL`, `MIN_APP_VERSION`, `WHATSAPP_TEMPLATE_NAMESPACE` (P1).

Secrets are generated on Harsh's own machine (or by a one-off workflow that writes them straight to Wrangler) and never pasted into chats, issues or logs.

### 15.4 Domain and account setup (steps for Harsh)

1. **Workers Paid.** Cloudflare dashboard → Workers & Pages → Plans → subscribe to Workers Paid ($5/month) on the salon's account (the one that holds `fbc-analytics`).
2. **Repo.** Create the private repo `harshbhx/feelings-staff`; add branch protection on `main` after the first CI run.
3. **Resources.** `wrangler d1 create fbc-staff --location apac`, `wrangler d1 create fbc-staff-preview --location apac`, `wrangler r2 bucket create fbc-staff-media`, `wrangler r2 bucket create fbc-staff-media-preview`; put the ids in `wrangler.jsonc` and `wrangler.preview-migrations.jsonc`.
4. **API token.** Create a token with the scopes in §15.3; add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the repo's Actions secrets.
5. **Secrets.** Generate and set the Worker secrets for production and previews (a `scripts/gen-secrets.ts` prints the `wrangler secret put` commands; VAPID keys from `npx @pushforge/builder vapid`).
6. **Email.** Dashboard → Compute → Email Service → Email Sending → Onboard Domain → `feelingsbeautycare.in`. Cloudflare adds SPF, DKIM and DMARC records on the `cf-bounce` subdomain, so the existing Email Routing MX records are untouched. Set `EMAIL_FROM` to `Feelings Staff <staff@feelingsbeautycare.in>`.
7. **First deploy.** Merge the platform PR; `deploy.yml` deploys to `feelings-staff.<subdomain>.workers.dev`.
8. **Custom domain.** Dashboard → Workers & Pages → `feelings-staff` → Settings → Domains & Routes → Add → Custom domain → `staff.feelingsbeautycare.in`. Cloudflare creates the DNS record and certificate (a few minutes of 522 while the certificate issues is normal). HSTS from the apex already forces HTTPS.
9. **Bootstrap the owner.** Set `OWNER_BOOTSTRAP_EMAIL` to Urmi's email (Q18), then call `POST /api/v1/setup` once with `SETUP_TOKEN` (a `scripts/setup-org.ts` does it), and send Urmi the sign-in page.
10. **Disable `workers.dev`** for production once the custom domain works (Settings → Domains & Routes), keeping Preview URLs on.
11. **WhatsApp (P1).** Meta Business account, a verified number, and an approved utility template; then set the WhatsApp secrets.

### 15.5 Running cost (one salon, about 10 staff)

| Item | Monthly |
|---|---|
| Workers Paid (includes D1, R2 within free storage, crons, rate limiting) | $5 |
| Browser Run (10 browser-hours included; about 1 minute used a month) | $0 |
| Email Sending (3,000 included; under 100 used) | $0 |
| WhatsApp utility messages (P1, about 30–60 a month) | about ₹5–10 |
| **Total** | **about $5 (about ₹450)** |

---

## 16. Build plan for parallel agents

### 16.1 Ground rules

1. **Contracts first.** WP-1 writes `packages/contracts` from §8–§9 and §7.16 and tags it `contracts-v1`. After that, every change goes through a PR labelled `contract-change` that updates server and client together and is reviewed by the lead agent.
2. **Own your folders.** Each package owns the paths listed for it. Touching another package's path needs that owner's review. Shared files (`app/worker/index.ts`, `app/src/router.tsx`) are created by WP-1 with every area already mounted as a stub that returns 501 or a placeholder screen, so nobody edits them to add routes.
3. **Mock first, wire later.** UI packages build against `MockApiClient` (implements `ApiClient` from fixtures in `packages/contracts/fixtures`). Switching to the real client is a one-line provider change once the API lands.
4. **One branch per package** (`feat/wp3-auth`, …), split into PRs of reviewable size; more than one commit always means a PR, never a direct push to `main`. Conventional commits. No AI attribution in commits, PR bodies or code.
5. **Heavy work in Actions.** Builds, test suites, browsers and screenshots run in GitHub Actions only; builders watch with `gh run watch` and read failures with `gh run view --log-failed`.
6. **Done means §14.7** plus the package's own criteria below.

### 16.2 Packages, order and dependencies

| WP | Name | Size | Starts after | Blocks |
|---|---|---|---|---|
| WP-1 | Platform, contracts, CI and quality | L (front-loaded, then QA) | — | Everything (contracts, scaffold) |
| WP-2 | Design system and UI kit | M | WP-1 scaffold commit | WP-6, WP-7 (kit v0) |
| WP-3 | Auth, devices and staff accounts | M | `contracts-v1` | WP-4 (session), WP-6/7 (real sign-in) |
| WP-4 | Attendance: punches, fence, risk, door QR, off-site, leave, fixes, days | L | `contracts-v1`; session middleware stub from WP-1 | WP-5 (day results), WP-6/7 (real data) |
| WP-5 | Engine and payroll: rules, advances, payroll runs, payslips, exports | L | `contracts-v1` (engine is pure; can start day 1) | WP-4 (`computeDay`), WP-6 (payroll screens) |
| WP-6 | Owner panel | L | WP-2 kit v0 | Release |
| WP-7 | Staff app, PWA and offline | L | WP-2 kit v0 | Release |
| WP-8 | Notifications and scheduled jobs | M | `contracts-v1` | Release (N-events), WP-6/7 inbox |

```
Day 0-2   WP-1 scaffold + contracts-v1 + CI ─────────────────────────────┐
Day 1-6   WP-2 tokens → kit v0 → kit v1                                   │
Day 2-8   WP-3 ─┐  WP-4 ─┐  WP-5 engine → payroll API ─┐  WP-8 ─┐        │ WP-1: E2E harness,
Day 4-12        └────────┴──── WP-6 owner UI, WP-7 staff UI + PWA ─┴──────┤ fixtures, test routes
Day 12-15 integration: real client, cross-flow E2E, baselines, real-device check, release
```

The day numbers are a sequencing guide, not a promise. A package may finish early and pick up review work.

### 16.3 Contracts between packages

**Shared types (`packages/contracts`, owner WP-1)**

| Kind | Names |
|---|---|
| Enums | `Role`, `PunchKind`, `PunchSource`, `PunchStatus`, `FenceResult`, `RiskReason`, `DayType`, `DayStatus`, `DayTag`, `LeaveCode`, `RequestStatus`, `SalaryType`, `Divisor`, `OtRateMode`, `OffsiteMode`, `PayslipLineCode`, `NotifyEventType` (N1–N31), `ErrorCode` |
| API schemas | `Me`, `OrgSettings`, `OrgSettingsPatch`, `StaffCreate`, `StaffView`, `StaffPatch`, `ShiftTemplate`, `RosterChange`, `Holiday`, `Site`, `OffsiteDuty`, `PunchRequest`, `PunchResult`, `TodayView`, `MonthView`, `DayDetail`, `OwnerDayDetail`, `DayOverride`, `LeaveRequestCreate`, `LeaveRequest`, `RegularisationCreate`, `Regularisation`, `AdvanceCreate`, `Advance`, `AdjustmentCreate`, `PayrollRunView`, `PayslipSummary`, `PayslipView`, `ExportRequest`, `Notification`, `NotificationPrefs`, `ActionItem` (discriminated union), `TodayBoard`, `RegisterView`, `ApiError`, `Paginated<T>` |
| Engine types | `DaySchedule`, `PunchForCalc`, `DayResult`, `TimeRules`, `PayRules`, `PersonPay`, `PayslipResult`, `PayslipLine`, `CarryForward`, `RiskInput`, `RiskResult`, `Fix`, `SiteGeo` |
| Events | `NotifyEvent` union, one variant per `NotifyEventType`, each with `orgId`, recipients rule, ids and display fields |
| Client | `ApiClient` interface (one method per endpoint in §9.4); `fixtures/*.json` valid examples for every response |

**Server ports (`app/worker/services/ports.ts`, owner WP-1; implementations by the named package)**

```ts
export interface Clock { now(): number }                                         // WP-1 (fake in tests)
export interface Audit { log(ctx: Ctx, e: AuditEntry): Promise<void> }           // WP-1
export interface Notifier { emit(ctx: Ctx, e: NotifyEvent): Promise<void> }      // WP-8
export interface StepUp { require(ctx: Ctx): Promise<void> }                     // WP-3
export interface DayService { recompute(ctx: Ctx, userId: string, date: string): Promise<DayResult> } // WP-4
export interface PayrollService {                                                // WP-5
  draft(ctx: Ctx, month: string): Promise<PayrollRunView>
  recompute(ctx: Ctx, runId: string): Promise<PayrollRunView>
  finalise(ctx: Ctx, runId: string, acceptDefaults: boolean): Promise<PayrollRunView>
}
export interface PdfRenderer { render(template: 'payslip'|'register'|'salary_register', data: unknown, lang: 'en'|'gu'): Promise<ArrayBuffer> } // WP-5
export interface PushSender { send(sub: PushSub, payload: PushPayload, opts: PushOpts): Promise<PushOutcome> } // WP-8
export interface EmailSender { send(msg: EmailMessage): Promise<void> }          // WP-8 (WP-3 uses it)
export interface MapsResolver { resolve(url: string): Promise<{ lat: number; lng: number; label?: string }> } // WP-4
```

`Ctx` carries `env`, `orgId`, `user`, `role`, `permissions`, `requestId` and the org-scoped repositories. Every port has a fake in `app/worker/test/fakes/` (owner: the implementing package) so packages test without each other.

**Client seams**

| Seam | Owner | Used by |
|---|---|---|
| `@fs/ui` components and tokens | WP-2 | WP-3, WP-6, WP-7, WP-8 |
| `src/lib/device-key.ts` (generate, load, sign, persist) | WP-3 | WP-4 punch module, WP-7 |
| `src/lib/punch/` (`usePunchFlow` state machine, location sampler, payload builder, QR scanner) | WP-4 | WP-7 (renders it) |
| `src/pwa/queue.ts` (`enqueue`, `flush`, `subscribe`) | WP-7 | WP-4 punch module |
| `src/pwa/sw.ts` (service worker entry) | WP-7 | imports `sw/push-handlers.ts` from WP-8 |
| `src/features/inbox/` (shared inbox and bell) | WP-8 | WP-6, WP-7 |
| `packages/templates` (React payslip and register print components) | WP-5 | Worker PDF render, WP-6 and WP-7 payslip views |
| `packages/i18n` namespaces | WP-7 (`common`, `staff`, `errors`, `notify`), WP-6 (`owner`), WP-5 (`payslip`) | everyone |

### 16.4 Work packages

#### WP-1. Platform, contracts, CI and quality

- **Scope (phase A, first)**: pnpm monorepo; `app/` Vite + `@cloudflare/vite-plugin` + React + Hono skeleton; `wrangler.jsonc` and `wrangler.preview-migrations.jsonc`; `migrations/0001_init.sql` exactly as §8.2; org-scoped repository base and `DB.batch` helpers; middleware (request id, security headers and CSP §10.5, CSRF, version/426, error mapper to §9.2, rate-limit bindings, org context); `Clock` and `Audit`; `/health`, `/config`, `/owner/settings`, `/owner/audit`; `packages/contracts` complete for v1 with fixtures and `MockApiClient`; route and screen stubs for every area; Biome, `check-ui.mjs`, size budgets; all six workflows in §15.2; Worker Previews; seed script; `docs/runbooks/` skeletons.
- **Scope (phase B, alongside others)**: Playwright harness in `e2e/` (projects, fixtures for geolocation, fake camera `face.y4m`, fake clock, outbox), `/__test/*` routes, visual and axe helpers, Lighthouse CI config, tenant-isolation test framework.
- **Scope (phase C, integration)**: cross-flow suites E2E-01 to E2E-22, visual baselines for every screen, the release checklist, real-device check script for Harsh.
- **Owns**: `package.json`, `pnpm-workspace.yaml`, `app/vite.config.ts`, `app/wrangler*.jsonc`, `app/worker/index.ts`, `app/worker/middleware/`, `app/worker/db/`, `app/worker/services/ports.ts`, `app/worker/test-routes.ts`, `app/src/main.tsx`, `app/src/router.tsx`, `app/src/api/`, `packages/contracts/`, `migrations/`, `e2e/`, `scripts/`, `.github/`, `docs/runbooks/`.
- **Done when**: CI is green on an empty app; a PR gets a Preview URL; `contracts-v1` tag exists with every name in §16.3 and fixtures validating against their schemas; the tenant-isolation framework runs; later, every E2E in §14.4 passes and baselines exist.

#### WP-2. Design system and UI kit

- **Scope**: `tokens.css` copied verbatim; `app-tokens.css` (§12.3); Tailwind v4 theme (locked); font and icon setup; every component in §12.6 with all states; `Bindi`; motion utilities with reduced-motion tiers; the `/__kit` page; `check-ui.mjs` rules list; a11y of every component (keyboard, labels, focus).
- **Owns**: `packages/ui/`, `app/src/styles/`, `app/src/features/kit/`.
- **Done when**: kit v0 (Button, Field, Chip, StatusChip, Sheet, Toast, ListRow, TabBar, PinPad, Skeleton, EmptyState) merged by day 3; kit v1 (all) by day 6; kit page baselines at 390 and 1280; axe clean; no hex colours outside styles.

#### WP-3. Auth, devices and staff accounts

- **Scope**: invites and join codes; join verify/complete; PIN rules, hashing and lockouts; device keys (client lib and server verification), approval, one-approved-device rule, new phone flow; staff sign-in with challenge signature; owner magic link + 6-digit code; password + PIN; step-up; sessions (cookies, sliding, revoke, sign out others); `/setup`; staff CRUD API including effective-dated salary and exit; managers and permissions (P1); consents storage; client screens for join, sign-in, waiting-for-approval, owner sign-in, step-up sheet.
- **Owns**: `app/worker/routes/auth/`, `app/worker/routes/staff/`, `app/worker/services/{auth,session,device,pin,invite}.ts`, `app/src/features/auth/`, `app/src/lib/device-key.ts`.
- **Interfaces**: implements `StepUp`; uses `EmailSender`, `Notifier` (N19–N21), `Audit`.
- **Done when**: ACs S-01, S-02, O-01, O-07 (API part) pass; API tests cover every auth error code; WebKit E2E join path passes.

#### WP-4. Attendance

- **Scope**: nonces and signed time; `POST /punches` pipeline (§13.2) with multipart selfie to R2; `packages/engine/src/{fence,risk}`; door devices, pairing, TOTP tokens, door screen; off-site duties, Google Maps link resolver, unplanned venue flow; leave types, ledger, requests; regularisations; overtime decisions and pre-approvals; roster, templates, holidays, blackout days; sites and calibration; `DayService` (calls the engine) and day recompute triggers; owner Today board, actions, register, day detail and override APIs; My data API; client `src/lib/punch/` and `src/lib/geolocation.ts`, QR scanner worker.
- **Owns**: `app/worker/routes/attendance/`, `app/worker/routes/owner/{today,actions,register,days,roster,sites,duties,door}.ts`, `app/worker/services/{punch,fence,risk,day,door,duty,leave,regularisation,maps}.ts`, `packages/engine/src/{fence,risk}/`, `app/src/lib/punch/`, `app/src/lib/geolocation.ts`, `app/src/lib/qr/`, `app/src/features/door/`.
- **Interfaces**: implements `DayService`, `MapsResolver`; uses `computeDay` from WP-5 (stubbed until it lands), `Notifier` (N2–N18), `Audit`, the queue from WP-7.
- **Done when**: ACs S-04 to S-09 (server and logic), S-11 to S-13, S-16, O-03 to O-06, O-08 to O-11 pass in API tests; risk and fence unit tests at 100% branches.

#### WP-5. Engine and payroll

- **Scope**: `packages/engine` schedule, day, pay, leave accrual (§7), with the table-driven and property tests in §14.2 and the 12 examples of §7.15 as fixtures; advances and recoveries; payroll runs (draft, blockers, adjustments, recompute, finalise, reopen, mark paid); payslip snapshots and verify tokens; `packages/templates` (payslip and register print components); `PdfRenderer` via Browser Run with retries and the HTML fallback; exports (CSV and PDF) with R2 storage; payroll cron entry points (`draft for month`, `pay-day check`) exposed for WP-8 to schedule.
- **Owns**: `packages/engine/src/{schedule,day,pay,leave,money}/`, `packages/templates/`, `app/worker/routes/payroll/`, `app/worker/services/{payroll,payslip,pdf,export,advance}.ts`.
- **Interfaces**: implements `PayrollService`, `PdfRenderer`, `computeDay`, `computePayslip`; uses `Notifier` (N22–N26), `Audit`.
- **Done when**: engine coverage 100% branches; examples 1–12 reproduce to the paisa; ACs O-12 to O-15, S-14 (API) pass; a PDF renders in the preview environment.

#### WP-6. Owner panel

- **Scope**: every owner screen in §5.2 on phone and desktop, with empty, loading and error states: setup checklist, Today, Needs action (all item types, bulk), Register and day detail (with map and selfie compare), Staff list, profile tabs and add/invite with share sheet, Roster and off-site duty form, Payroll list, run review and payslip review, Advances, Reports, Show door code, Settings (all sections), Audit log; owner i18n namespace.
- **Owns**: `app/src/features/owner/`, `packages/i18n/*/owner.json`.
- **Interfaces**: `ApiClient`, `@fs/ui`, `packages/templates`, inbox from WP-8, `StepUp` sheet from WP-3.
- **Done when**: ACs O-02 to O-18 (UI parts) pass in E2E; baselines at 390 and 1280; axe clean; Lighthouse budget on `/o/today`.

#### WP-7. Staff app, PWA and offline

- **Scope**: every staff screen in §5.1; the check-in sheet UI on top of `usePunchFlow`; fix-it guides with platform screenshots; install gate and install UX (§4.2); manifest, icons and splash generation; service worker (precache, runtime caching §11.4, update flow §11.7); IndexedDB stores and the offline queue (§11.5); storage persistence; language switch and the `common`, `staff`, `errors`, `notify` catalogs (English P0; Gujarati in 1.1).
- **Owns**: `app/src/features/staff/`, `app/src/pwa/` (except `sw/push-handlers.ts`), `app/public/` icons and manifest, `packages/i18n/*/{common,staff,errors,notify}.json`.
- **Interfaces**: `usePunchFlow` and `device-key` (WP-4, WP-3), push handlers (WP-8), `@fs/ui`.
- **Done when**: ACs S-03, S-04 to S-17 (UI parts), X-02 pass; Lighthouse installable; offline E2E (E2E-11, E2E-20) pass on Chromium and the WebKit layout baselines exist.

#### WP-8. Notifications and scheduled jobs

- **Scope**: `Notifier` (inbox rows, recipients, prefs, batching, topics, quiet hours, held release); `PushSender` with `@pushforge/builder`, VAPID, 404/410/413/429 handling; push subscribe API and client `push.ts`; service-worker push and click handlers; inbox UI and bell (shared); `EmailSender` (Cloudflare binding, Resend adapter, outbox adapter for tests); email templates (magic link P0, digests P1); `scheduled()` rules engine and nightly job (§9.5) with `cron_runs` idempotency, including auto-close, absent marking, reminders, summaries, retention purge (§8.3), comp-off expiry, CL/SL credits; R2 lifecycle script; WhatsApp adapter behind a flag (P1).
- **Owns**: `app/worker/routes/notify/`, `app/worker/services/{notifier,push,email,whatsapp}.ts`, `app/worker/cron/`, `app/src/pwa/sw/push-handlers.ts`, `app/src/pwa/push.ts`, `app/src/features/inbox/`, `scripts/r2-lifecycle.ts`.
- **Interfaces**: implements `Notifier`, `PushSender`, `EmailSender`; calls `DayService` and `PayrollService` from cron.
- **Done when**: every row of §6 has a fake-clock test that asserts recipient, channel, timing and copy; quiet hours and batching tested; ACs S-15, O-17, X-03 (retention) pass; a real push reaches an Android test device from the preview (manual, recorded in the PR).

### 16.5 Integration and release

1. Switch both UIs to the real `ApiClient`; remove mocks from production builds.
2. WP-1 runs the full E2E, visual and axe suites; fix-forward in the owning package.
3. Harsh runs the real-device checklist (§14.6) on the preview.
4. Urmi does a 20-minute walkthrough on her phone (setup, approve a device, Today, a test payroll on seeded data) and answers the open questions still on defaults.
5. Production deploy, custom domain, owner bootstrap (§15.4), invite staff in one sitting at the salon (install, join, approve, first check-in together).
6. First real month: run payroll in parallel with the paper register; compare; fix rules before trusting it alone.

---

## 17. Risks and open questions

### 17.1 Where this PRD sharpens the announced defaults

These keep Harsh's defaults but change a detail because the research showed a hard problem.

| # | Announced default | What changed and why |
|---|---|---|
| F1 | Staff join by invite link | The link still works, but staff also **type a join code inside the installed app**. iOS Home Screen apps do not share storage with Safari, so a link opened in Safari cannot hand the session to the installed app. |
| F2 | Owner signs in with an email magic link | The email also carries a **6-digit code**, for the same iOS reason: a link tapped in Mail opens Safari, not the installed app. |
| F3 | Staff log in with phone + PIN | The PIN is also asked **on every punch** (owner can turn this off), and offline punches carry the PIN **sealed with the server's public key**, so an unlocked phone cannot be used to punch for someone else even offline. |
| F4 | Salary rules use the research defaults | The 50% deduction cap includes absence (as the research says), but absence that alone exceeds 50% is still applied in full and only recoverable deductions are held back. Paying for unworked days is not required; the CA should confirm the reading (Q19). |
| F5 | Notifications with a WhatsApp fallback | Automated WhatsApp needs a Meta Business account, a verified number and approved templates, so it is **P1**. P0 is push + in-app inbox, plus manual WhatsApp share links. |
| F6 | Selfie optional, with liveness | The selfie toggle is P0; the **blink liveness check is P1** (MediaPipe is a heavy download for low-end phones; it loads only when selfies are on). |
| F7 | Payslip PDF in English and Gujarati | PDFs are rendered with **Browser Run** from HTML, because Worker PDF libraries cannot shape Gujarati script. English at launch, Gujarati in 1.1. |
| F8 | Cloudflare Worker with crons | **Crons do not run on Worker Previews**, so previews expose test-only endpoints to trigger jobs, guarded by a token and absent in production. |

### 17.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Indoor GPS at Om Residency is too poor, causing many UNCERTAIN punches | Medium | Staff frustration, owner noise | Calibration with real phones; UNCERTAIN alone (35 points) only flags; salon Wi-Fi signal; door QR; tune R and A_max from the first two weeks of data |
| Staff phones kill Chrome in the background (Xiaomi, Oppo, Vivo) so reminders arrive late | High | Missed reminders | Battery-setting guidance; reminders are nice-to-have, the owner's alerts are what matter; inbox is the source of truth |
| iPhone staff do not install the app properly | Medium | No push, no device key | Install gate; illustrated steps; Harsh or Urmi installs it with them on day one |
| Staff feel watched | Medium | Low adoption, resentment | Location only at the tap, said plainly; no streaks or scores; selfies off by default; My data screen; flags never cut pay |
| Owner finds payroll numbers different from her habit (she may use ÷30 or ignore lateness) | High | Distrust | Every rule is a setting; first month in parallel with paper; formulas on every line |
| Legal reading of OT, cap or fines is wrong for her case | Medium | Compliance | Defaults are protective; CA review before the first real payroll (Q19); disclaimer in settings |
| Cloudflare Email Sending is in beta | Low | Owner cannot sign in | Password + PIN fallback; Resend adapter switch |
| `@pushforge/builder` is a small project | Low | Push breaks after an update | Pinned version, wrapped interface, alternative library ready, push E2E in CI |
| Browser Run outage when payslips are due | Low | No PDF for a while | HTML payslip and print fallback; retries |
| Lost phone means lost device key | Medium | Staff cannot punch until approval | "I have a new phone" flow; owner approves in one tap |
| A minor (academy trainee) is enrolled | Low | DPDP children's data rules | Required "18 or older" tick; trainees under 18 out of scope (Q21) |
| Parallel agents drift from the contracts | Medium | Integration pain | Contracts frozen and versioned; mock client from fixtures; contract tests in CI |

### 17.3 Open questions for the owner (with the default we build if unanswered)

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Is a muted green for "present" OK, or should every state stay in the red family? | Use the muted forest green `#2f6b47` with icon + word; fallback ink + filled check |
| Q2 | How many staff, which roles, and who takes which weekday off? Does everyone work Sunday 10–13? | Templates from §7.3; each person one fixed weekday off; Sunday short shift for all who work Sundays |
| Q3 | Which salary divisor do you use today: calendar days, 30 or 26? | Calendar days |
| Q4 | Is overtime paid today, and how? | 2× after approval (owner can pick 1×, 1.5×, flat, comp-off or unpaid) |
| Q5 | What happens with late arrivals today? | Pro-rata minutes after 10 min grace; fines off |
| Q6 | Which phones do you and the staff use (Android or iPhone, how old)? | Support both; test on a low-end Android and an iPhone |
| Q7 | Do you want a selfie at check-in? | Off; you can turn it on for everyone or one person |
| Q8 | Is there a spare phone or tablet for the door QR? | No door device; your phone's "Show door code" is the fallback |
| Q9 | Does the salon have Wi-Fi that staff phones join? | Use it as a positive signal if present; nothing breaks without it |
| Q10 | Which languages for the staff app and payslips? | English at launch; Gujarati in 1.1; Hindi later if asked |
| Q11 | Which 5 festival holidays besides 26 Jan, 15 Aug and 2 Oct? Which blackout days? | Uttarayan, Holi, Janmashtami, Dussehra, Diwali; no blackout days until you add them |
| Q12 | Should a senior staff member get manager rights? | The role exists; nobody holds it |
| Q13 | Who approves off-site wedding check-ins? | You, and managers with the `offsite` permission |
| Q14 | What is the current minimum wage for your zone and category? | Check on, figure empty until you enter it (no warning shown until then) |
| Q15 | Do you want automated WhatsApp alerts (needs a Meta Business account and number)? | No; push + inbox + manual WhatsApp share |
| Q16 | (Harsh) Is Workers Paid active on the salon's Cloudflare account? | Harsh enables it before the first deploy |
| Q17 | (Harsh and Urmi) Sign a one-page processor agreement (salon = data fiduciary, Harsh = processor)? | Yes, before launch; template in `docs/legal/` |
| Q18 | Which email should the owner account use? | Urmi's personal email, set by Harsh in `OWNER_BOOTSTRAP_EMAIL` |
| Q19 | Will a CA confirm the payroll defaults (2× OT, 50% cap reading, no fines)? | Ship with the defaults and a settings disclaimer; first month in parallel with paper |
| Q20 | Do staff work venue duties before 06:00 or after 21:00, and do they agree to it? | Flag night hours and ask each affected person for a one-time consent tick |
| Q21 | Are any staff or trainees under 18? | Not enrolled in v1 |
| Q22 | Is recolouring the logo (maroon wordmark) approved, and is there a vector logo? | Use the bindi icon and the masked maroon wordmark; ask for an SVG |
| Q23 | Domain: `staff.` or `team.feelingsbeautycare.in`? | `staff.feelingsbeautycare.in` |
| Q24 | Should payslips be visible to staff in the app? | Yes, after you finalise |

---

## Appendix A. Traceability to the original request

| Harsh asked for | Where it is |
|---|---|
| Owner panel; owner gets notifications and follows all workers' attendance | §4.12, §5.2, §6 (O-03, O-04, O-05, O-17) |
| Location lock on the staff side, "and whatever else is needed" | §4.3–§4.6, §10.1, §10.4 (geofence, accuracy, device key, PIN, risk score, door QR, off-site) |
| Salary, overtime and undertime tracking | §7 (formulas, examples), §4.13 (payroll run), §4.10 (advances) |
| Production-ready website with proper PWA features, end-to-end, UI tested, with notifications | §11 (PWA), §14 (tests, ACs), §15 (CI/CD), §6 (notifications) |
| Non-generic UI in the Feelings Beauty Care brand colours | §12 (tokens copied exactly, status colours, the bindi, anti-slop checklist and CI enforcement) |
| Defaults: staff. subdomain, private repo, phone + PIN, invite, owner device approval, no SMS OTP, owner magic link or password + PIN, 100 m geofence, optional selfie, off-site mode, owner-editable salary rules, lawful defaults, fines off | Document header, §4.1, §4.4, §4.6, §7.14, §17.1 |

## Appendix B. Sources

The two research files in `research/` carry the full citations (Code on Wages 2019, Wages (Central) Rules 2026, Gujarat Shops and Establishments Act 2019 and its 2026 amendment, DPDP Act 2023 and Rules 2025, W3C Geolocation, WebKit on Web Push and storage, RFC 8030, 8291 and 6238, Cloudflare documentation). Cloudflare facts used for the architecture were re-checked on 19 Oct 2026: Worker static assets with `run_worker_first`, the GA rate-limit binding (10 or 60 s periods), Worker Previews with per-preview D1 and R2 bindings and no crons, Email Sending (beta, Workers Paid, 3,000 emails a month included) and Browser Run (10 browser-hours a month included on Workers Paid).

## Appendix C. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 19 Oct 2026 | First complete PRD for build |
