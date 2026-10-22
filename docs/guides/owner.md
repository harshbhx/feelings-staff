# Owner guide

For Urmi. This guide shows you how to set up Feelings Staff, add your team, see who is in, deal with requests, and run payroll at the end of the month. Nothing here needs special skills. Everything you can do on your phone you can also do on a laptop, and month end is easier on a laptop.

Harsh looks after the system behind the app. You never need to touch any of that.

Everything in this guide is live in your app. The app is in English only for now.

If something does not work, start with [When something is wrong](#when-something-is-wrong), and see the [FAQ](../faq.md).

<!-- Source: PRD sections 4 to 6 and 10. Update this guide when the copy on a screen changes. -->

Contents: [Sign in](#sign-in) · [Set up the app first time](#set-up-the-app-first-time) · [Add staff and approve phones](#add-staff-and-approve-phones) · [Today](#today) · [Needs action](#needs-action) · [The register](#the-register) · [Roster and venue duties](#roster-and-venue-duties) · [The door code](#the-door-code) · [Advances](#advances) · [Time credits](#time-credits) · [Roll-call and step-outs](#roll-call-and-step-outs) · [Payroll at month end](#payroll-at-month-end) · [Exports](#exports) · [Settings](#settings) · [Your own sign-in and security](#your-own-sign-in-and-security) · [Notifications you get](#notifications-you-get) · [What the app never does](#what-the-app-never-does) · [Good to know](#good-to-know) · [When something is wrong](#when-something-is-wrong)

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

The first time you sign in, you see **Setup**: "A few quick things, then you're ready." There are eight steps. You can skip a step and finish it later in Settings. The next step to do is a card with one button; steps you have finished fold into one line such as "7 of 8 done", which you can open to revisit any of them. Skipped steps stay listed.

<!-- screenshot: owner-setup-checklist -->

1. **Salon.** Name, address and phone. They are filled in already; check them.
2. **Location.** A map shows the salon with a circle of 100 m. Tap **Looks right**, or **Calibrate** (see below).
3. **Opening hours and shifts.** Five shifts are ready: Full day 10:00 to 20:00 (60 minutes unpaid break), Sunday 10:00 to 13:00, Morning 10:00 to 15:00, Evening 15:00 to 20:00, and Split 10:00 to 14:00 with 17:00 to 21:00. Change or remove them.
4. **Holidays.** The national holidays (Republic Day 26 January, Independence Day 15 August, Gandhi Jayanti 2 October) and five festivals (Uttarayan, Holi, Janmashtami, Dussehra, Diwali) are added with this year's dates, and next year's national and Gujarat holidays are suggested too. The festivals that follow the moon (Holi, Janmashtami, Dussehra, Diwali) are not in next year's list: add them in **Settings → Holidays** when the dates are known. You can also add days when people should not take leave (wedding season).
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
2. Fill in: name, mobile number, role (Stylist, Beautician, Makeup artist, Mehndi artist, Nail technician, Receptionist, Helper, Trainer, Trainee, Other), joining date, salary (monthly or daily), shift, weekly off, language (English only for now; Gujarati is not ready), and whether a selfie is needed.
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

- At the top, one card: the date and when it was updated, "8 of 9 in" with a bar (on time, late, not in yet), and one sentence such as "3 late, 1 not in yet, 1 on leave, 1 off today". When something waits for you, the card ends with a red button, "9 things need your OK", that opens **Needs action**.
- On a phone, a switch under the card picks the list: **In**, **Not in yet** or **Away**, each with its count. On a computer you see all of them side by side: who is in on the left, who is not in yet and who is off on the right.
- **Who's in**: name, then one line with the time in, hours so far and where the check-in was ("Inside the salon", "At the edge of the salon area"), and one status on the right. The status is the most important thing about that person: "Waiting for you" or "Needs a look" when you have to decide, else "+18 m" if she was late, else the venue, else "On time". Anything else (for example "21 min late" on a check-in that waits for you) is in the line under the name.
- **Checked out** (under In): who has gone home.
- **Not in yet**: who should be here and is not, with **Call** and **WhatsApp** buttons, then who is due later.
- **Away**: who is on leave, on a week off or on holiday.

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
| Away interval ("Stepped out") | A step-out that is waiting: name, times, reason, minutes, her note | **Confirm**, **Mark as work** or **Ignore** (see [Roll-call and step-outs](#roll-call-and-step-outs)) |

- To approve several of the same kind, tap them and choose **Approve selected**. (Phones are always one by one.)
- Every decision is written down and the staff member gets a message.
- A flagged check-in is **not** a punishment. It counts as normal until you reject it, and nothing is taken from pay because of a flag.
- Things older than 2 days are mentioned in your morning ping. There are no separate nagging pings.

## The register

**Register** shows who was in, day by day. On a phone you see one row per person with the last seven days as cells; tap a name for that person's month, or switch to "Month grid" for the whole table (one row per person, one column per day). A cell shows a letter, or the minutes when someone was late (`+28`, or `+1h` for an hour or more): P present, H half day, A absent, L leave, WO week off, HO holiday. The key (button at the top right) explains every colour and symbol. On the right of the table: totals for present, half, absent, leave, late minutes, overtime hours and unpaid days. On a wide screen the table sits beside a panel for the day you pick, opening on today and the first person who needs a look; "Fix this day" opens the full day.

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

## Time credits

Time credits keep a count of minutes for each person, in your favour or against. Every minute counts: a late arrival from the first minute, an early leave from the first minute, time spent away from the salon that you confirmed, and overtime you approved. The count is a **balance**: a plus or minus number of minutes, for example +50 or −130.

The balance never cuts or pays anything by itself. It only becomes money when you settle it at payroll, and you choose how much to settle. Only you see it: staff do not see minutes or balances in their app or in a ping, and managers do not see them either. If you settle some minutes, the payslip shows one line, **Time adjustment**, with the amount only. Time lost to a break that ran over is shown to you on the day but is not a credit and costs nothing.

Why it exists: someone can arrive 10 minutes late every day (70 minutes in a week, all hidden by the 10-minute grace) and still stay 2 hours late on a busy day. Under the old rules she would get full salary and full overtime. With Time credits both stay visible and you decide.

### The Credits screen

**More → Credits** shows one row per active person: name, balance, what it is worth in money, the last settlement and a chip for away times still waiting for your decision.

<!-- screenshot: owner-credits -->

- The money is for reading only: "worth about ₹45" for a plus balance and "might cut around ₹96" for a minus balance. It uses the person's normal rate per minute.
- Sort by balance, or filter by plus or minus.
- Nothing on this screen changes pay.

Tap a person to open her **ledger**: every entry, newest first on a phone. Each line shows the date, the kind (late, early, away, overtime, legal 2×, adjusted, settled), the minutes, the running balance, where it came from and who confirmed it. Late and early entries say "automatic". At the top it says "Nothing is cut or paid until you settle it at payroll." You can filter by kind and date, show only what is not settled yet, and **Export CSV** (PIN). The export is one month at a time. The file is made in the background and you find it in **Reports**.

### Adjust an entry

Open the person's ledger and tap **Adjust or see history** on an entry, or tap **Adjust minutes** at the top. Choose **Add minutes** or **Take away minutes**, type the minutes and a reason, and tap **Save adjustment**. For example, you excuse a late of 10 minutes: add 10 minutes to that day's late entry, reason "approved by Urmi". The original entry stays visible with your change and your reason under it, so the history is always readable. Later you can **Change** an adjustment or **Void** it (with a reason); a voided adjustment stays in the history. You can do this any time; in a month that is already finalised the change counts in the next payroll.

### A worked example

Priya is late by 10 minutes on seven days in October. Her pay rules would hide all of it. On 17 October she works 10:10 to 22:10 and you approve 120 minutes of overtime.

| Entry | Minutes |
|---|---|
| 7 late arrivals, 10 minutes each | −70 |
| Overtime you approved | +120 |
| Legal 2×: the 120 minutes beyond 9 hours that day count a second time | +120 |
| **Balance** | **+170** |

The Credits screen says "worth about ₹152". At payroll you can settle 0 (nothing on the payslip, the +170 carries over), or settle +170 (a payslip line "Time credits: +170 min, +₹152.33", and the balance goes to 0).

### Settle credits at payroll

In the payroll run, the **Settle credits** step lists everyone who has a balance at the end of the month. For each person you see her balance and its money, a stepper, the money it makes and the "balance after".

- The stepper (**5 min less**, **5 min more**) moves in steps of 5 minutes. You can also type an exact number. **Settle 0** sets it back to nothing. **Suggested** sets the whole balance.
- Tap **Save settlements** to keep your choices. The card then says how many minutes you settled. **Undo changes** goes back to what was last saved.
- **The default is 0.** Nothing is settled unless you choose it.
- A minus settlement is a deduction. It follows the same rule as other deductions: a cut stays within half of the month's pay. Minutes that do not fit stay on the balance, with a note such as "20 min stay on the balance".
- A plus settlement is an earning.
- You can change the step until you tap **Finalise**. On Finalise the settlement becomes the payslip line and the balance goes down by that many minutes. If you **Reopen** the month, the settlement is voided and the stepper comes back with the same values.
- What you do not settle carries over to next month. There is no reset.

The usual payroll warnings (more than 48 hours in a week, pay below the minimum wage, deductions reaching half the salary) show here too.

### Pay legal overtime at 2×

The law says overtime beyond 9 hours a day or 48 hours a week must be paid at twice the normal rate. **Pay legal overtime at 2×** is **on** by default. With it on, approved overtime beyond those limits counts twice in the ledger (the "legal 2×" entry), so it is worth twice as much whenever you settle it, or when it cancels late and early minutes. Priya's 120 minutes above are an example.

At the Settle credits step, the payslip preview and Finalise, you see "120 min of overtime beyond 9 h a day or 48 h a week count at 2×, as the law requires." If you turn the setting off you see a warning instead: "Overtime beyond 9 h a day or 48 h a week must be paid at 2× by law. 120 min this month count at 1×." The warning stays until you turn the setting on again. Changing it asks for your PIN, is recorded, and applies to every day that is not locked. Have your CA confirm this before the first real payroll.

### Turn credits on or off

**Settings → Time credits.** It is on for the salon by default. It starts counting from the first day of next month, or from an earlier day of the current month if you pick one. Turning it off stops new entries from the first day of next month. From then on the old rules apply again (grace and make-up time for lateness, automatic overtime pay after approval). The existing balances stay visible and can still be settled. Switching it on or off asks for your PIN.

You can leave one person out in her profile.

## Roll-call and step-outs

The punch tells the app when someone arrived and left. Roll-call and step-outs tell it about the time in between. The app does not track anyone's phone in the background: it cannot, and the reasons are in [ADR-18](../decisions/0018-presence-by-roll-call-and-step-out-not-background-location.md). People are found away in two human ways.

### Roll-call

You, or a manager you allow, check who is here two or three times a shift.

- **Times.** Settings → Presence. The default is 12:00, 15:00 and 18:00. You can have one to four, in order and before closing time. A change applies from the next one.
- At each time you get a gentle ping, "Roll-call time". **Today** shows a card, "Roll-call at 15:00 is open", with **Start roll-call**. If it is not done within 30 minutes, you get a second ping and the card says "Roll-call at 15:00 not done" with **Do it now**. Nothing is assumed if you miss one. **More → Roll-call** lists all of today's roll-calls: Later, Open, Done (and by whom) or Not done.
- The roll-call lists everyone who is checked in at that moment ("Who's not here?"). Everyone is set to **Here**. Tap only the people who are not at the salon to switch them to **Not here**. A row can carry a hint: "Seems away", "Stepped out 14:40", "Away since 15:00" or "On break". People on leave, off duty or not checked in are not listed.
- Tap **Done**. It says, for example, "Roll-call at 15:00 saved: 5 here, 1 not here". It takes about 20 seconds. You can open a done roll-call, change a mark and tap **Done** again until payroll is finalised.

<!-- screenshot: owner-roll-call -->

**Not here** starts an away time from the roll-call time. It ends when the person taps **I'm back**, when the next roll-call marks her Here, or when she checks out, whichever is first. Because you marked it, it counts at once as minus minutes ("confirmed by Urmi"). You can still edit it. Nothing is cut until you settle at payroll.

If someone is already away, the row says "Away since 15:00" and you tap **Here** to end it.

### Edit an away time

Open it from **Today**, the day detail or **Needs action** (**Edit times**). Change **Out from**, **Back at**, the reason, and how it counts: **Away** takes the minutes off, **Work** and **Ignore** take nothing off. Say why in a few words; it is kept with the old and new times. The old and new values are recorded, and the minutes and the ledger entry follow. Managers with the roll-call permission can do this too. Overlapping away times of one person merge into one. Away times under 5 minutes are dropped. A day that is locked can only be changed by you, and the change counts in the next payroll.

### Decide a step-out

When a staff member steps out and comes back on her own, it waits in **Needs action** as an "Away interval", for example "Priya stepped out 15:30–16:10 · lunch outside · 40 min".

| Button | What happens |
|---|---|
| **Confirm** | The minutes count as minus credits |
| **Mark as work** | No minus. The usual choice for a work errand ("Bank for the salon"). |
| **Ignore** | No minus |

Her own note, if she added one, is shown. A step-out that has no **I'm back** is closed at check-out or at the next roll-call where she is marked Here, and flagged "I'm back missing". The app does not decide for you: even a work errand waits for your tap.

If someone is still checked in 30 minutes after the shift ends and has an away time open, you get "Priya may have left without checking out". When the app closes her day, it offers **Use 16:10 as check-out** (the time she went away), or **Keep 20:00**.

With Time credits off, away times are only information: no minutes, and nothing to decide.

### Presence settings and consent

**Settings → Presence** has:

- **Presence tracking**, the main switch. Off means no roll-calls, no Step out and nothing recorded. Changing it asks for your PIN.
- **Roll-call times**, one to four.
- **Step out button for staff**. Off hides Step out and I'm back; roll-call still works.
- **Quiet location check while the app is open**, off to begin with. When on, every 30 minutes (you can change how often), only while the app is on screen and location is already allowed. It can only show you "Seems away" and never costs minutes.
- **Pause during breaks**, on to begin with: no checks and no away minutes inside the break.

Managers who have the roll-call permission can do roll-calls too: set it under **Settings → People and roles**.

Each person sees a short notice once, "When you are not at the salon", and taps **OK, I understand** or **Not now**. If she does not accept, she can still check in and out and use Step out. An optional check can raise "Seems away" while her app happens to be open on screen. It never asks for location, never creates minutes by itself, and stores no route.

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

With Time credits on (the default), the **Settle credits** step comes with the draft: see [Settle credits at payroll](#settle-credits-at-payroll).

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
- **Time credits are on.** Every late and early minute and every approved overtime minute goes on a balance, and you settle it at payroll (see [Time credits](#time-credits)). The next two rules apply when credits are off.
- A late arrival counts after **10 minutes** of grace; only the minutes after that are cut, in proportion. Fines are **off**.
- Overtime is paid at **2 times** the normal rate, only after you approve it. Time after the shift counts as overtime candidate after 30 minutes, in 15-minute blocks.
- Casual leave and sick leave are 7 days a year each, usable after 90 days; casual leave needs 2 days' notice.
- Pay day is the **5th**; the legal deadline is the 7th.

## Exports

**Reports**: pick a month, a person if you like, and a format. The exports are: attendance register (CSV and PDF), salary register (CSV and PDF), punches log, late and early report, overtime report, leave report and balances, advances ledger, and exceptions log (CSV). CSV files open correctly in Excel. Files are kept for 7 days. Exporting asks for your PIN, and every export is recorded.

## Settings

Everything is in **Settings**, in four groups: The salon (Salon, Location and door, Shifts and roster, Holidays), People and pay (People and roles, Pay rules, Time credits, Leave policy), Attendance (Attendance rules, Presence, Notifications) and Account and safety (Data and privacy, Security, App, Audit log). The table below lists every section. Each change shows a line about what it does, and every change is recorded with the old and new value.

| Section | What is in it |
|---|---|
| Salon | Name, address, phone, logo choice |
| Location and door | Salon location and circle, calibration, door screens, strong mode, how early staff may check in (default 60 minutes) |
| Shifts and roster | Shift templates, weekly off, the 48-hour warning |
| Holidays and no-leave days | Per year; for each holiday, what happens if someone works (comp-off, extra pay, or both) |
| Attendance rules | Grace, early-leave allowance, half-day and absent limits, make-up time, automatic break, break buttons, PIN on every check-in, selfies, how careful the checks are |
| Time credits | The switch (PIN), **Start counting from**, **Pay legal overtime at 2×** (PIN) |
| Presence | The **Presence tracking** switch (PIN), roll-call times, the **Step out button for staff**, the optional quiet location check, **Pause during breaks**. Who may do roll-calls is under People and roles. |
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
- **Forgot your PIN?** See [below](#forgot-your-owner-pin).
- Keep your email account safe. It is the key to the owner account.

### Forgot your owner PIN

1. **Settings**, **Security**, under **Owner PIN** tap **Forgot your PIN?**, then **Sign in with an email code**.
2. Type your email and the 6-digit code from the email (or open the link). Your password does not count for this.
3. You are back on **Security**. Type a new 6-digit PIN twice and tap **Set new PIN**. You have 15 minutes from the sign-in, and one go; after that, sign in again.

The old PIN stops working at once. Every other phone and computer signed in as you is signed out, and you get an email, "Your Feelings Staff owner PIN was changed". If you get that email and it was not you, sign in with an email code straight away, set a new PIN, and make sure nobody else can open your email.

If this does not work, ask Harsh: he can clear the PIN so you set a new one at your next sign-in ([owner recovery runbook](../runbooks/owner-recovery.md)).

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
| Roll-call time (default 12:00, 15:00, 18:00) | "Roll-call time: Who's not here? It takes about 20 seconds.", and "Roll-call at 15:00 not done" if it is still not done after 30 minutes |
| Someone steps out | "Priya stepped out" with the reason and the time, then "Priya stepped out 15:30–16:10" when she is back and it waits for you |
| Still checked in after the shift with an away time open | "Priya may have left without checking out" |
| 1st of the month | Payroll ready |
| The 5th | Salaries not marked paid |

**Emails.** Three notices also come by email: the payroll draft ("October payroll is ready to check") and the **weekly digest** every Monday from 09:00 (last week's late arrivals, absent days, approved overtime, what waits for your decision, and the Time credits balances), and, if switched on for a person, the "Your payslip is ready" notice. Each has a button that opens the app. The owner gets the payroll and digest emails by default. There is no email switch on a screen yet: ask Harsh if you want them off or on for someone. Sign-in emails (the link and code) are separate and always sent. If an email does not arrive, look in spam first.

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
- **The app does not load, or says "We couldn't load this.":** tap **Try again**. This can happen once right after Harsh updates the app: the app then reloads by itself. If it keeps happening, try again in a minute. Staff check-ins are saved on their phones and are sent when the app is back.
- **A payslip looks wrong, a push does not arrive, or a location is wrong:** Harsh has a [troubleshooting page](../runbooks/troubleshooting.md) for these. Most can be fixed in the app, and it says which.
- **Anything else:** WhatsApp Harsh.
