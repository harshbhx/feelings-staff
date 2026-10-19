# Owner guide

For Urmi. This guide shows you how to set up Feelings Staff, add your team, see who is in, deal with requests, and run payroll at the end of the month. Nothing here needs special skills. Everything you can do on your phone you can also do on a laptop, and month end is easier on a laptop.

Harsh looks after the system behind the app. You never need to touch any of that.

<!-- Source: PRD sections 4 to 6 and 10. Update this guide when the copy on a screen changes. -->

Contents: [Sign in](#sign-in) · [Set up the app first time](#set-up-the-app-first-time) · [Add staff and approve phones](#add-staff-and-approve-phones) · [Today](#today) · [Needs action](#needs-action) · [The register](#the-register) · [Roster and venue duties](#roster-and-venue-duties) · [The door code](#the-door-code) · [Advances](#advances) · [Payroll at month end](#payroll-at-month-end) · [Exports](#exports) · [Settings](#settings) · [Your own sign-in and security](#your-own-sign-in-and-security) · [Notifications you get](#notifications-you-get) · [What the app never does](#what-the-app-never-does) · [Good to know](#good-to-know) · [When something is wrong](#when-something-is-wrong)

## Sign in

1. Open `https://staff.feelingsbeautycare.in/auth/owner` and type your email.
2. Tap **Send me a sign-in link**. The app always says "If this email belongs to an owner, a link is on its way", so nobody can use it to find out who has an account.
3. Open the email. It has a **link** and a **6-digit code**, both good for 15 minutes and for one use.
   - On a laptop, click the link.
   - On an iPhone with the app on your home screen, type the 6-digit code into the app instead. (A link tapped in Mail opens Safari, which is a different place from the app.)
4. If the email is slow, after a minute the screen offers **Resend** (3 times in 15 minutes) and **Use password instead** (if you set a password).

<!-- screenshot: owner-signin -->

**The PIN for important actions.** For some actions the app asks for your owner PIN, even though you are signed in: finalising or reopening payroll, changing a salary, approving a phone, changing the salon location, pairing a door screen, exporting data, changing retention and adding a manager. Type the PIN and the action goes on. It is remembered for 10 minutes.

## Set up the app first time

The first time you sign in, you see **Setup**: "Five quick things, then you're ready." You can skip a step and finish it later in Settings.

<!-- screenshot: owner-setup-checklist -->

1. **Salon.** Name, address and phone. They are filled in already; check them.
2. **Location.** A map shows the salon with a circle of 100 m. Tap **Looks right**, or **Calibrate** (see below).
3. **Opening hours and shifts.** Five shifts are ready: Full day 10:00 to 20:00 (60 minutes unpaid break), Sunday 10:00 to 13:00, Morning 10:00 to 15:00, Evening 15:00 to 20:00, and Split 10:00 to 14:00 with 17:00 to 21:00. Change or remove them.
4. **Holidays.** 26 January, 15 August and 2 October are in, with Uttarayan, Holi, Janmashtami, Dussehra and Diwali suggested with this year's dates. You can add days when people should not take leave (wedding season).
5. **Pay rules.** Each rule has one line that says what it does. Tap **Use these** or change them. See [Payroll at month end](#payroll-at-month-end) for what the defaults are.
6. **Selfie on check-in.** Off or on. It is off to begin with. You can also turn it on for one person.
7. **Add your first staff member.**
8. **Install and notifications** for your own phone.

### Calibrate the salon location (two or three days)

GPS inside a building is not exact, so the circle is set by measuring.

1. Stand at the salon counter and tap **Calibrate**. The app collects location for one minute and shows how exact it is.
2. Do it again on two more days, ideally with two different phones (an Android and an iPhone).
3. After at least two rounds the app proposes the middle of the readings and a circle size. It shows the old and the new circle on the map.
4. Tap **Use this** (it asks for your PIN) or **Keep current**.

Until then the app uses the salon address on the map with a 100 m circle.

## Add staff and approve phones

You can have up to **15 active** staff in the app.

### Add a person

1. **Staff**, then **Add staff**.
2. Fill in: name, mobile number, role (Stylist, Beautician, Makeup artist, Mehndi artist, Nail technician, Receptionist, Helper, Trainer, Trainee, Other), joining date, salary (monthly or daily), shift, weekly off, language (English or Gujarati), and whether a selfie is needed.
3. Tick that the person is **18 or older**. The app does not support anyone under 18 yet.
4. Tap **Save and invite**. The share sheet opens with a ready message, for example:

> Hi Priya, this is Urmi from Feelings Beauty Care. Please join our staff app: https://staff.feelingsbeautycare.in/join/K7M4QPXD  Your join code is K7M-4QPX. First add the app to your home screen, then open it and type the code. The link works for 48 hours.

   Send it on WhatsApp. If the share sheet does not open, tap **Copy**.

<!-- screenshot: owner-add-staff -->

What the app tells you while you fill it in:

- "This number already belongs to Priya. Edit Priya instead?" The number is used by someone who works here.
- "Priya left on 3 Aug. Rehire her?" Tap it to bring her back with her old history and send a new invite.
- A note in amber when the salary is below the minimum wage you entered. You can still save.

If the code runs out or is lost, open the person's profile and tap **Re-send invite**. The old code stops working.

### Approve a phone

When a person joins, you get a ping, and a card in **Needs action**: "New phone for Priya, Redmi Note 12 - Chrome, joined 2 min ago". Tap **Approve** (it asks for your PIN) or **Reject**. The person cannot check in until you approve. Approving a new phone also removes the person's old phone, because each person has one phone.

Why this step exists: it is the main protection against one person checking in for another. Look at the phone name and make sure it is the person you expect.

### Look after a person later

Open **Staff**, then the person:

- **Overview**: today and the month so far.
- **Salary**: type, amount and history. A change applies from the date you choose and asks for your PIN.
- **Shift**: shift template, weekly off, and the door code requirement for that person.
- **Leave**: balances and entries; you can add an adjustment with a note.
- **Advances**: see below.
- **Devices**: the approved phone, and **Revoke**, and **Reset PIN** (sends a new code; the old PIN stops working; the phone stays approved).
- **Exit**: **Mark as left** with the last working day. Her phone is removed, her sessions end, and the next payroll includes her for the days she worked.

## Today

**Today** is your live board. It updates every 30 seconds while it is open, and when a ping arrives.

<!-- screenshot: owner-today -->

- At the top, counters: **Present, Late, Not in yet, On leave, Week off, At a venue**. Tap one to filter.
- **Needs action** shows how many things are waiting.
- **Who's in**: name, time in, "+18 m" if late, a place badge (Inside, Edge, Venue) and hours so far.
- **Not in yet**: who should be here and is not, with **Call** and **WhatsApp** buttons.
- **Checked out**: who has gone home.

Before the first shift it says "No one is due yet. First shift starts at 10:00." On a Sunday off or a holiday: "Salon closed today (Diwali)."

Every morning at about 10:45 you get one ping with the picture: "8 in, 1 late, 1 not in yet, 1 on leave".

## Needs action

One list for everything that waits for your decision. Newest first, grouped by kind, with a number on the tab and on the app icon.

<!-- screenshot: owner-needs-action -->

| Item | What you see | What you can do |
|---|---|---|
| Flagged check-in | Name, time, a map with the circle, distance, how exact, the reasons, a selfie if there is one | **Looks fine** clears it. **Reject punch** asks for a reason, and the staff member is told. |
| Check-in waiting for you | The same, plus why it is waiting | **Approve** or **Reject** |
| New phone | Phone name, when, who | **Approve** (PIN) or **Reject** |
| Leave request | Type, dates, balance after, a warning for no-leave days | **Approve** or **Reject** (give a reason) |
| Fix a day | The day, old and proposed times | **Approve** or **Reject** |
| Overtime | The day, minutes, and "approved in advance" if it was a venue duty | **Approve all**, **Approve part** (in 15-minute steps) or **Reject** |
| Venue request | The place, map and note | **Approve**, **Approve and let others check in here**, or **Reject** |
| Day closed by the app | The day and the time the app used | **Keep 20:00** or **Change time** |

- To approve several of the same kind, tap them and choose **Approve selected**. (Phones are always one by one.)
- Every decision is written down and the staff member gets a message.
- A flagged check-in is **not** a punishment. It counts as normal until you reject it, and nothing is taken from pay because of a flag.
- Things older than 2 days are mentioned in your morning ping. There are no separate nagging pings.

## The register

**Register** is the month as a table: one row per person, one column per day. Each cell has a letter and a symbol, not only a colour: P present, H half day, A absent, L leave, WO week off, HO holiday. On the right: totals for present, half, absent, leave, late minutes, overtime hours and unpaid days. On a phone, you see each person with a strip for the week and tap through to the month.

<!-- screenshot: owner-register -->

Tap a cell to see the **day**: the check-in and check-out times with where each came from, a map with the circle and the pin, how exact the location was, why a check-in was flagged, the selfie if there is one, and the working out: hours worked, late, early, overtime, status.

**Edit day** lets you change anything: set the day's status, add, change or delete a check-in. You must write a reason. The day then shows "Edited by Urmi" to the staff member, with the history, so they can see what changed and why.

## Roster and venue duties

**Roster** is the week as a grid. Tap a cell to change a person's shift, a week off or a day off. On a laptop you can drag to swap week offs; on a phone use **Swap with...**. A warning shows when someone has more than 48 hours in a week ("Neha, 52 h this week, over 48"). Staff get a ping when their week off or schedule changes.

### Venue duties (weddings)

For work away from the salon:

1. **Roster**, then **Add off-site duty**.
2. Choose the people, the date, start and end time (they can be before 6 am or after 9 pm), the place name and the location. Set the location by **Use my current location** (if you are there), **Pick on map**, or **Paste a Google Maps link**.
3. Choose how it works: **Venue geofence** (people must be at the venue), **Anywhere** (location is written down but not checked, for home visits), or **Needs my approval** (every check-in comes to you).
4. Leave **Count hours outside the shift as overtime** on if you want those hours pre-approved.
5. Save. Each person gets a ping: "Venue duty tomorrow 04:00-09:00 at Hotel Aram."

<!-- screenshot: owner-venue-duty -->

If someone works at a venue with no duty set up, they tap **I'm at a venue**. You get "Neha checked in at a venue: 'Patel wedding, Lal Bungalow'. Approve?" and can **Approve**, **Approve and let others check in here today** (it creates the duty for the people you choose), or **Reject** with a reason.

Work before 6 am or after 9 pm is flagged. Ask each affected person for their agreement; the app asks them once.

## The door code

The door code is extra proof that a person is at the salon. It is a QR code that changes every 30 seconds. A person has to scan it in the app, and still types their PIN.

- **Your phone as the door.** Tap **Show door code** (in More). Full-screen QR, "New code in 12 s". It needs internet. Use it when you have no spare phone.
- **A screen at the door.** Pair an old phone or tablet: **Settings**, **Door code**, **Pair a door device** (PIN). The screen shows a code for 10 minutes. On the old phone open `https://staff.feelingsbeautycare.in/door` and type the code. The door screen shows the QR, a countdown, and the last check-in ("Last check-in: Priya 10:04"). You can unpair it or change its secret at any time.
- **Strong mode.** In Settings you can ask for the door code for everyone, or for one person only (their **Shift** tab). Then that person cannot check in without it. Use it for someone you are unsure about.

Be honest with yourself about one limit. A photo of the code sent on WhatsApp works for up to 60 seconds. That is why the code never checks anyone in alone, and why the door screen shows the last check-in.

## Advances

**Give an advance** (from the person's profile, or **Advances**): amount, date, how it was paid (cash, UPI, bank), reason, and how to take it back: **Full next month**, or equal parts over 2 to 12 months. The person gets a message and taps **That's right** or **Something's wrong**, so there are no arguments later.

The ledger shows what was given, what was taken back each month, what was moved to next month, and the balance. By default no more than half of a month's salary is taken back in one month; the rest moves to the next month. (This is how the law is read for the default; ask your CA if you want to change it.)

## Payroll at month end

Payroll is worked out from check-ins and your pay rules. Every number has a formula you can see.

### 1. The draft

On the 1st at 9 am you get "October payroll is ready to check". You can also tap **Start payroll** any time after the month has ended. **Payroll so far** during the month is read-only.

### 2. Settle what is still open

The draft lists what is waiting in that month. If you finalise without settling, these are the defaults:

| Open item | What happens if you go ahead |
|---|---|
| Check-ins waiting for you | Not counted |
| Flagged check-ins you did not look at | Counted as normal |
| Overtime not decided | Not paid (shown as pending) |
| Leave requests not decided | Not applied |
| Fixes not decided | Not applied |
| A day with no check-out | Closed at the end of the shift |

Settle them in the list, or tap **Finalise anyway** after the app shows you this list.

<!-- screenshot: owner-payroll-blockers -->

### 3. Check each person

You see one row per person: paid days, unpaid days, late and early minutes, overtime approved, gross, deductions and net. Tap a person for the full payslip with every line and its formula. You can:

- **Add incentive or bonus**, **Add other earning**, or **Add deduction** (damage needs a record that the person was asked first; other deductions need a note).
- **Change advance recovery for this month** (lower it; the rest moves on).
- **Recompute** after you change anything in attendance.

The app warns about: pay below the minimum wage you entered, more than 48 hours in a week, too much overtime in a quarter, and deductions reaching half of a salary.

<!-- screenshot: owner-payroll-review -->

### 4. Finalise

**Finalise October** (PIN). The month is locked, each payslip is frozen, the PDFs are made, and staff are told "Your October payslip is ready" if you have that setting on. After this nobody can change the month's attendance without reopening.

### 5. Mark paid, and share

The app does not pay anyone; money moves outside the app. After you pay, mark it: per person or **Mark all paid**, with the date, how (cash, UPI, bank transfer) and a reference if you like. On the 5th at 10 am, if some salaries are not marked paid, you get "3 salaries for October are not marked paid. The legal deadline is the 7th."

**Share** a payslip on WhatsApp from the person's payslip. If your phone cannot attach the PDF, the app sends a link instead.

### 6. Reopen if you must

**Reopen** (PIN, with a reason) makes a second version of the run. The first version's PDFs stay, marked "Replaced by revision 2". Differences for people already paid can be settled next month ("Arrears" or "Recovery") or re-issued this month.

### The default rules

These are the defaults the app starts with. Change any of them in Settings. Have your CA confirm them, and run the first month alongside the paper register.

- Salary is divided by the **days in the month**.
- A late arrival counts after **10 minutes** of grace; only the minutes after that are cut, in proportion. Fines are **off**.
- Overtime is paid at **2 times** the normal rate, only after you approve it. Time after the shift counts as overtime candidate after 30 minutes, in 15-minute blocks.
- Casual leave and sick leave are 7 days a year each, usable after 90 days; casual leave needs 2 days' notice.
- Pay day is the **5th**; the legal deadline is the 7th.

## Exports

**Reports**: pick a month, a person if you like, and a format. The exports are: attendance register (CSV and PDF), salary register (CSV and PDF), punches log, late and early report, overtime report, leave report and balances, advances ledger, and exceptions log (CSV). CSV files open correctly in Excel. Files are kept for 7 days. Exporting asks for your PIN, and every export is recorded.

## Settings

Everything is in **Settings**. Each change shows a line about what it does, and every change is recorded with the old and new value.

| Section | What is in it |
|---|---|
| Salon | Name, address, phone, logo choice |
| Location and door | Salon location and circle, calibration, door screens, strong mode, how early staff may check in (default 60 minutes) |
| Shifts and roster | Shift templates, weekly off, the 48-hour warning |
| Holidays and no-leave days | Per year; for each holiday, what happens if someone works (comp-off, extra pay, or both) |
| Attendance rules | Grace, early-leave allowance, half-day and absent limits, make-up time, automatic break, break buttons, PIN on every check-in, selfies, how careful the checks are |
| Pay rules | Divisor, overtime rules, work on week off, advances, pay day, minimum wage, fines, statutory items |
| Leave policy | Types, yearly days, notice, when leave can first be used, comp-off expiry |
| Notifications | Which pings you get, quiet hours (21:30 to 08:00), summary only |
| People and roles | Managers and what each may do |
| Data and privacy | Retention (the defaults can be read), the privacy notice text, the grievance contact (your name and number), export all data, delete a former staff member's data |
| Security | Your email, password and PIN, sessions, the audit log |
| App | Default language for staff, show payslips to staff, the minimum app version |

Pay rule changes apply from the next payroll draft. The draft you are looking at changes only when you tap **Recompute**. Changing strong mode or the risk limits asks for your PIN.

### The audit log

**Settings**, **Audit log** lists who changed what and when: the person, the action, the old and new value. You can filter it and export it. Staff see the entries that touch their own days.

## Your own sign-in and security

In **Settings**, **Security**:

- **Password and PIN.** Set a password (at least 10 characters, and not a common one) and a 6-digit **owner PIN**. The password and PIN let you sign in when email is slow, and the PIN is what the app asks for before important actions. The first time you set the PIN, do it within 15 minutes of signing in.
- **Active sessions.** See where you are signed in. **Sign out others** ends every other session. Use it if you lose a phone or laptop.
- If the PIN is locked after wrong tries, sign in with an email link to unlock it.
- Keep your email account safe. It is the key to the owner account.

## Notifications you get

Pings come as a message on your phone and as a list in the inbox. The inbox is always complete, even if you miss a ping.

| When | Ping |
|---|---|
| About 10:45 every day | Morning summary |
| Someone is late | "Priya is 18 min late", joined with others within 5 minutes |
| 30 minutes after shift start, no check-in | "Kajal hasn't checked in", with **Call** and **WhatsApp** |
| A check-in that needs a look | Flagged or waiting for you |
| New phone | Always, even in quiet hours |
| Someone is still working after the shift | Overtime running |
| 21:00, people not checked out | "2 people haven't checked out" |
| Leave, fixes, venue requests | When they arrive |
| Many wrong PINs on one account | "Several wrong PIN tries on Priya's account" |
| 1st of the month | Payroll ready |
| The 5th | Salaries not marked paid |

Quiet hours are 21:30 to 08:00. Pings in that time wait and arrive at 08:00 as one summary, except a new phone. On an iPhone, add the app to your home screen to get pings at all. You can turn each kind on or off in Settings. Security alerts cannot be turned off.

## What the app never does

- It does not track anyone. Location is read only when someone taps Check in or Check out.
- It does not keep a route, a history of where people were, or a score for how "good" a person is. There are no rankings, streaks or leaderboards.
- It does not take a face template, and it does not match faces.
- It does not pay salaries. You pay; the app records it.
- It does not cut pay because of a flagged check-in, or on its own. Fines are off until you turn them on, and need the person to be asked first.
- It does not tell Harsh or anyone else what is in your data. Harsh has no login in the app. If he must look at the data to fix a problem, he does it at your request and writes it down.
- It does not send ads or use analytics.

## Good to know

- **A phone can be made to report a fake location.** The app catches common tricks and flags them, but cannot prove where a phone is. If you suspect someone, turn on the door code for them.
- **You are responsible for staff data.** Under the data protection law, the salon is the "data fiduciary". The app helps: it asks staff to read a privacy notice, deletes locations after 90 days and selfies after 30, and keeps wage records for 5 years as required. Harsh signs an agreement with you as the one who runs the system for the salon.
- **Selfies are your choice.** They are off. If you turn them on, staff are asked separately, and can say no; then their check-ins come to you for approval.
- **Changes are visible.** Staff can see "Edited by Urmi" on a day you changed, so give a real reason.
- **Staff must keep the app installed.** If someone clears their browser data, you must approve the phone again.

## When something is wrong

- **A person cannot check in:** look at **Needs action** for their phone; check the circle on the map; use **Edit day** afterwards.
- **A person lost their phone:** **Staff**, the person, **Devices**, **Revoke**. They join again with a new invite.
- **You think someone else is using an account:** **Settings**, **Security**, **Sign out others**; and tell Harsh.
- **Something looks wrong in the numbers:** open the day or the payslip and read the formula. If it still looks wrong, tell Harsh with the date and the person's name.
- **The app does not load:** try again in a minute. Staff check-ins are saved on their phones and are sent when the app is back.
- **Anything else:** WhatsApp Harsh.
