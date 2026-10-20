# Daily and monthly operations

What to look at, and when, to keep Feelings Staff healthy. Most days there is nothing to do: the app sends its own pings and runs its own clean-up. This page is the short list of checks, split into what Urmi does and what Harsh does.

Contents: [Who does what](#who-does-what) · [Every working day](#every-working-day) · [Every week](#every-week) · [Month end: close the payroll](#month-end-close-the-payroll) · [Every month](#every-month) · [Every three months](#every-three-months) · [Every year](#every-year) · [What runs by itself](#what-runs-by-itself)

## Who does what

| Person | What they look after |
|---|---|
| Urmi (owner) | Approvals, the daily glance, payroll, paying salaries, her own sign-in |
| Harsh (deployer) | Health of the system, deploys, backups, secrets, the monthly checks below |

Urmi never needs the command line. Harsh does the commands from his own machine, in `app/`, signed in to the salon's Cloudflare account. Every manual action on production goes in the [ops log](../ops-log.md).

## Every working day

**Urmi, about 5 minutes**

1. Read the morning ping (about 10:45): who is in, late, not in yet and on leave.
2. Open **Needs action** and clear it. Flagged check-ins, new phones, leave requests, fixes, overtime, venue requests and (when live) step-outs wait there. Use **Select** to approve several of the same kind.
3. In the evening, glance at **Today**. At 21:00 you get "2 people haven't checked out" if someone forgot. The app closes any open day at the end of the shift, so nothing is lost, but a day closed by the app waits for your **Keep** or **Change time**.
4. If roll-calls are on, do them when the ping comes ([owner guide](../guides/owner.md#roll-call-and-step-outs)).

**Harsh, only if a problem is reported.** Otherwise nothing daily. Open the [troubleshooting page](troubleshooting.md) when someone reports a problem.

## Every week

**Urmi**

- Look at **Roster** for the coming week: week offs, venue duties for weddings, and the 48-hour warning.
- Look at **Advances** if you gave any: is the recovery what you intended?

**Harsh, 5 minutes**

- Check the `r2-lifecycle` run from Monday is green: `gh run list --workflow r2-lifecycle --limit 1`. A red run means a storage clean-up rule is missing.
- Check the `nightly` runs are green (the dependency audit): `gh run list --workflow nightly --limit 3`. If the audit fails, open a pull request that updates the dependency, and let CI and deploy do the rest ([update and rollback](update-rollback.md)).
- Check the app answers: `curl -fsS https://staff.feelingsbeautycare.in/api/v1/health`.

## Month end: close the payroll

Payroll is Urmi's work. Harsh only helps if a number looks wrong. Allow about an hour for 15 people. A laptop is easier than a phone. The full screens are in the [owner guide](../guides/owner.md#payroll-at-month-end); this is the order of work.

| When | Who | What |
|---|---|---|
| Last days of the month | Urmi | Clear **Needs action** so that leave, fixes, overtime and check-ins are decided. Add any advances given. |
| 1st, 09:00 | The app | Sends "October payroll is ready to check" and makes the draft |
| 1st to 3rd | Urmi | Open **Payroll**, then the month. Settle the open items listed by the draft. Open each person's payslip and read the formula. Add incentives, bonuses or deductions. Settle Time credits if they are on. Tap **Recompute** after any change. |
| 1st to 3rd | Urmi | Tap **Finalise** (PIN). The month locks and the payslip PDFs are made. Staff get "Your payslip is ready". |
| By the 5th | Urmi | Pay each person outside the app (cash, UPI or bank). Then tap **Mark paid** for each, or **Mark all paid**. |
| 5th, 10:00 | The app | If any salary is not marked paid, it pings Urmi. The legal deadline is the 7th. |
| After finalising | Urmi | Share payslips on WhatsApp if someone asks. Export the salary register (PDF and CSV) from **Reports** and keep it. |

Checks before finalising:

- The draft shows no open check-ins waiting for you. Items still waiting follow the defaults in the owner guide, and the defaults are not always what you want.
- Anyone who left this month is in the run for the days worked.
- The warnings (minimum wage, 48 hours in a week, deductions at half of a salary) are understood, not ignored.
- Net pay for two or three people matches the paper register in the first months.

If a payslip is wrong after finalising: **Reopen** (PIN, with a reason), fix it, finalise again. The first version's PDFs stay, marked as replaced. See [a payslip is wrong](troubleshooting.md#a-payslip-is-wrong).

**Harsh, month end.** On the 2nd, check that the payroll PDFs exist (a staff payslip shows "Download PDF", not "Preparing the PDF..." after a few minutes). If PDFs do not appear, see [troubleshooting](troubleshooting.md#a-payslip-pdf-does-not-appear). Tell Urmi in plain words what you found.

## Every month

**Harsh, 15 minutes, around the 3rd after the payroll is finalised**

1. Take a manual database export and keep it somewhere safe ([backup and restore](backup-restore.md#take-a-manual-export)). The deploys keep a copy for 30 days, but a month-end copy is the one that matters for the five-year wage records.
2. For the first three months, run the retention checks ([retention runbook](retention-purge.md#check-that-it-works)) and write the results in the ops log. After that, run them every three months.
3. Look at the Cloudflare dashboard for the Worker: errors, and the usage against the Workers Paid plan. The app is small, so the bill should stay near $5 a month.
4. Check **Settings, Security, Active sessions** with Urmi, and use **Sign out others** if she sees something she does not know.

## Every three months

- Do the [backup check](backup-restore.md#verify-a-backup).
- Read the people list with Urmi: staff who left are marked as left, so their phones are removed.
- Check dependencies and the browser support of the staff app are still fine: the `nightly` audit covers the first.
- Ask Urmi if any pay rule needs to change. Changes apply from the next payroll draft.

## Every year

- Rotate the secrets that list a yearly routine in the [secrets runbook](secrets.md#inventory): the Cloudflare API token and, if used, the Resend key.
- In January, add the holidays for the new year in **Settings, Holidays and no-leave days**. Check leave balances at the start of the year.
- Re-read the privacy notice and the grievance contact in **Settings, Data and privacy**.
- Have the accountant confirm the pay rules again, especially minimum wage and overtime.

## What runs by itself

You do not need to start these. They are listed so you know what a "missing" job would mean.

| What | When | Where it is defined |
|---|---|---|
| Reminders, lateness pings, roll-call reminders, payroll ready, salary unpaid | Every 5 minutes | Worker cron `*/5 * * * *` |
| Nightly job: closes the last work date, marks absences, clears old data | 03:00 IST (`30 21 * * *` UTC) | Worker cron |
| Monthly purge of five-year data | The 1st | Nightly job |
| Dependency audit, and full browser tests if `main` changed | 02:00 IST | `nightly` workflow |
| Storage rule check | Mondays | `r2-lifecycle` workflow |
| Database copy before each deploy | Every deploy | `deploy` workflow |

If the app is quiet when it should have spoken (no morning ping, no payroll ping), look at [push is not arriving](troubleshooting.md#push-is-not-arriving) and the cron logs (`npx wrangler tail` from `app/`).
