# Something is wrong: troubleshooting

Start here when a person says "it does not work". Each section begins with what Urmi can do in the app, then what Harsh does if that is not enough. Use plain words with staff, and never ask anyone to read out a PIN.

For a leak, abuse or an outage, go to the [incident runbook](incident.md) instead.

Contents: [First, three quick questions](#first-three-quick-questions) · [A staff member cannot check in](#a-staff-member-cannot-check-in) · [The location is wrong](#the-location-is-wrong) · [A phone is lost or replaced](#a-phone-is-lost-or-replaced) · [A PIN is forgotten or locked](#a-pin-is-forgotten-or-locked) · [A payslip is wrong](#a-payslip-is-wrong) · [A payslip PDF does not appear](#a-payslip-pdf-does-not-appear) · [Push is not arriving](#push-is-not-arriving) · [The owner cannot sign in](#the-owner-cannot-sign-in) · [The app asks to update](#the-app-asks-to-update) · [The app is slow or does not load](#the-app-is-slow-or-does-not-load) · [When to call Harsh](#when-to-call-harsh)

## First, three quick questions

1. **Is it one person or everyone?** One person: a phone, location or account problem. Everyone: probably the system. Check `https://staff.feelingsbeautycare.in/api/v1/health` and the Cloudflare status page.
2. **What does the screen say?** The message on the screen is the best clue. The staff guide explains each one in [What the messages mean](../guides/staff.md#what-the-messages-mean).
3. **Did something change today?** A deploy, a secret rotation or a new phone. Check `gh run list --workflow deploy --limit 3` and the [ops log](../ops-log.md).

## A staff member cannot check in

**What Urmi checks, in this order**

| Look at | What it tells you | What to do |
|---|---|---|
| **Needs action** for a "New phone" card | The phone was never approved, or a new phone replaced the old one | Approve it (PIN) after checking the phone name |
| **Staff**, the person, **Devices** | The phone is missing or was revoked | The person joins again from a new invite (**Re-send invite**) |
| **Staff**, the person: is the person marked as left or not active? | "Your account is not active" | Rehire or correct the status |
| The person's screen: "Location is off for this app" | The phone blocks location | Staff guide steps on the screen, then **Try again** |
| "You're about 340 m from the salon" | They are outside the circle | Walk to the salon, or use **Scan door code**. If they are inside and still see this, see [the location is wrong](#the-location-is-wrong) |
| "Too many wrong tries. Try again at 10:42." | Five wrong PINs, a 15-minute wait | Wait, or reset the PIN ([below](#a-pin-is-forgotten-or-locked)) |
| "Please update the app" | A new version is needed | The person taps **Update now** ([below](#the-app-asks-to-update)) |
| "Your shift starts at 10:00. You can check in from 9:00." | Too early | They can still choose **Check in anyway** |
| The door code is required for this person | Strong mode is on for them | They must scan the door code. Check the door screen shows a code. |

**In the meantime.** Do not make the person wait. Tell them to tap **Send to Urmi** with a note, or to check in later. Afterwards use **Register**, the day, **Edit day** with a real reason. The staff member sees "Edited by Urmi".

**What Harsh checks, if Urmi's list does not explain it**

1. Does `GET /api/v1/health` answer `ok`? If not, see the [incident runbook](incident.md#a-bad-deploy-or-the-app-is-down).
2. Live logs while the person tries again: from `app/`, `npx wrangler tail`. Look for the error code in the failing `/api/v1/` request.
3. Common codes: `UPGRADE_REQUIRED` (426) means the phone has an old app version, `CSRF` (403) means a wrong origin or old client, `RATE_LIMITED` means too many tries in a minute, and a punch outcome of "needs proof" means the app was not sure about the location.
4. If it started after a secret rotation, read the "side effect" of that secret in the [secrets runbook](secrets.md#inventory). A rotated `PIN_PEPPER` stops every PIN, and a rotated `QR_MASTER_KEY` breaks the door code until the door device is paired again.

## The location is wrong

Two different problems look alike: the **person's phone** is imprecise, or the **salon's circle** is in the wrong place.

**One person is outside the circle, the rest are fine.** Their phone is giving a rough location. Ask them to turn on **Precise** location for the app, stand near a window or the door, and tap **Try again**. If they still cannot check in, use **Scan door code** or **Send to Urmi**.

**Many people are outside or at the edge.** The circle is probably wrong or too small.

1. Open **Today** or a flagged day and look at the map: is the circle on the salon? Check the dots of several people over a few days.
2. Recalibrate: **Settings, Location and door, Calibrate** ([owner guide](../guides/owner.md#calibrate-the-salon-location-two-or-three-days)). Do it at the counter, on two different days, with two different phones. After at least two rounds the app proposes a new centre and size, and the PIN confirms it.
3. Do not make the circle large to make the problem go away. A very large circle means anyone nearby can check in.

**A check-in was marked "Edge" or flagged.** That is not a punishment. It counts as normal until Urmi rejects it. Tap **Looks fine**.

**Wedding or venue.** The place needs a venue duty ([owner guide](../guides/owner.md#venue-duties-weddings)), or the person taps **I'm at a venue** and Urmi approves.

## A phone is lost or replaced

**Lost phone.** Do this at once.

1. Urmi: **Staff**, the person, **Devices**, **Revoke**. The phone and its sessions stop working.
2. When the person has a new phone: **Re-send invite**. They install the app, join with the new code, and Urmi approves the new phone.
3. If it was Urmi's own phone: sign in on a laptop with the email link, then **Settings, Security, Sign out others**.

**New phone, same person.** The person opens the app on the new phone and taps **I have a new phone**, then types their number and PIN. Urmi approves it, which also removes the old phone.

**Cleared browser data, removed the app or reset the phone.** The phone's key is gone. Urmi must approve the phone again. Prevent it by telling staff to keep the app on the home screen and never to clear its data.

Harsh: if someone may have used a lost phone, follow "A staff phone is lost" in the [incident runbook](incident.md#a-staff-phone-is-lost).

## A PIN is forgotten or locked

- **Staff forgot the PIN.** Urmi: **Staff**, the person, **Devices**, **Reset PIN**. The person gets a new code on WhatsApp, types it, and sets a new PIN. The phone stays approved.
- **Locked after five wrong tries.** It unlocks by itself after 15 minutes. Urmi is told if it happens many times in a day.
- **Owner PIN locked.** Sign in with an email link, which unlocks it, then set it again in **Settings, Security**.
- **Owner forgot the PIN.** **Settings, Security, Forgot your PIN?**: sign in again with an email code, then set a new PIN within 15 minutes. If that does not work, Harsh clears it with the [owner recovery runbook](owner-recovery.md).
- **Every PIN stopped at once.** `PIN_PEPPER` was changed. Follow [the secrets runbook](secrets.md#pin_pepper).

## A payslip is wrong

Do not edit the number by hand. Find where it comes from.

1. Open the payslip. Each line has a formula, for example "₹15,000 / 31 days x 29 paid days". Read it.
2. Open the day behind the line (**Register**, the cell). The check-in times, the status and the reason are there. If a day is wrong, **Edit day** with a reason.
3. Is something decided or not decided? Leave not approved, a fix not applied, overtime not approved and check-ins waiting are not counted ([defaults](../guides/owner.md#2-settle-what-is-still-open)). Decide it, then **Recompute**.
4. Is it a rule? Pay rules apply from the next draft. The current draft changes only when you tap **Recompute**.
5. Time credits (when on): the **Time adjustment** line is whatever Urmi settled. Check the settlement in the payroll step, not the payslip.

**Before finalising:** fix and **Recompute**.

**After finalising:** **Reopen** (PIN, with a reason), fix, and finalise again. The first version's PDF is kept and marked "Replaced by revision 2". For a person who is already paid, settle the difference next month as "Arrears" or "Recovery", or re-issue it this month.

**If the numbers cannot be explained.** Give Harsh the month, the person's name and the line. He checks the run and the day's calculation. Do not send him PINs or screenshots of other people's data in a chat group.

## A payslip PDF does not appear

The online payslip is always there. The PDF is made after finalising and can take a minute ("Preparing the PDF...").

1. Wait two minutes and open the payslip again.
2. If the PDF could not be made, Urmi gets a notice such as "1 payslip PDF couldn't be made. The online slip works." and the payslip says the same. Share the online payslip meanwhile. Tell Harsh.
   Harsh: run `npx wrangler tail` from `app/` and look for the error from the PDF step. Do not edit the payslip data.
3. PDFs are made through Cloudflare Browser Run, which is on the Workers Paid plan. Check the plan is active and the usage has room (about one minute of browser time is used a month).
4. A lost PDF can always be made again from the frozen payslip, so nothing is lost ([backup runbook](backup-restore.md#files-in-r2)).

## Push is not arriving

Pings are a convenience: the inbox in the app always has the full list. A missing ping is never a missing record.

**One person gets no pings.** Go through this list on their phone.

1. **iPhone:** pings only work when the app is on the home screen and was opened from there. If it runs in Safari, install it ([staff guide](../guides/staff.md#iphone)).
2. **Notifications are off in the app.** **Me**, **Notifications**. Turn them on.
3. **Notifications are off in the phone settings** for Chrome or for the app. Turn them on.
4. **Battery saving** on Xiaomi, Oppo, Vivo, Realme and Samsung. Set Chrome's battery use to **No restrictions**.
5. **Quiet hours.** Pings from 21:30 to 08:00 wait and arrive at 08:00 as one summary. A new phone card is the only exception.
6. **A kind of ping is off.** Urmi can turn each kind on or off for herself in **Settings, Notifications**. Security alerts cannot be turned off.
7. **The phone is switched off, or has no internet.** The ping arrives when it is back, or it shows in the inbox.
8. **The subscription went stale.** The phone is removed from the list when the push service says the subscription is gone. Opening the app and turning notifications off and on subscribes again.

**Nobody gets pings.** Harsh checks:

1. `VAPID_PUBLIC_KEY` in `app/wrangler.jsonc` and the secret `VAPID_PRIVATE_JWK` must be a pair. Changing only one stops every push ([secrets runbook](secrets.md#vapid_private_jwk-and-vapid_public_key)). After a pair change, every phone must subscribe again.
2. Watch a send: `npx wrangler tail` from `app/`, then trigger a ping. Look for the push error codes: 404 or 410 (subscription gone), 413 (too large), 429 (try again later).
3. The scheduled jobs: no morning ping or reminder on any day means the cron may not be running. Check the Worker's triggers in the Cloudflare dashboard.
4. A preview environment never sends pings or emails: they are captured in an outbox on purpose.

## The owner cannot sign in

- **The email did not come.** Check spam. After a minute the screen offers **Resend** (3 times in 15 minutes). The address must be the one set up as owner.
- **The link opens the wrong place on iPhone.** Type the 6-digit code into the app on the home screen instead.
- **The code or link is too old.** They last 15 minutes and work once. Ask for a new one.
- **The password and PIN are the backup.** **Use password instead** works if one was set.
- **Email does not work at all.** Harsh checks the email domain status in the Cloudflare dashboard (Email Service). If it is down for long, switch `EMAIL_PROVIDER` to `resend` as described in the [deploy guide](../deploy.md#4-email).

## The app asks to update

"Please update the app" or "A new version is ready" appears after a deploy. The person taps **Update now**. If it keeps appearing, close the app completely and open it again. If it still does, remove the app from the home screen, add it again, and tell Urmi, who must approve the phone again because its key is gone.

Harsh: the minimum version is `MIN_APP_VERSION` in `app/wrangler.jsonc`. Only raise it when an old app would break something. See [update and rollback](update-rollback.md#the-minimum-app-version).

## The app is slow or does not load

1. Try again in a minute. Check-ins are saved on the phone and sent when the app is back, so nobody loses a check-in.
2. Check `https://staff.feelingsbeautycare.in/api/v1/health` and the [Cloudflare status page](https://www.cloudflarestatus.com/).
3. If it began right after a deploy, roll back ([update and rollback](update-rollback.md#roll-back-the-code)).

## When to call Harsh

- A number cannot be explained from the day and the formula.
- Something looks like another person is using an account.
- Everyone has the same problem, or the health check fails.
- You need data fixed that the app cannot change.

Give the date, the person's name and what the screen said. Harsh writes every direct action on production in the [ops log](../ops-log.md).
