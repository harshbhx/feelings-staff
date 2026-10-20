# Frequently asked questions

Short answers for Urmi, staff and whoever deploys the app. Each answer links to the page with the full steps.

Contents: [Owner](#owner) · [Staff](#staff) · [Pay](#pay) · [Privacy](#privacy) · [Running the app](#running-the-app)

## Owner

**How do I sign in?** Open `https://staff.feelingsbeautycare.in/auth/owner`, type your email and tap **Send me a sign-in link**. Use the link, or on an iPhone with the app on the home screen, the 6-digit code. [Owner guide](guides/owner.md#sign-in)

**What is the PIN the app asks for?** Your owner PIN. The app asks for it before important actions such as finalising payroll, changing a salary, approving a phone or exporting data. Set it in **Settings, Security**. [Owner guide](guides/owner.md#your-own-sign-in-and-security)

**A new person joined. Why can they not check in?** You must approve their phone first. Look in **Needs action** for "New phone". [Add staff and approve phones](guides/owner.md#add-staff-and-approve-phones)

**How many people can I add?** Up to 15 active staff.

**Someone lost their phone. What now?** **Staff**, the person, **Devices**, **Revoke**. Then **Re-send invite** when they have a new phone. [Troubleshooting](runbooks/troubleshooting.md#a-phone-is-lost-or-replaced)

**Someone forgot their PIN.** **Staff**, the person, **Devices**, **Reset PIN**. They get a new code on WhatsApp. [Troubleshooting](runbooks/troubleshooting.md#a-pin-is-forgotten-or-locked)

**Someone forgot to check out. Is the day lost?** No. The app closes the day at the end of the shift and asks you to keep that time or change it.

**What is a flagged check-in? Is it a punishment?** No. It only means "take a look". It counts as normal until you reject it, and nothing is cut from pay because of a flag. [Needs action](guides/owner.md#needs-action)

**What is the door code, and can I print it?** It is a QR that changes every 30 seconds, so a printed copy would stop working. Show it on your phone (**More, Show door code**) or on an old phone at the door. [Production setup, step 14](guides/production-setup.md#step-14-the-door-code)

## Staff

**How do I put the app on my phone?** Open the link Urmi sent. On Android use Chrome and tap **Install the app**. On iPhone use Safari, tap Share, then **Add to Home Screen**. [Staff guide](guides/staff.md#put-the-app-on-your-phone)

**Why does the app need my location?** Only to see that you are at the salon at the moment you tap Check in or Check out. It does not follow you. [Staff guide](guides/staff.md#what-the-app-does)

**It says I am too far from the salon, but I am inside.** Turn on **Precise** location for the app, stand near a window or the door, and tap **Try again**. Or use **Scan door code** or **Send to Urmi**. [Troubleshooting](runbooks/troubleshooting.md#the-location-is-wrong)

**There is no internet at the salon.** Check in anyway. The check-in is saved on your phone and sends by itself when you have signal. [Staff guide](guides/staff.md#no-internet)

**I forgot to check in or out.** Ask Urmi to fix the day, or use the fix form when your app has it. [Staff guide](guides/staff.md#fix-a-day)

**I got a new phone.** Open the app on the new phone, tap **I have a new phone** and type your number and PIN. Urmi approves it. [Staff guide](guides/staff.md#new-phone-forgot-pin)

**I do not get pings.** On iPhone the app must be on the home screen. Check notifications in **Me** and in the phone settings, and set Chrome's battery use to **No restrictions** on Xiaomi, Oppo, Vivo, Realme and Samsung. [Troubleshooting](runbooks/troubleshooting.md#push-is-not-arriving)

## Pay

**Where does a number on my payslip come from?** Every line shows how it was worked out, for example "₹15,000 / 31 days x 29 paid days". Open the day behind it in **Month**. [Staff guide](guides/staff.md#your-payslip)

**A payslip is wrong.** Before finalising, fix the cause and tap **Recompute**. After finalising, use **Reopen** with a reason. [Troubleshooting](runbooks/troubleshooting.md#a-payslip-is-wrong)

**Does the app pay salaries?** No. You pay outside the app and then tap **Mark paid**. The legal deadline is the 7th.

**What are Time credits?** A running count of minutes for each person: late, early, time away that you confirm, and approved overtime. It never changes pay until you settle it at payroll. Staff do not see minutes or balances. [Owner guide](guides/owner.md#time-credits)

**When do I do payroll?** From the 1st, when the app says "October payroll is ready to check". [Month end](runbooks/operations.md#month-end-close-the-payroll)

## Privacy

**Can Urmi or Harsh see where staff are during the day?** No. Location is read only at check-in and check-out. [What the app never does](guides/owner.md#what-the-app-never-does)

**Are selfies used?** Only if Urmi turns them on, and staff can say no. They are deleted after 30 days. Exact locations are deleted after 90 days. Wage records are kept for 5 years.

**Does Harsh have a login to the data?** No. If he must look at data to fix a problem, he does it at the owner's request and writes it in the [ops log](ops-log.md).

## Running the app

**What does it cost?** About $5 a month for Cloudflare Workers Paid. [Deploy guide, reference](deploy.md#reference)

**How do I set it up from scratch?** [Production setup guide](guides/production-setup.md)

**How does an update reach the salon, and how do I undo one?** [Update and rollback](runbooks/update-rollback.md)

**Are there backups?** Yes. The database can be rewound for 30 days, and every deploy saves a copy first. Check them every three months. [Backup and restore](runbooks/backup-restore.md)

**What do I check each day, week and month?** [Daily and monthly operations](runbooks/operations.md)

**How do I change a secret?** [Secrets runbook](runbooks/secrets.md)

**Something is wrong and it is not on this page.** [Troubleshooting](runbooks/troubleshooting.md), or the [incident runbook](runbooks/incident.md) for a leak or an outage.
