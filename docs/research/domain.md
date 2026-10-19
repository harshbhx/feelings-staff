# Feelings Attendance: domain research for the PRD

- **Prepared:** 19 Oct 2026, by `attendance-domain-research` (read-only research, nothing built)
- **Client:** Feelings Beauty Care, a ladies' beauty parlour, bridal studio and makeup academy. Om Residency, Hirji Mistry Road, Jamnagar, Gujarat 361006. Pin `22.4606479, 70.0565093` (from `ref/feelings-beauty-care/src/data/site.ts`). Public hours: Mon–Sat 10:00–20:00, Sun 10:00–13:00 (still to be confirmed with the owner).
- **Product:** a staff attendance PWA. It has an owner panel with notifications and an all-staff view, a staff app with a location lock, and salary, overtime and undertime tracking. It should be multi-tenant so other salons can use it later.
- **Legend:** ✅ = recommended default for the PRD. Anything marked *(verify)* came from secondary sources or from knowledge that was not re-checked in a primary source.

---

## 0. Top recommendations (TL;DR)

1. ✅ **Check-in proof is layered and risk-scored, not GPS-only.** A browser cannot detect mock or fake GPS, so each punch combines: device-bound key + PIN, geofence check that uses `accuracy`, a live selfie with a blink check, and server time. A rotating QR at the salon door is the fallback, and the "strong mode" for flagged punches. Low-risk punches are accepted automatically. Medium-risk punches are accepted and flagged for the owner. High-risk punches need the QR or owner approval.
2. ✅ **Geofence radius of 100 m around a calibrated salon point, with accuracy gating.** Pass when `distance ≤ R` and `accuracy ≤ 50 m`. Treat it as uncertain (flag, ask for the QR) when the accuracy circle only overlaps the fence. Block when the whole 95% circle is outside. Readings with `accuracy ≥ 1000 m` are rejected as "approximate location".
3. ✅ **Location is recorded only at check-in and check-out.** No background tracking (a PWA can't do it anyway). Raw coordinates are kept for 90 days and selfies for 30 days. Attendance and wage records are kept for 5 years.
4. ✅ **Notifications: an in-app inbox is the source of truth, Web Push is the fast path, and WhatsApp/email are the fallback.** On iPhone, push works only after the PWA is installed to the Home Screen (iOS 16.4+), and permission must be asked from a tap. Use the Declarative Web Push JSON shape and always show a notification, or Safari drops the subscription after 3 silent pushes.
5. ✅ **Payroll defaults that a small Gujarat salon understands and that stay inside the Code on Wages:** monthly salary ÷ calendar days, per-minute rate = per-day ÷ scheduled minutes, a 10-minute grace, late and early minutes deducted pro rata, overtime tracked after 30 minutes past shift end and paid at 2× once the owner approves (the owner can change the multiplier), one paid weekly off, and advances recovered with a 50%-of-wages cap. "3 lates = half day" is **off by default**: under the Code on Wages it counts as a fine (capped at 3%, needs prior approval and a show-cause step).
6. ✅ **Stack: Cloudflare Workers (static assets + API) + D1 + R2 + Cron Triggers on Workers Paid ($5/month).** The salon's site already runs on Cloudflare (Pages + D1). Use `@pushforge/builder` for VAPID push, because the classic `web-push` package fails on Workers.
7. ✅ **Staff auth: an invite link from the owner (shared on WhatsApp), then a 4–6 digit PIN and a non-extractable device key.** No SMS OTP, which avoids DLT registration and per-OTP costs. Owner auth: email magic link or passkey, with WhatsApp OTP optional.
8. ✅ **Store all instants in UTC and attach every punch to an IST `work_date` of its shift.** Cron Triggers run in UTC, so 10:30 IST = 05:00 UTC.

---

## 1. Competitors and patterns

### 1.1 Feature matrix (what the good apps do)

| App | Market | Check-in methods | Anti-buddy-punching | Payroll link | Notes worth copying |
|---|---|---|---|---|---|
| **PagarBook** | Indian SMB | Selfie or face, GPS, flexi shifts, offline punches synced later | Face match ("Lens"), GPS kept on the record | Salary auto-calculated from attendance, advances, bonus, OT and fines. Late grace + slab "set once, applied evenly". OT at a multiplier (e.g. 1.5×), with a separate band for week-off work. Advances "recovered on its own". Payslips in the staff's language | ₹499/staff/yr app, ₹699 with web dashboard, ₹1,398 with face (+GST). Week-offs per person, team or site. "Six outcomes for a day worked on an off" [1] |
| **Khatabook → Pagarkhata** | Indian SMB | Attendance register, leave | Basic | Wages, payslips, salary calculation, 13 languages | Shows the "register + salary" mental model of Indian owners [2] |
| **SalaryBox** | Indian SMB | Selfie + location, geofence, GPS for field staff | Selfie with time and location | Policies for late coming, early leaving, half day; auto OT pay; hourly/daily/monthly; PF/ESI/LWF/TDS | Has a salon payroll guide (split shifts 10–2 / 5–9, wedding-season demand of 2–3×) [3][4] |
| **Jibble** | Global, big in India | Face, PIN, NFC, QR, kiosk "Speed Mode" | Face recognition with depth-based anti-spoofing, geofences, kiosk geofence | Timesheets → payroll export | Geofence clock-in restriction. Automatic geofence clock-in needs a **300 m minimum radius**. GPS reminders on arrival [5][6][7] |
| **Zoho People** | Indian mid-market | Web/mobile check-in | **IP restriction** (static IPs recommended, dynamic IPs change about every 72 h) and geo restriction. Zoho itself warns that browser location "may become inaccurate" if the user alters it | Attendance → payroll, regularization requests | Regularization flow (employee requests a fix, manager approves). Late/early arrival reports, muster roll [8] |
| **factoHR** | Indian mid-market | Selfie + location, AI face with liveness, kiosk, supervisor punches for others | Geofence, selfie, face liveness | Full payroll | Supervisor marks attendance for staff with photo and location (useful as owner override) [9] |
| **StaffAny** | SEA F&B and retail | GPS, GPS + photo, geofence + QR, geofence + photo, WiFi, **Dynamic QR**, live face | Recommends a **≥ 50 m radius** because "phone GPS inaccuracy especially in buildings/basements". Dynamic QR **refreshes every 5 s** on a fixed in-store device | Timesheets update live, edits audited | Per-section clock method. Dynamic QR keeps refreshing offline [10][11] |
| **QuickHR** | SEA | Face, geofence, offline mode | Face, geofence | Payroll | Offline clock-in [12] |
| **OnTheClock** | US SMB | Mobile, web | Photo at clock-in, **approved devices only**, job-site zones | Payroll exports | Device restriction is a cheap, strong control [13] |
| **Homebase** | US SMB (restaurants/retail) | Mobile geofenced clock-in, kiosk | Geofence (150 ft / 1 block / 5 blocks), blocks early clock-ins (setting under Schedule Enforcement) | Timesheets → payroll | Real-time view of who is in, late and no-show. Alerts for late, missed breaks and **forgotten clock-outs**. Auto clock-out after shift end (use with care: it can hide overtime) [14][15] |
| **Deputy** | Global SMB | Mobile, kiosk | Geofence, photo | Timesheet approval | "Late to clock on/off" alert with a configurable number of minutes, sent to employee, manager or both [16] |
| **7shifts / RosterElf** (pattern refs) | Restaurants | Mobile, kiosk | Geofence | Labor vs schedule | "Who's Working": who is in, who is late, labor hours vs schedule, OT warnings, all live [17][18] |

**Takeaways for us**
- Indian SMB apps (PagarBook, SalaryBox, Pagarkhata) win on **salary auto-calculation from attendance, with late fines, OT, advances and payslips in local languages**, not on fancy timekeeping. The owner thinks in a monthly **register** (P / A / ½ / L / WO / H per day) and a salary sheet.
- Western apps (Homebase, Deputy, 7shifts) win on a **live "who's working" view, exception alerts (late, no-show, forgot to clock out, overtime) and approvals**.
- Every serious app uses **layers**: geofence + photo/face + device restriction, with QR or kiosk as the hard proof. None of them relies on GPS alone.
- Vendors don't publish spoof-detection details. The general advice is to treat GPS anomalies as **indicators for human review, not proof** [19][20].

### 1.2 Owner panel layout ✅

Phone-first; the owner will mostly use it on her phone.

1. **Today** (home):
   - Counter chips: `Present 6 · Late 2 · Not in yet 1 · On leave 1 · Week off 2`. Tapping a chip filters the list.
   - **Needs action** card (count badge): flagged punches, leave requests, regularizations, OT approvals, device changes. Approve or reject inline.
   - **Who's in now** list: photo thumbnail, name, in-time, a `+18m late` badge, a location badge (`Inside` / `Flagged` / `Outdoor duty`), and live hours worked.
   - **Not in yet** list with a one-tap "Call" or "WhatsApp" link.
2. **Register** (month grid, staff × days): colour-coded P / ½ / A / L / WO / H / OT dots, totals per row (present days, late minutes, OT hours, LOP days). Tapping a cell opens the day detail (punches, selfie, map pin, audit trail of edits).
3. **Staff** (profile): salary setup, shift and week-off, leave balances, advances ledger, devices, documents, exit.
4. **Payroll** (monthly run): Draft → review adjustments → Finalise → payslips (share on WhatsApp / PDF) → mark Paid (date and mode).
5. **Reports:** see §1.5.
6. **Settings:** salon location and geofence calibration, shifts, holidays, policies (grace, half-day, OT, late rules), notifications, door QR, data retention.

### 1.3 Staff check-in flows ✅

**A. Happy path (target: under 10 s)**
1. Open the app (installed PWA), then tap **Check in**.
2. In parallel: fetch a server nonce and server time; start `watchPosition` (high accuracy, `maximumAge: 0`) and collect fixes for up to 10 s, stopping early once `accuracy ≤ 30 m`. The front camera opens with a live preview.
3. Blink prompt, then auto-capture the selfie (only a still JPEG of about 40–80 KB is uploaded).
4. Enter the PIN (or use passkey/biometric unlock, phase 2). The device key signs `{nonce, staffId, fixes, selfieHash}`.
5. The server scores risk (§2.5), saves the punch with **server time**, and shows "Checked in 10:04 · Inside salon".

**B. Flagged path** (accuracy poor, edge of the fence, new device, odd signals): show "We couldn't confirm you're at the salon. Scan the door QR or send for approval." → **Scan QR** (§2.6) or **Request approval**, which reaches the owner's Needs-action list with the selfie and map.

**C. Outdoor duty** (bridal makeup at a venue or the client's home, an academy event): the owner pre-assigns an *Outdoor duty* for date and time. Staff check in anywhere; the location is recorded once at check-in and once at check-out and tagged `Outdoor duty`. Without a pre-assignment, the punch goes to approval.

**D. Offline:** the punch is queued locally with the client time and the last server-signed time (§4.6), shown as "Saved, will sync". The server accepts it with an `offline` badge if it syncs within 12 h.

**E. Check-out:** same flow with a lighter proof (selfie optional ✅, location required). Missed check-out → reminder to the staff member at shift end + 30 min, then an owner alert at closing + 60 min (§3.6).

**F. Owner override:** the owner marks attendance for anyone, with a reason. Every edit is audit-logged (who, when, before → after). Staff see the change.

### 1.4 Anti-buddy-punching stack (in order of value per cost)

| Layer | Stops | Cost to us | Default |
|---|---|---|---|
| **One device ↔ one staff** (device-bound key, owner approves a new device) | Friend punching from their own phone for you | Low | ✅ On |
| **PIN** on each punch (or passkey unlock) | Someone else holding your unlocked phone | Low | ✅ On |
| **Live selfie** (camera stream only, no gallery) + blink check, shown to the owner as thumbnails | Sending your phone in with a colleague; photo-of-photo (partly) | Medium | ✅ On for check-in |
| **Geofence + accuracy gating** | Punching from home | Low | ✅ On |
| **Risk signals** (impossible speed, zero GPS jitter, identical coordinates day after day, hosting/VPN ASN, non-IST device timezone, clock skew) | Casual GPS spoofers | Medium | ✅ On (flag only) |
| **Rotating door QR** (30 s TOTP) | Spoofed GPS (you must see the screen inside the salon) | Low (an old phone on a charger) | ✅ Fallback / strong mode |
| **Face match** against an enrolled photo | Impersonation | High, and makes the data biometric (SPDI consent) | Phase 2, opt-in |

### 1.5 Reports ✅
- **Daily summary** (also sent as the morning push): present, late, absent, leave, week-off, outdoor duty.
- **Monthly register / muster roll** (the Form IX "attendance-cum-muster roll" idea from the Wages (Central) Rules 2026) [43].
- **Late and early report** (per staff: count, total minutes, deduction ₹).
- **Overtime report** (approved vs pending, hours, ₹).
- **Leave report and balances.**
- **Salary register** (the Form IV idea: wages, OT, advances, fines, deductions) and **payslips** (the Form V idea) [43].
- **Advances ledger.**
- **Exceptions log** (flagged punches, overrides, device changes) for disputes.
- Export: CSV + PDF; WhatsApp share for payslips.

### 1.6 Salon-specific needs

- **Hours and the 48-hour week:** the salon is open Mon–Sat 10:00–20:00 and Sun 10:00–13:00. A 9-hour working day (10 h spread − 1 h break) × 6 days = 54 h, which is over the 48 h/week norm. One rotating **weekday off** + Sunday's 3 h gives 5 × 9 + 3 = **48 h**. ✅ The roster screen should show weekly scheduled hours per person and warn when they go over 48.
- **Shift templates** ✅: `Full day 10:00–20:00 (60 min unpaid break)`, `Sunday 10:00–13:00`, `Morning 10:00–15:00`, `Evening 15:00–20:00`, `Split 10:00–14:00 + 17:00–21:00`. **Split shifts mean several in/out pairs per day**; the day's worked minutes are the sum of pairs.
- **Breaks:** ✅ a fixed unpaid break is deducted automatically (no break punches). Break punches are an option.
- **Week-offs** ✅: one fixed weekly off per person (the salon opens 7 days, so offs rotate). The owner can swap an off. Working on an off gives a **comp-off or 2× day pay** (owner's choice).
- **Peak seasons and leave blackout:** wedding season, Navratri, Diwali, Uttarayan, Karwa Chauth. ✅ The owner marks "no-leave days"; leave requests on them are auto-flagged.
- **Bridal on-location and early-morning work** (e.g. a 4 am venue call): the *Outdoor duty* tag (§1.3 C). Hours outside the shift count toward OT once approved. Women's hours: the Gujarat S&E Act 2019 s.13(2) limited women to 6 am–9 pm unless an Inspector is satisfied about conditions, and the 2026 amendment allows 9 pm–6 am with consent [37][38]. ✅ The app flags shifts starting before 06:00 or ending after 21:00 and records the staff member's consent tick (relevant only if the Act applies, §5.1).
- **Staff types:** beautician/stylist, makeup artist, mehndi artist, nail technician, receptionist, helper, academy trainer, **trainee** (fixed stipend, no commission). ✅ Salary types: monthly (default), daily wage, per-booking/freelancer (phase 2).
- **Languages:** ✅ English + Gujarati (+ Hindi) for the staff app and payslips. PagarBook and Pagarkhata sell on this [1][2].
- **Commissions and incentives (Phase 2 idea, not MVP):** salon practice is a fixed base + tiered service commission + 10–15% retail commission; tips passed through and tracked separately; makeup artists often paid 40–50% of booking value [4][21]. Needs a link to bookings or billing (Petpooja, MioSalon, Zenoti and others), so it is out of scope for v1. ✅ v1 has a manual **"Incentive" line item** on the payslip.

---

## 2. Location lock in a PWA

### 2.1 What the Geolocation API gives you
- `coords.accuracy` = "the accuracy value indicating the **95% confidence level in meters**" [22]. Treat it as the radius of a circle that contains the true position 95% of the time.
- `enableHighAccuracy` is only a hint (slower, more power). `maximumAge` defaults to 0 (no cached fix). `timeout` excludes time spent waiting for permission [22].
- Secure contexts only (HTTPS). The default Permissions-Policy allowlist is `self` [22].
- The spec itself says: "**no guarantee is given that the API returns the device's actual location**" [22]. The page only receives what the browser reports. Android's mock-location flag (`Location.isFromMockProvider()` / `isMock()`) exists **only for native apps**, and browser extensions or devtools can spoof at the browser level [19][23]. ✅ The PRD must state plainly that **GPS spoofing cannot be detected on the web**, only discouraged and flagged.

### 2.2 Real-world accuracy
- Open sky: GPS-enabled smartphones are "typically accurate to within a **4.9 m** radius", worse near buildings, bridges and trees, and indoors (multipath) [24].
- Android OS levels: precise is roughly 3–50 m; **approximate is about 3 km²** [25]. If the Chrome app only has OS "approximate" permission, every site gets coarse fixes.
- **Chrome for Android (May 2026)** now lets users pick **Precise or Approximate per site** in the permission prompt [26][27]. Google says APIs for sites to request precise location are still to come. A spec PR adds `PositionOptions.accuracyMode: "precise" | "approximate"`, with WebKit "support" [28]. Chromium's test page treats `accuracy ≥ 2000 m` as approximate [26].
- **iOS "Precise Location" off** gives region-based fixes of roughly 1–20 km that update only a few times per hour [29].
- ✅ **Rule:** any fix with `accuracy ≥ 1000 m` is "approximate mode". Block it and show a fix-it guide ("Choose **Precise** location for this app"), with screenshots per platform.
- The salon sits in an **apartment or commercial building** (Om Residency), so expect indoor fixes of about 20–60 m. StaffAny recommends ≥ 50 m for this reason; TimeClock 365-style guidance is 100 m, or 150–200 m in dense urban areas [10][30].

### 2.3 Geofence and accuracy algorithm ✅

```
Inputs: salon centre C, radius R (default 100 m), max accepted accuracy A_max (default 50 m)
Sample: watchPosition for ≤ 10 s; keep all fixes; best = min accuracy; stop early at accuracy ≤ 30 m
d = haversine(best, C);  a = best.accuracy

if a ≥ 1000                → REJECT  "approximate location" (fix-it guide)
elif d ≤ R and a ≤ A_max   → PASS    (inside)
elif d - a ≤ R             → UNCERTAIN (accuracy circle overlaps the fence) → ask for door QR, else flag for owner
else                       → OUTSIDE (whole 95% circle outside) → block; offer QR / request approval / outdoor duty
```
- ✅ Store `d`, `a`, the number of samples, the spread between samples, `altitude`/`speed` nullness and the timestamps. Store **only the best fix's lat/lng** (privacy: §6).
- ✅ Owner settings: R from 50 to 300 m in steps of 25 m. A_max from 30 to 100 m. Multiple fences per org (branches) are ready from day 1 in the data model.
- Don't copy Jibble's 300 m minimum. That is for *automatic* geofence clock-in on native apps, not a manual punch [6].

### 2.4 Geofence calibration flow ✅
The owner taps **Calibrate** while standing at the salon counter. The app collects fixes for 60 s, then asks for the same on 2 more days, ideally with 2 different phones (Android + iPhone). The server sets C = the median of the best fixes and suggests R = max(75 m, p95 distance from C + 25 m), rounded to 25 m. Show this on a map with the circle. Start with the `site.ts` pin as C.

### 2.5 Spoofing: realistic mitigations and risk score ✅

| Signal (server-side unless noted) | Why it helps | Weight |
|---|---|---|
| Unknown device key, or the device is bound to another staff member | Buddy punching on someone else's phone | **Block** (owner approval) |
| Fix `accuracy ≥ 1000 m` | Approximate mode | **Block** |
| OUTSIDE fence (§2.3) | Not at the salon | **Block** unless QR or outdoor duty |
| UNCERTAIN fence result | Edge or indoor noise | Medium |
| **Zero jitter**: every sample identical to 6 decimals, constant accuracy, `altitude`/`speed` always null | Typical of fake-GPS apps, which emit hard-coded values [20] | Medium |
| Same lat/lng to 6 decimals as on previous days | Replayed or spoofed point | Medium |
| **Impossible jump**: speed between this punch and the staff member's previous event (or the check-out vs check-in fix) > 120 km/h | Teleporting | High |
| Request IP ASN is a hosting/VPN provider, or `request.cf.country ≠ IN` (Cloudflare gives `asn`, `asOrganization`, `city`, `country`, `latitude` per request) [31] | VPN or emulator | Medium (mobile-carrier IP geolocation in India often points to a hub city, so never use city as proof) *(verify)* |
| **Salon network match**: request IP equals the salon Wi-Fi's recent public IP (learned when the owner's or door device is online) | Strong positive signal when staff use the salon Wi-Fi. A dynamic IP changes about every 72 h, so keep re-learning it [8] | Negative (reduces risk) |
| Device timezone `Intl…timeZone ≠ Asia/Kolkata`, or device clock skew > 5 min from server | Tampered device or emulator | Low–Medium |
| Selfie missing a face, blink check failed, or the camera stream was unavailable | Photo-of-photo, or a skipped selfie | Medium |
| Door QR token valid | Physically saw the screen inside | Strong negative |

✅ **Outcome mapping:** score < 30 → auto-accept. 30–60 → accept + flag (owner sees an amber badge, nothing blocks the staff member). > 60 → needs the QR or owner approval. Thresholds can be tuned in settings. **Never auto-deduct pay on a flag alone**; the owner decides. Anomalies are "indicators for human review, not proof" [19].

### 2.6 Rotating door QR (strong mode) ✅
- **Display:** an old Android phone or tablet on a charger at the door, running `/door/<orgId>` in a pinned or kiosk screen. Setup gives it a per-org secret (stored on that device and rotatable by the owner).
- **Token:** TOTP-style, `HMAC-SHA256(secret, floor(unixTime/30))` truncated to 8–10 base32 characters (RFC 6238 permits SHA-256) [32]. The QR encodes `https://<app>/q/<orgId>/<token>`. The display works offline once its clock is synced.
- **Validation:** the server accepts the current and previous step (≤ 60 s window). The token must arrive with the device signature + PIN + selfie, and the same staff member can't reuse a token. StaffAny's dynamic QR refreshes every 5 s with a 1 s buffer [11]. 30 s is kinder to older phones, and the other layers cover relay risk.
- **Known limit:** a screenshot forwarded on WhatsApp inside the window still works. Rotation narrows the window but "should not be treated as complete protection" [32]. That's why the QR never stands alone (device + PIN + selfie are still needed). ✅ The door screen also shows "Last check-in: Priya 10:04" as a social deterrent.
- **Scanner:** `BarcodeDetector` works in Chrome on Android but is **disabled by default in iOS Safari** [33]. ✅ Use BarcodeDetector when present, otherwise `jsQR` or `@zxing/library` in a worker [34][35].

### 2.7 Selfie with liveness-lite ✅
- Use `getUserMedia` with the front camera and a live preview. **No file input**, so no gallery uploads.
- On-device **blink check** with MediaPipe Face Landmarker (`@mediapipe/tasks-vision`, which outputs blendshape scores) [36]: require one blink (eye-blink blendshape > 0.5 then < 0.2) within 4 s, then auto-capture. Falls back to "face detected" only on weak devices.
- Upload one JPEG of about 480 px at ~0.7 quality (40–80 KB) to R2, plus its SHA-256 in the signed payload.
- **No face matching in v1** (that would be biometric processing, §6.4). The owner sees thumbnails next to each punch, and "Tap to compare" shows the enrolled photo beside it.

### 2.8 Device binding ✅
- At enrolment (invite link opened **inside the installed PWA**), generate an **ECDSA P-256 key pair with `extractable: false`** via WebCrypto and keep the `CryptoKey` in IndexedDB. The public key goes to the server and the **owner approves the device** [39].
- Each punch signs a fresh server nonce. The server verifies against the bound key.
- **iOS caveat:** Home Screen web apps have **storage separate from Safari** [40], so enrol inside the installed app, not in a Safari tab. WebKit says Home Screen apps are *not* subject to the 7-day deletion for HTML storage on their main domain (only JS-set cookies are capped) [41]. Call `navigator.storage.persist()`, which WebKit grants more readily for Home Screen apps [42]. If storage is wiped, the staff member re-enrols and the owner approves again.
- Passkeys (WebAuthn) are a nice unlock (fingerprint or face, no biometrics sent to us), but they **sync across a person's devices** via iCloud or Google, so they are not proof of one device [39b]. ✅ Phase 2: passkey as PIN replacement, keeping the device key for binding.

### 2.9 Server-trusted time ✅
- **The server receive time is canonical** for online punches; client time is stored only for audit.
- **Offline punches:** the app stores `lastServerTimeSigned` (an HMAC'd server timestamp, refreshed whenever online), plus `Date.now()` and `performance.now()` deltas since then. On sync, the server bounds the event: `lastServerTimeSigned ≤ eventTime ≤ syncReceivedAt`. If the window is > 2 h, or the claimed time falls outside it, flag the punch. If the app never synced today, the punch needs approval.

### 2.10 Permission UX and GPS denied ✅
1. **Pre-permission screen** before the browser prompt: "We check your location **only when you tap Check in or Check out**, to confirm you're at the salon. We never track you." with an **Allow** button that triggers `getCurrentPosition`. Prompts tied to a user tap convert better, and iOS requires a gesture for notifications anyway.
2. Read the state with `navigator.permissions.query({name:'geolocation'})` where supported [72], but **don't trust it on iOS**: reports exist of it returning `prompt` after a denial [44]. Rely on the error code from the actual request.
3. **Denied →** platform-specific fix-it sheet with screenshots:
   - Android Chrome: lock icon → Permissions → Location → Allow, and choose **Precise**. Also Android Settings → Apps → Chrome → Permissions → Location → "Use precise location".
   - iPhone: Settings → Privacy & Security → Location Services → **Safari Websites** → While Using + **Precise Location on** *(verify the exact path on iOS 26 for Home Screen apps)*.
4. **Still no GPS (denied, timeout, approximate):** offer **(a) Scan door QR** + selfie → accepted as a flagged punch, or **(b) Request manual attendance** (selfie + reason) → owner approves. Never accept silently.
5. Timeouts: `timeout: 20000`, then retry once with `enableHighAccuracy: false` before showing the fallback.

---

## 3. Notifications

### 3.1 Platform support
- **Android Chrome:** Web Push works in a tab or installed app via FCM.
- **iOS/iPadOS 16.4+:** Web Push works **only for web apps added to the Home Screen** (manifest `display: standalone` or `fullscreen`). Permission must be requested "in response to direct user interaction" (e.g. a Subscribe button). The Badging API is supported, and notifications follow Focus modes. Allow `*.push.apple.com` endpoints. No Apple Developer account is needed [45].
- **iOS 26:** any site added to the Home Screen opens as a web app by default; users can turn "Open as Web App" off [46].
- **Safari rule:** every push must show a notification. After **3 silent pushes the subscription is removed** (WebKit commit "Enforce silent push quota"). The usual cause is a missing `event.waitUntil()` around `showNotification` [47].
- **Declarative Web Push** (iOS/iPadOS 18.4, macOS Safari 18.5): the push JSON itself describes the notification (`"web_push": 8030`, `notification.title`, `notification.navigate`, optional `body`, `lang`, `dir`, `silent`, `app_badge`). It shows even if the service worker fails, and it is backwards compatible: older browsers handle the same JSON in the SW `push` handler [48].
- **Indian Android phones (Xiaomi, Oppo, Vivo, Realme, Samsung)** often kill Chrome in the background, which delays pushes. ✅ The onboarding checklist tells the owner to set Chrome's battery mode to "No restrictions" (see dontkillmyapp.com) [49].

### 3.2 Payload limits and headers ✅
- Push services must accept bodies ≤ **4096 bytes** (RFC 8030 §7.2). After the aes128gcm header (86 B), padding and tag, that leaves at most **3993 bytes of plaintext** (RFC 8291 §4) [50][51].
- ✅ Keep payloads **≤ 2 KB**: type, ids and short display strings only. The app fetches details when opened.
- ✅ Headers: `TTL` (late/absent alerts: 4 h; daily summary: 12 h), `Urgency: high` for late, absent, flagged and missed-checkout; `normal` for summaries. `Topic` (≤ 32 chars) collapses superseded alerts, e.g. `late-<staffId>-<date>` replaces an earlier "not in yet" (RFC 8030 §5.3–5.4) [50].

```json
{ "web_push": 8030,
  "notification": { "title": "Priya is 18 min late", "body": "Checked in 10:28 · inside salon",
                    "navigate": "https://<app>/o/<org>/today?e=evt_123", "lang": "en-IN" },
  "t": "late", "e": "evt_123" }
```

### 3.3 Sending libraries
- **Cloudflare Workers:** ✅ **`@pushforge/builder`**: zero-dependency, Web Crypto based. `buildPushHTTPRequest({privateJWK, subscription, message:{payload, adminContact, options:{ttl, urgency, topic}}})` returns `{endpoint, headers, body}` for `fetch`. VAPID keys come from `npx @pushforge/builder vapid`. MIT licence, small project (about 66 stars), so pin the version and wrap it [52]. Alternatives: `web-push-neo` (Web Crypto + `jose`), `web-push-browser`, `@negrel/webpush` (the author warns it is not crypto-reviewed) [53][54].
- The classic **`web-push` (npm) fails on Workers** (`crypto.createECDH is not a function`) [52]. It is fine on a Node server.
- Handle responses: `201` ok; **`404`/`410` → delete the subscription**; `413` → payload too large; `429` → back off (Retry-After) [55].
- Fan-out: for one salon, `ctx.waitUntil(Promise.allSettled(sends))` is enough. For many tenants, put sends on **Cloudflare Queues** (Free: 10k ops/day; Paid: 1M ops/month included, then $0.40/M) [56].

### 3.4 Fallbacks ✅
1. **In-app inbox** (always, the source of truth): every alert is a row in `notifications`, with a badge count via `setAppBadge`.
2. **WhatsApp to the owner:** WhatsApp Cloud API utility template, e.g. "Feelings Attendance: 2 staff not checked in by 10:30 (Priya, Neha). Open app: …". Since 1 Jul 2025 Meta charges **per delivered message**. **From 1 Oct 2026, utility messages inside the customer-service window are charged too.** INR billing migration is required by 31 Dec 2026 [57]. The India utility/authentication list rate is about **₹0.115 per message + GST** *(verify on the Meta rate card; some BSPs quote ₹0.145–0.35)* [58]. It needs a Meta Business account, a verified number and approved templates. ✅ Use it only for the **daily summary + critical alerts** (≈ 30–60 msgs/month ≈ ₹5–10/month).
   - Zero-cost alternative: a "Share on WhatsApp" `wa.me` deep link in the owner panel (manual).
3. **Email:** Cloudflare Email Service (beta, Workers Paid: 3,000 emails/month included, then $0.35/1k) [59], or Resend (free 3,000/month, 100/day) *(verify)* [60]. ✅ Use for the weekly digest + payroll-ready notices.
4. **Escalation rule** ✅: if an owner push for a critical alert (absent, flagged) is not opened within 15 min **and** the owner has WhatsApp fallback enabled, send WhatsApp. Respect quiet hours.

### 3.5 Owner notification catalogue ✅

| Event | Default trigger | Channel | Urgency / batching |
|---|---|---|---|
| **Morning summary** | Shift start + 45 min (10:45 IST) | Push + optional WhatsApp | normal |
| **Late check-in** | In-time > shift start + grace (10 min) | Push | high; batched into one push if several within 5 min |
| **Not in yet / absent by X** | No punch by shift start + 30 min (10:30) and not on leave or week-off | Push (+ WhatsApp escalation) | high; `Topic` per staff per day |
| **Check-in outside geofence / flagged** | Risk score > 30 or OUTSIDE/UNCERTAIN | Push, Needs-action item | high |
| **Early check-out** | Out-time < shift end − 15 min | In-app (push optional) | normal |
| **Overtime running** | Still checked in at shift end + 30 min | Push "approve OT?" | normal |
| **Missed check-out** | No check-out by closing + 60 min (21:00) | Staff nudge at end + 30; owner push at closing + 60; auto-close at the shift end, flagged `auto` (no OT credited) | normal |
| **Leave request** | On submit (urgent if for today or tomorrow) | Push + Needs-action | normal / high |
| **Regularization request** (forgot to punch) | On submit | Needs-action | normal |
| **Advance request** (if enabled) | On submit | Needs-action | normal |
| **New device / re-enrolment** | On submit | Push + Needs-action | high |
| **Payroll draft ready** | 1st of the month 09:00 | Push + email | normal |
| **Salary due reminder** | 5th of the month if not marked paid (the Code on Wages deadline is the 7th) [43] | Push | normal |

✅ Owner settings: per-event on/off, **quiet hours 21:30–08:00** (critical alerts held until 08:00 except "new device"), and a "summary only" mode.

### 3.6 Staff notification catalogue ✅
Check-in reminder (shift start + 5 min if not in), check-out reminder (end + 30), leave approved or rejected, punch approved or flagged, payslip ready, schedule or week-off changed, holiday announced.

---

## 4. PWA production checklist

### 4.1 Manifest ✅
`name`, `short_name` (≤ 12 chars, e.g. "Feelings Staff"), `id`, `start_url` (`/?source=pwa`), `scope`, `display: "standalone"`, `orientation: "portrait"`, `theme_color` and `background_color` (from the salon brand tokens), `lang: "en-IN"`, `icons` (192, 512, plus **separate** maskable 192/512), `shortcuts` (Check in, Today), `screenshots` (narrow, for Android's richer install UI). Chromium install needs name/short_name, icons (192 + 512), start_url and display [61]. ✅ **Two installable apps or one?** Use one PWA with role-based home screens (owner vs staff), which keeps a single push subscription per device.

### 4.2 Icons ✅
- `purpose: "any"` PNG 192/512, and **separate** `purpose: "maskable"` PNG 192/512 with the logo inside the **central circle of radius 40%** of the width. Don't combine `"any maskable"` [62].
- iOS: `apple-touch-icon` 180×180 (it takes precedence over manifest icons on iOS) [45]. Safari 26 supports SVG icons [46].
- Generate with `@vite-pwa/assets-generator` or `pwa-asset-generator` [63][64].

### 4.3 iOS meta and splash ✅
`<meta name="apple-mobile-web-app-capable" content="yes">` (legacy but harmless), `<meta name="apple-mobile-web-app-status-bar-style" content="default">`, `<meta name="apple-mobile-web-app-title" content="Feelings">`, `viewport-fit=cover` + `env(safe-area-inset-*)` padding, and `apple-touch-startup-image` links per device size (generated by `pwa-asset-generator`) [64]. Splash images are optional polish; iOS shows a blank background otherwise.

### 4.4 Service worker (Workbox via `vite-plugin-pwa`, `injectManifest`) ✅

| Route | Strategy |
|---|---|
| App shell (HTML, JS, CSS, fonts, icons) | **Precache** (versioned), `cleanupOutdatedCaches` on [65] |
| `GET /api/me`, `/api/today`, `/api/register` | **NetworkFirst** (3 s timeout) → cached fallback with a "last updated" stamp |
| Selfie thumbnails (owner) | **StaleWhileRevalidate**, max 200 entries, 7 days |
| `POST /api/punch` | **NetworkOnly** + app-level IndexedDB queue (below) |
| Everything else under `/api` | NetworkOnly |

### 4.5 Push handler ✅
Always `event.waitUntil(self.registration.showNotification(...))` on every path, including errors [47]. `notificationclick` focuses an existing client or opens `navigate`.

### 4.6 Offline check-in queue with trusted time ✅
- **Background Sync is not supported on iOS Safari** (all versions through 26.x) [66]. Workbox's BackgroundSync falls back to "replay whenever your service worker starts up", which needs the page running [67].
- ✅ Keep our own queue: punches go to IndexedDB (`pendingPunches`) with `{clientTime, monoDelta, lastSignedServerTime, fixes, selfieBlob, signature}`. Flush on app open, on `online`, on `visibilitychange → visible`, and on a 30 s timer while open. Show a persistent "1 punch waiting to sync" banner. The server applies the §2.9 bounds and badges the punch `offline`.
- Selfie blobs stay in IndexedDB until uploaded, then are deleted.

### 4.7 Install UX ✅
- **Android/Chromium:** capture `beforeinstallprompt` (Chromium only, not Baseline), show our own **Install** button in onboarding, and call `prompt()` once [68][69]. The automatic prompt still needs a SW `fetch` handler; menu install doesn't (Chrome 108+ mobile) [70].
- **iOS:** no prompt API. Show a 3-step illustrated sheet: Share → **Add to Home Screen** → open from the Home Screen. Detect the installed state with `matchMedia('(display-mode: standalone)')` or `navigator.standalone`. Show install guidance only in `display-mode: browser` [69].
- ✅ **Staff onboarding enforces install** (the invite link says "Install first"), because iOS push and stable device binding both depend on it. The owner panel works in a browser too, but push needs install on iOS.

### 4.8 Update flow ✅
`registerType: 'prompt'` (the vite-plugin-pwa default). `onNeedRefresh` shows a toast: "New version ready · Update". `updateSW()` reloads [71]. Never auto-reload while a check-in is in progress or a punch is queued. Check for updates on `visibilitychange` and hourly. ✅ Add a server-driven **minimum app version**: the API returns `426` with "Please update" for breaking API changes.

### 4.9 Storage ✅
Call `navigator.storage.persist()` after install. Home Screen web apps get browser-app quotas (up to 60% of disk per origin) [42].

### 4.10 Test matrix (run in GitHub Actions, never on the 2-CPU VM)
Playwright (Chromium mobile emulation with geolocation overrides for PASS/UNCERTAIN/OUTSIDE/approximate; WebKit for iOS-ish layout), Lighthouse PWA checks, and a push send smoke test against a test subscription. Real-device checks before launch: one low-end Android (Redmi/Realme) and one iPhone on iOS 18 or 26.

---

## 5. India payroll rules for a small salon (Gujarat)

> Not legal advice. Have a local CA or labour consultant confirm the final defaults. Note that the labour codes changed in 2025–26.

### 5.1 Which laws actually bite a salon with fewer than 20 staff in Jamnagar

| Law | Applies to Feelings? | What matters for the app |
|---|---|---|
| **Code on Wages, 2019** (in force **21 Nov 2025**) [73][74] | **Yes**, all establishments | s.14 OT at **≥ 2× normal rate** (where minimum wages apply). s.17 monthly wages paid **before the 7th** of the next month, and within **2 working days** of exit. s.18 permitted deductions only, **total ≤ 50%** of wages. s.19 fines only for pre-approved acts after show-cause, **≤ 3%** of wages, recovered within 90 days. s.20 absence deductions **no larger than the proportion of time absent**. s.21 damage/loss ≤ actual loss, after show-cause. s.50 **register (muster roll, wages) + wage slips** [43] |
| **Wages (Central) Rules, 2026** (G.S.R. 343(E), 8 May 2026) | Central sphere. Gujarat's own rules govern a state-sphere salon, but the central rules are a good template *(verify Gujarat rules)* | Form I employee register, Form IV wages/OT/advances/fines/deductions, **Form IX attendance-cum-muster roll**, **Form V wage slip on or before payment**, registers kept **5 years**, normal day 8 h for daily-rated / ≤ 48 h per week, daily rate × 26 = monthly (minimum wage maths), one rest day a week, never more than 10 days in a row without rest [75] |
| **Gujarat Shops & Establishments Act 2019, as amended 2026** (amendment effective **16 Dec 2025**) [37][38] | Main provisions apply only to establishments with **20 or more employees**. Below 20, only **s.7 intimation** of commencement/closure | Useful as **policy defaults** even if not binding: 10 h/day (was 9), 48 h/week, a break after 6 continuous hours (was 5), OT **2× ordinary rate**, OT cap 144 h/quarter (was 125), weekly holiday of 24 consecutive hours, **work on the rest day = 2×**, 7 casual + 7 sick leave a year (lapse at year-end), earned leave 1 day per 20 days worked after 240 days (accumulate up to 63), **8 paid festival holidays** (26 Jan, 15 Aug, 2 Oct + 5 agreed), work on a festival holiday = **double pay + a substitute day off** [38] |
| **OSH Code, 2020** (in force 21 Nov 2025) | Establishments with **10+ workers** *(verify the exact threshold)* | 8 h normal working day [37] |
| **Maharashtra S&E Act 2017** (for comparison / other tenants) | 10+ workers | 9 h/day, 48 h/week, OT **2×**, ≤ 125 h per 3 months, weekly holiday, rest-day work at 2× [76] |
| **Minimum wages, Gujarat (Shops & Establishments)** | Yes (via the Code on Wages) | Apr–Sep 2026, unskilled: Zone I ≈ ₹512.50/day (₹13,325/month), Zone II ≈ ₹501.50/day (₹13,039/month). Sources disagree on zone mapping and VDA, and an Oct 2026 revision is reported at about ₹524.50/day [77] *(verify; confirm Jamnagar's zone)*. ✅ Don't hard-code. The owner enters the current MW, and the app warns if full-attendance gross < MW × 26 |

**The double-rate convention vs common small-business practice:** the statute says 2×. In practice many Indian small businesses pay OT at 1× (same hourly rate), a flat ₹ per hour, comp-off, or nothing. PagarBook's own example uses 1.5× [1]. ✅ The default is **2× for approved OT**, labelled "as per Code on Wages s.14". The owner can pick 1× / 1.5× / flat ₹ per hour / comp-off, and the settings screen shows a one-line notice that below 2× may not comply.

### 5.2 Per-day, per-hour and per-minute rates

| Divisor method | Formula | ₹15,000/month, 31-day month | Notes |
|---|---|---|---|
| ✅ **Calendar days** | per-day = monthly ÷ days in month; paid days = days in month − LOP days | ₹483.87 | Most common in Indian SMB payroll. Week-offs and holidays are paid automatically. The SAP India default [78] |
| Fixed 30 | monthly ÷ 30 | ₹500.00 | Same rate every month; simple for owners |
| Fixed 26 | monthly ÷ 26 | ₹576.92 | Statutory anchor for minimum-wage maths (×26) [75]; higher absence deductions |
| Working days | monthly ÷ scheduled working days | varies | Most "fair" when schedules vary; needs the roster to be accurate |

- **Per-hour** = per-day ÷ scheduled paid hours that day (9 h on a full day).
- **Per-minute** = per-hour ÷ 60. Example: 483.87 ÷ 540 = **₹0.896/min**.
- **Sunday 3-hour shift:** per-day stays the same (the day counts as a day). Per-minute uses that day's scheduled minutes (180) only for late and early deductions.
- Rounding ✅: compute in paise as integers and round the final net to the nearest rupee. Show the formula on the payslip ("₹15,000 ÷ 31 × 29 paid days").

### 5.3 Overtime ✅
- **Starts after:** the shift's scheduled end + a **30-minute threshold** (then all minutes past the scheduled end count). Count in **15-minute blocks, rounded down**. Early arrival does **not** count unless pre-approved.
- **Weekly check:** also flag when weekly hours > 48 (the Code on Wages / S&E norm).
- **Approval:** OT is credited only after owner approval (pre-approved or approved afterwards). A pending OT shows on the payslip draft.
- **Rate:** 2× hourly rate (owner-configurable, §5.1). Example: 483.87 ÷ 9 = ₹53.76/h → 2× = ₹107.53/h → 2 h = **₹215.05**.
- **Week-off or holiday worked:** owner's choice of **comp-off ✅** or **2× day pay**.
- **Cap warning:** 144 h per quarter (Gujarat 2026), shown only as a warning.

### 5.4 Late marks, early exits and half days ✅
- **Grace: 10 minutes** on check-in. No grace on check-out (the early-exit threshold is 15 min).
- ✅ **Default deduction = pro-rata minutes** (late minutes beyond grace + early-exit minutes) × per-minute rate. Example: 25 min late → 15 billable minutes × ₹0.896 = **₹13.44**. This is an absence deduction "no larger than the proportion of time absent" (Code on Wages s.20) [43].
- **"3 lates = half day" / fixed late fines:** very common in India (PagarBook advertises late fines with slabs [1]). But a half-day cut for 3 lates is **disproportionate to the time missed, so it is effectively a fine** under s.19: allowed only for acts pre-approved by the government and posted as a notice, after a show-cause step, **≤ 3% of the month's wages**, recorded in a fines register [43]. ✅ **Off by default.** If the owner turns it on, the app enforces the 3% cap and the show-cause step (a staff acknowledgement), and shows a legal note.
- **Day status from worked minutes** (sum of in/out pairs, minus the unpaid break):
  - ✅ **Present** if worked ≥ 75% of scheduled minutes (≥ 6 h 45 m of 9 h). Late and early minute deductions still apply.
  - ✅ **Half day** if worked ≥ 40% and < 75% (3 h 36 m to 6 h 44 m). Pays 0.5 day, **no extra minute deductions** (no double penalty).
  - ✅ **Absent** if worked < 40%. Pays 0, unless on paid leave.
  - The owner can override any day with a reason (audit-logged).
- **Sandwich rule** (absent on both sides of a week-off or holiday makes it unpaid): common in Indian policies. ✅ **Off by default.**

### 5.5 Week-offs, holidays and leave ✅

| Type | Default | Basis |
|---|---|---|
| Weekly off | 1 paid day/week per person, rotating | Code on Wages s.13 / Wages Rules rest day; Gujarat S&E s.16 [38][75] |
| Paid festival holidays | **8/year**: 26 Jan, 15 Aug, 2 Oct + 5 owner-chosen (e.g. Uttarayan, Holi, Janmashtami, Dussehra, Diwali) | Gujarat S&E 2019 s.18(7) pattern [38] |
| Work on a holiday | 2× day pay **or** comp-off (owner sets per holiday) | s.18(7) proviso |
| Casual leave (CL) | 7/year, credited 1 Jan, lapses 31 Dec | s.18(2) pattern |
| Sick leave (SL) | 7/year, credited 1 Jan, lapses 31 Dec | s.18(3) pattern |
| Earned leave (EL) | 1 day per 20 days worked after 240 days in the previous year; accumulate up to 63 | s.18(4)–(5) pattern |
| Comp-off | Earned by working an off or holiday; expires in 60 days | Owner policy |
| Unpaid leave (LOP) | Unlimited, owner-approved | — |
| Maternity | Note only (Code on Social Security; not in MVP) | *(verify applicability)* |

✅ Probation: leave accrues from joining but CL/SL are usable after 3 months (owner-configurable). Leave requests need ≥ 2 days' notice, except SL. Blackout days come from §1.6.

### 5.6 Advances and deductions ✅
- **Advance:** date, amount, mode (cash/UPI), reason, recovery plan (**full next month ✅** or N equal instalments), and an optional staff acknowledgement (tick + timestamp).
- **Cap:** total deductions in a month (advance recovery + LOP + late + fines + damage) ≤ **50% of wages**, and the excess carries forward (Code on Wages s.18(3)–(4)) [43]. Show "₹X carried to next month".
- **Damage/loss:** only after a show-cause acknowledgement; ≤ actual loss (s.21).
- **Statutory deductions** (optional fields, off by default for a small salon): PF, ESI, Professional Tax (Gujarat PT: about ₹200/month for salary ≥ ₹12,000 *(verify)*), TDS.

### 5.7 Payment, payslips and registers ✅
- Pay day setting: default **5th**. The app reminds the owner if salary is not marked paid by the 5th; the legal deadline is before the 7th [43].
- Exit settlement: full and final within **2 working days** of resignation or removal [43]. A checklist screen covers dues, advance balance and leave encashment.
- **Payslip (Form V-style):** salon name/address, staff name/ID/role, month, days in month, P/½/A/L/WO/H counts, per-day rate and divisor method, earnings (basic, OT, incentive), deductions (LOP, late/early, advance recovery, fines, statutory), net pay, payment date/mode, and the leave balance. English + Gujarati. PDF + WhatsApp share. ✅ Each payslip has a verification URL.
- **Registers:** exports shaped like Form I / IV / IX [75]. Records are retained for **5 years** after the last entry.

### 5.8 Owner-configurable defaults (summary table for the PRD) ✅

| Setting | Default | Options |
|---|---|---|
| Salary type | Monthly | Daily, (phase 2) per booking |
| Divisor | Calendar days | 30, 26, working days |
| Grace (in) | 10 min | 0–30 |
| Early-exit threshold | 15 min | 0–60 |
| Late/early deduction | Pro-rata minutes | Off; (fines) N lates = ½ day, capped at 3% |
| Half-day / absent thresholds | 75% / 40% of scheduled minutes | Any % or fixed hours |
| OT starts after | Shift end + 30 min, 15-min blocks | 0–60 min; 15/30/60 blocks |
| OT rate | 2× (approval required) | 1×, 1.5×, flat ₹/h, comp-off, unpaid (tracked) |
| Week-off worked | Comp-off | 2× day pay |
| Weekly off | 1 rotating day per person | Fixed day |
| Festival holidays | 8 (3 national + 5 chosen) | Edit list |
| CL / SL / EL | 7 / 7 / 1 per 20 days worked | Edit |
| Sandwich rule | Off | On |
| Advance recovery | Full next month, 50% cap | N instalments |
| Pay day | 5th | 1–7 |
| Minimum-wage check | On (owner enters the MW) | Off |

### 5.9 Commissions (Phase 2)
Service commission (flat %, tiered slabs above a target such as 3× base), retail commission 10–15%, tips pass-through, net-of-product-cost option, makeup-artist per-booking pay [4][21]. Needs a booking/billing integration. MVP has a manual "Incentive" line only.

---

## 6. Privacy and legal (DPDP Act 2023)

### 6.1 Timeline
- DPDP Act 2023 is on the books. **DPDP Rules 2025** were notified on 13 Nov 2025 (G.S.R. 846(E)). Board rules took effect at once. Consent-manager rules apply from Nov 2026. **Most obligations (notice, security, breach, retention: Rules 3, 5–16, 22–23) apply from 13 May 2027** [79][80].
- Until then, the IT Act **SPDI Rules 2011** still apply. They treat **biometrics, including "facial patterns", as sensitive personal data**, which needs prior written consent [81].
- ✅ Build to the DPDP standard now. Launching in 2026 means the app will be in use when the rules take effect.

### 6.2 Lawful basis
- s.7(i) allows processing without consent "**for the purposes of employment** or those related to safeguarding the employer from loss or liability…" [82]. Attendance, location-at-punch and selfie-at-punch for payroll and anti-fraud fit here.
- Commentators stress that this is **not unlimited**: purpose limitation, minimisation, security and retention still apply, and intrusive monitoring is the grey zone [83][84]. Privacy restrictions must also pass the Puttaswamy test of legality, necessity and proportionality [84].
- ✅ Still show a clear **notice + acknowledgement** at enrolment (English/Gujarati/Hindi; s.5 allows English or any Eighth Schedule language). Take **explicit consent for the selfie** (SPDI-safe), and separately for any phase-2 face match.

### 6.3 Data minimisation and purpose limitation ✅
- Location is read **only during a Check in / Check out action**. No `watchPosition` outside that screen, no background location (a PWA can't do it anyway), no route history.
- Store the **best fix only** (lat/lng rounded to 5 decimals ≈ 1 m), accuracy, distance-to-salon and the inside/outside result. Discard the other samples after scoring (keep only their count and spread).
- Selfie: one small still per punch, no video, **no face templates in v1**.
- No contacts, no other app data, no device identifiers beyond our own key. No ad or analytics SDKs inside the staff app.
- Purpose lock: data is used only for attendance, payroll and dispute resolution. Never for performance scoring or marketing.

### 6.4 Retention ✅

| Data | Keep | Then |
|---|---|---|
| Raw punch coordinates + accuracy | **90 days** (3 payroll cycles for disputes) | Keep only `inside/outside/flag` + distance bucket |
| Selfies (R2) | **30 days** (prefix-based R2 lifecycle rule) [85] | Auto-deleted. A disputed punch's selfie moves to a `hold/` prefix until resolved |
| Attendance summaries, wage register, payslips, advances, fines | **5 years** after the last entry (wage-record preservation) [75] | Delete. DPDP s.8(7) allows retention needed for compliance with law [82] |
| Security and access logs | **1 year** (DPDP Rules 2025, Rule 8(3)) [80] | Delete |
| Device keys, push subscriptions | Until device change or staff exit | Delete at once |
| Staff profile (after exit) | Minimal statutory fields for 5 years | Delete the rest within 30 days of exit |

### 6.5 Security and breach ✅
- s.8(5) requires "reasonable security safeguards" [82]: TLS everywhere, R2 objects private with short-lived signed URLs, tenant isolation tests, least-privilege owner/manager roles, encrypted secrets (Worker secrets), PIN hashed with a server-side pepper + rate limits, an audit log of every edit and export.
- s.8(6) breach intimation to the Board and affected people; the Rules require a detailed report within 72 h [80][82]. ✅ Write a 1-page incident runbook.
- **Roles:** the salon (owner) is the **Data Fiduciary** for staff data. If Harsh runs this as multi-tenant SaaS, he is the **Data Processor** and needs a short processor agreement in the T&Cs (s.8(2)) [82].

### 6.6 Staff rights UX ✅
"My data" screen: view my punches, selfies (while retained) and location results. Request a correction (goes to the owner as a regularization). Grievance contact (owner's name and phone). Show an "On exit, your selfies and locations are deleted within 30 days" note.

---

## 7. Stack notes

### 7.1 Cloudflare vs Supabase

| | **Cloudflare (Workers + D1 + R2 + Cron + Queues)** ✅ | **Supabase** |
|---|---|---|
| Fit with the existing setup | Salon site already on Cloudflare (Pages + D1 `fbc-analytics`, same account) | New vendor |
| DB | D1 (SQLite). 10 GB per DB (Paid), 50k DBs per account. Paid includes 25B rows read and 50M rows written per month. Time Travel PITR 30 days (Paid) / 7 days (Free) [86][87][88] | Postgres + **RLS** (strong tenant isolation by policy). Mumbai region `ap-south-1` [89] |
| Multi-tenant isolation | App-level `org_id` on every query (no RLS), so mandatory tests are needed | RLS policies |
| Realtime owner dashboard | Poll every 30–60 s (fine for one salon). Phase 2: Durable Objects WebSocket | Built-in Realtime |
| Auth | Build our own (PIN + device key is simple). No SMS bill | Built-in. Phone OTP via Twilio/MessageBird/Vonage/TextLocal; WhatsApp OTP only via Twilio [90] |
| Files | R2: 10 GB-month free, no egress fees, **lifecycle rules** for auto-delete [85][91] | Storage with RLS |
| Jobs | **Cron Triggers (UTC)**: 5/account Free, 250 Paid. CPU 10 ms Free vs 30 s+ Paid [92][93] | `pg_cron`, Edge Functions (Deno) |
| Web Push | `@pushforge/builder` (Web Crypto) [52] | Same library on Deno/Node |
| Cost | **$5/month** Workers Paid covers it [94] | Free tier **pauses after 1 week of inactivity** (risky over salon holidays), no backups; Pro ≈ $25/month + compute [95] |

✅ **Recommendation: Cloudflare, on Workers Paid ($5/month).** The Free plan's 10 ms CPU limit is too tight for crypto (push encryption, signature checks, PIN hashing), and Free D1 queries fail hard once a daily limit is hit (enforced from 1 Sep 2026) [96]. One Worker with static assets serves the PWA plus `/api/*`. Bind D1 (location hint `apac`), R2 (`selfies`), Cron, and optionally Queues. Keep a strict data-access layer that injects `org_id`, plus a test suite that proves cross-tenant reads fail.

### 7.2 Minimal data model (for the PRD writer)
`orgs` (settings JSON, timezone `Asia/Kolkata`, plan) · `sites` (centre, radius, A_max, door-QR secret ref) · `users` (role owner/manager/staff, phone, name, language) · `staff_profiles` (salary type and amount, divisor, shift template, week-off, joining/exit dates) · `devices` (public key JWK, status pending/approved/revoked, user_id UNIQUE among approved) · `shifts` / `roster` (date → template, outdoor duty) · `punches` (id, org_id, user_id, kind in/out, server_ts, client_ts, work_date, lat, lng, accuracy, distance_m, fence_result, risk_score, risk_reasons JSON, qr_ok, selfie_key, source online/offline/owner, status auto/flagged/approved/rejected) · `attendance_days` (derived: worked_min, late_min, early_min, ot_min, status, locked) · `leave_types` / `leave_balances` / `leave_requests` · `regularizations` · `holidays` · `advances` + `advance_recoveries` · `fines` · `payroll_runs` / `payslips` (frozen JSON snapshot + PDF key) · `push_subscriptions` · `notifications` (inbox) · `audit_log`.

### 7.3 Auth ✅
- **Staff:** the owner adds a staff member (name + phone), and the app creates a **one-time invite link** (expires in 48 h) that the owner shares on WhatsApp. Staff install the PWA, open the link, set a **4–6 digit PIN**, and the device key is created (§2.8). The owner approves the device. Sessions are long-lived (httpOnly, `SameSite=Strict` cookie, 30 days, sliding), but **every punch re-proves PIN + device signature**.
  - PIN storage: `HMAC-SHA256(pepper, salt‖PIN)` with the pepper in a Worker secret. A 4–6 digit space is tiny, so security comes from the **pepper + server rate limits**, not hash cost. Lock after 5 wrong tries for 15 min, and alert the owner after 10. (Workers PBKDF2 may cap iterations at 100k *(verify)* [97], one more reason not to rely on hash cost.)
  - PIN reset: by the owner (new invite), never by SMS.
- **Owner:** email magic link ✅ (Cloudflare Email Service or Resend), then a passkey enrolment prompt. Optional WhatsApp OTP (authentication template, about ₹0.115 [58]).
- **Why not SMS OTP:** in India it needs **DLT registration** (entity, sender header, template; approvals take 24–48 h) and costs about **₹0.10–0.45 per OTP** (Twilio is at the high end). Fine for a big app, pointless overhead for a 10-person salon whose staff the owner can re-invite in person [98].

### 7.4 Timezone handling (IST) ✅
- India uses **Asia/Kolkata, UTC+05:30, no DST**.
- Store all instants as **UTC epoch milliseconds (INTEGER)** in D1. Store `work_date` as a local `YYYY-MM-DD` string, computed **on the server** from the shift the punch belongs to. A shift starting at 04:00 for a bridal call belongs to that date; an overnight shift belongs to its start date.
- Shift templates are local wall-clock times (`"10:00"`). Convert with a fixed +330 min offset, or with `Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata'})` for display.
- **Cron Triggers run in UTC** [92]: 10:30 IST → `30 5 * * *`. 10:45 summary → `45 5 * * *`. 21:00 missed-checkout sweep → `30 15 * * *`. Payroll draft on the 1st at 09:00 IST → `30 3 1 * *`. Better: one **every-5-minutes cron** that evaluates each org's local-time rules, which suits multi-tenancy and stays within the 5-cron Free limit.
- Never trust the device clock for attendance (§2.9). Flag devices whose timezone isn't `Asia/Kolkata`.

### 7.5 Rough monthly cost (one salon, about 10 staff)
Workers Paid $5 (D1, R2, Queues and cron within the included usage) + WhatsApp ≈ ₹5–10 + email ₹0 ≈ **₹450/month**. For comparison, PagarBook with a web dashboard costs ₹699/staff/year, about ₹580/month for 10 staff [1].

---

## 8. Open questions for the owner (Urmi) before the PRD is final
1. How many staff, roles and shifts are there today? Who takes which weekday off? Does everyone work the Sunday 10–1 slot?
2. How are salaries fixed today (monthly or daily)? Which divisor does she use (30, 26 or calendar)?
3. Is overtime paid today, and how? What happens with late arrivals today (cut, fine, nothing)?
4. Are advances common? How are they recovered?
5. How often do staff do bridal or outdoor duty, and at what hours?
6. What phones do staff and the owner use (Android vs iPhone share, model age)? This drives push and QR choices.
7. Does the salon have Wi-Fi that staff phones join? Is there a spare phone or tablet for the door QR?
8. Which languages for the staff app and payslips (Gujarati, Hindi, English)?
9. Which 5 festival holidays? Which peak or blackout days?
10. Should managers (e.g. a senior beautician) get approval rights?

---

## 9. Sources

**Competitors**
1. PagarBook site (features, pricing): https://pagarbook.com/
2. Khatabook launches Pagarkhata (2020 press): https://www.ap7am.com/pn/3530/whatsapp:/send ; myBillBook staff attendance and payroll: https://mybillbook.in/s/features/staff-attendance-payroll/
3. SalaryBox App Store listing: https://apps.apple.com/app/id1561227180
4. SalaryBox, Payroll and attendance for salons in India 2026: https://salarybox.in/blog/payroll-attendance-management-for-salons-spas-beauty-businesses-in-india-complete-guide-2026/
5. Jibble geofencing: https://www.jibble.io/geofencing-attendance-system
6. Jibble automatic clock in/out with geofences (300 m minimum): https://jibble.io/help/automatic-clock-in-out-geofences
7. Jibble restricting locations with geofences: https://www.jibble.io/help/restricting-locations-with-geofences-mobile
8. Zoho People IP restrictions: https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/ip-restrictions-zoho-people ; Geo restrictions: https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/geo-restrictions
9. factoHR touchless attendance: https://factohr.com/touchless-attendance/ ; attendance software: https://factohr.com/payroll/attendance-software
10. StaffAny geofenced timeclock with QR and photo: https://help.staffany.com/en/articles/5853264-set-up-geofenced-timeclock-with-qr-code-and-photo
11. StaffAny dynamic QR timeclock: https://help.staffany.com/en/articles/12381621-setting-up-dynamic-qr-timeclock
12. QuickHR App Store listing: https://apps.apple.com/app/id1281626091
13. OnTheClock, eliminate buddy punching: https://www.ontheclock.com/otc-ppc-buddy-punch.aspx
14. Homebase mobile time clock: https://www.joinhomebase.com/time-clock/mobile-time-clock
15. Timeero Homebase review: https://timeero.com/reviews/homebase-review ; Buddy Punch Homebase review: https://buddypunch.com/blog/homebase-review
16. Deputy late clock-on/off alerts: https://help.deputy.com/hc/en-au/articles/4692702925839
17. 7shifts Who's Working: https://kb.7shifts.com/hc/en-us/articles/52542828339731-Monitor-your-shift-in-real-time-with-Who-s-Working-Getting-Started-for-Managers
18. RosterElf live attendance: https://www.rosterelf.com/nz/features/time-and-attendance/live-attendance
19. GPS spoofing detection and audit guide: https://blog.data-basics.com/clock-in/out-gps-spoofing-detection-and-audit-guide-1 ; ClockShark location tampering: https://help.clockshark.com/what-is-location-tampering-mock-locations
20. HyperTrack, detecting mock locations on Android: https://stories.hypertrack.com/hypertrack-detects-mock-locations-android/
21. Salon commission structures (MioSalon): https://blog.miosalon.com/setting-up-salon-staff-commission-structure/ ; Zenoti: https://www.zenoti.com/thecheckin/salon-commission-structure

**Location**
22. W3C Geolocation (CR Snapshot, 26 Mar 2026): https://www.w3.org/TR/geolocation/
23. Firefox Spoof Geolocation add-on (browser-level spoofing): https://addons.mozilla.org/firefox/addon/spoof-geolocation/
24. gps.gov accuracy (archived): https://archive.gps.gov/systems/gps/performance/accuracy/
25. Android location permissions: https://developer.android.com/develop/sensors-and-location/location/permissions ; Android Authority on approximate location: https://androidauthority.com/android-16-density-based-coarse-locations-3614048
26. Google blog, approximate location in Chrome on Android (5 May 2026): https://blog.google/products-and-platforms/products/chrome/approximate-location-chrome-on-android/ ; Chromium test page: https://chromium.googlesource.com/chromium/src.git/+/HEAD/content/test/data/android/approximate_geolocation.html
27. Privacy Guides news (7 May 2026): https://www.privacyguides.org/news/2026/05/07/chrome-for-android-now-supports-approximate-location/
28. WebKit bug 312748 (accuracyMode): https://bugs.webkit.org/show_bug.cgi?id=312748 ; W3C TAG review #1131: https://tag-github-bot.w3.org/gh/w3ctag/design-reviews/1131
29. Radar, approximate location on iOS: https://radar.com/blog/understanding-approximate-location-in-ios-14
30. TimeClock 365 geofencing guide: https://timeclock365.com/blog/geofencing-mobile-employees-guide/
31. Cloudflare Workers Request `cf` properties: https://developers.cloudflare.com/workers/runtime-apis/request/
32. RFC 6238 TOTP: https://datatracker.ietf.org/doc/rfc6238 ; dynamic-QR limits (SwipePoint): https://swipepoint.blueeyes.tw/manual0903-en.php ; Odoo QR sign-on (TOTP kiosk): https://apps.odoo.com/apps/modules/19.0/hr_qrcode_signon
33. caniuse BarcodeDetector: https://caniuse.com/mdn-api_barcodedetector
34. jsQR: https://github.com/cozmo/jsQR
35. ZXing JS: https://github.com/zxing-js/library
36. MediaPipe Face Landmarker for Web: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
39. MDN SubtleCrypto.generateKey: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey ; 39b. Ping Identity on passkey sync vs device binding: https://docs.pingidentity.com/auth-node-ref/latest/device-binding.html
40. WebKit bug 181849 (Home Screen apps don't share storage with Safari): https://bugs.webkit.org/show_bug.cgi?id=181849
41. WebKit bug 237350 (7-day cap scope for Home Screen apps): https://bugs.webkit.org/show_bug.cgi?id=237350
42. WebKit, Updates to Storage Policy: https://webkit.org/blog/14403/updates-to-storage-policy/
44. Apple forums, permissions.query returns prompt after denial: https://developer.apple.com/forums/thread/751189

**Notifications**
45. WebKit, Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
46. iOS 26 web apps by default (heise): https://heise.de/-10749652 ; Michael Tsai: https://mjtsai.com/blog/?p=49472
47. WebKit commit "Enforce silent push quota": https://webkit.googlesource.com/WebKit/+/108ccb442e40e9705d212e74c1f213e3b5a0ea05 ; Progressier fix: https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7
48. WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
49. Don't kill my app: https://dontkillmyapp.com/
50. RFC 8030 (Web Push protocol; TTL, Urgency, Topic, 4096 B): https://www.rfc-editor.org/rfc/rfc8030
51. RFC 8291 (message encryption; 3993 B plaintext): https://www.rfc-editor.org/rfc/rfc8291
52. PushForge: https://github.com/draphy/pushforge
53. web-push-neo: https://github.com/ryoppippi/web-push-neo
54. @negrel/webpush: https://jsr.io/@negrel/webpush
55. web.dev, Web Push protocol: https://web.dev/articles/push-notifications-web-push-protocol
56. Cloudflare Queues pricing: https://developers.cloudflare.com/queues/platform/pricing/
57. Meta WhatsApp pricing (per-message; 1 Oct 2026 change; INR migration): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md
58. WhatsApp API India rates (third-party): https://baat.ai/blog/whatsapp-api-pricing-india ; https://whautomate.com/whatsapp-business-api-pricing-india
59. Cloudflare Email Service pricing: https://developers.cloudflare.com/email-service/platform/pricing/
60. Resend pricing: https://resend.com/pricing

**PWA**
61. MDN, Making PWAs installable: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
62. web.dev, Maskable icons: https://web.dev/articles/maskable-icon
63. Vite PWA assets generator: https://vite-pwa-org.netlify.app/assets-generator/
64. pwa-asset-generator: https://github.com/elegantapp/pwa-asset-generator
65. Workbox, handling service worker updates: https://developer.chrome.com/docs/workbox/handling-service-worker-updates
66. caniuse Background Sync: https://caniuse.com/background-sync
67. Workbox background sync: https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
68. MDN beforeinstallprompt: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event
69. web.dev, Installation prompt: https://web.dev/learn/pwa/installation-prompt
70. Chrome, Update install criteria: https://developer.chrome.com/blog/update-install-criteria
71. vite-plugin-pwa, Prompt for update: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html
72. MDN Permissions.query: https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query

**Payroll and labour law**
37. Khaitan & Co, Gujarat S&E Amendment Act 2026 (16 Mar 2026): https://www.khaitanco.com/sites/default/files/2026-03/ERGO%20-%20Gujarat%20SE%20Amendment%20Act%202026%20-%2016%20March%202026.pdf ; SCC Online on the Dec 2025 ordinance: https://www.scconline.com/blog/post/2025/12/26/gujarat-shops-and-establishments-amendment-ordinance-2025-explained/
38. Gujarat Shops and Establishments Act 2019 (gazette text): https://nlcbharat.org/wp-content/uploads/2024/04/5-The-Gujarat-Shops-and-Establishments-Regulation-of-Employment-and-Conditions-of-Service-Act-2019.pdf
43. Code on Wages, 2019 (official text, ss.13–21, 50): https://www.indiacode.nic.in/bitstream/123456789/15793/1/aA2019-29.pdf
73. EY alert, labour codes effective 21 Nov 2025: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/alerts-hub/2025/11/new-labour-codes-implemented-across-the-country-effective-21-november-2025.pdf
74. Ministry of Labour PIB note: https://labour.gov.in/sites/default/files/pib2200433.pdf
75. Taxmann, Wages (Central) Rules 2026 guide: https://www.taxmann.com/post/blog/wages-central-rules-2026-code-on-wages-chapter-wise-guide/
76. Maharashtra S&E Act 2017 (iPleaders): https://blog.ipleaders.in/need-know-provisions-relating-working-hours-overtime-leaves-maharashtra-shops-establishment-act-2017/ ; Mondaq: https://mondaq.com/india/employee-benefits-compensation/661244/maharashtra-shops-and-establishments-regulation-of-employment-and-conditions-of-service-act-2017
77. Gujarat minimum wages Apr 2026 (AscentHR): https://ascent-hr.com/notification/revision-of-minimum-wages-gujarat-010426/ ; DCPSOL: https://www.dcpsol.com/gujarat-minimum-wages-april-2026 ; Oct 2026: https://www.dcpsol.com/gujarat-special-allowance-minimum-wages-october-2026 ; WageIndicator: https://wageindicator.org/en-in/work-in-india/minimum-wage/16912-gujarat/17152-shops-and-establishments
78. LOP divisor methods (Asanify): https://asanify.com/blog/human-resources/lop-full-form-in-salary-2025-guide/ ; SAP flat 30/26 days thread: https://answers.sap.com/questions/725914/payroll-calculation-flat-every-month-for-30-days.html

**Privacy**
79. DPDP Rules 2025 notified (Mondaq): https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified
80. S.S. Rana on the final DPDP Rules (timeline, Rule 8(3) logs 1 year, 72 h breach): https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/
81. AZB on biometric data regulation in India (SPDI): https://www.azbpartners.com/bank/biometric-data-regulation-in-india-legal-landscape-and-risks/
82. DPDP Act 2023 (official text; ss.5, 7(i), 8): https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
83. Bar & Bench on legitimate use for employee data: https://www.barandbench.com/law-firms/view-point/navigating-legitimate-use-exemption-employee-data-digital-personal-data-protection-act-2023
84. KS&K on employee monitoring under DPDP: https://ksandk.com/md/data-protection-and-data-privacy/can-employers-monitor-employees-dpdp-act/ ; employee monitoring and privacy in India: https://ksandk.com/labour-employment/employee-monitoring-privacy-india/

**Stack**
85. Cloudflare R2 object lifecycles: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
86. Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
87. Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
88. Cloudflare D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
89. Supabase regions: https://supabase.com/docs/guides/platform/regions
90. Supabase phone login: https://supabase.com/docs/guides/auth/phone-login
91. Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
92. Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
93. Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
94. Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
95. Supabase pricing: https://supabase.com/pricing
96. Cloudflare changelog, D1 free tier limit enforcement (1 Sep 2026): https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
97. Hashing passwords on Cloudflare Workers (PBKDF2 100k observation): https://lord.technology/2024/02/21/hashing-passwords-on-cloudflare-workers.html
98. SMS OTP pricing in India 2026 (Message Central, vendor): https://www.messagecentral.com/blog/sms-otp-pricing-india
