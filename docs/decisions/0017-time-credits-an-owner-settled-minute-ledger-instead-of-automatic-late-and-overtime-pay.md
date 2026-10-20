# ADR-17. Time credits: an owner-settled minute ledger instead of automatic late and overtime pay

Status: accepted, 19 Oct 2026. Source: PRD 4.19, 7.17 (Harsh, 19 Oct; Q27, Q28, Q30).

## Context

The first pay rules cut lateness automatically after a 10-minute grace and paid approved overtime at 2x. Harsh's example: someone arrives 10 minutes late every day (70 minutes in a week, all hidden by the grace) and works 2 hours of overtime on a busy day. She gets full salary and full overtime pay, and the owner sees neither side. Separately, the Code on Wages requires overtime beyond 9 hours a day or 48 hours a week to be paid at twice the normal rate.

## Decision

With Time credits on (the default for this salon), every minute is a ledger entry, one credit per minute:

- Late and early minutes are minus entries from the first minute. Grace and tolerance do not apply.
- Approved overtime is a plus entry. Unapproved overtime gives nothing.
- Away time that the owner or a manager marked, or that the owner confirmed, is a minus entry ([ADR-18](0018-presence-by-roll-call-and-step-out-not-background-location.md)).
- Over-break is shown to the owner but is not a credit.

The balance is the sum of entries and adjustments, less settled minutes. It never resets and can change sign. Nothing is paid or cut by itself. At payroll the owner settles any number of minutes between 0 and the balance (default 0, suggestion the full balance). A minus settlement is a deduction under the 50% cap, and minutes that do not fit stay on the balance. A plus settlement is an earning. Money is always at 1x the person's normal per-minute rate (`r_day / S_std`), so a minute is worth the same on every day and the balance is an exact integer.

Entries are derived and rewritten when the day is recomputed. An owner edit is a separate adjustment row with a required reason, so a recompute does not undo it and the original stays visible. Staff never see credits; the only trace is a "Time adjustment" amount on the payslip.

**Legal overtime counts twice.** Harsh first decided that hours never go past the legal limits and dropped the 2x logic, then restored it the same evening as the setting **Pay legal overtime at 2x**, on by default. The ledger has no multiplier, so the legal part is written as a second plus entry of kind `ot_legal` next to the `ot` entry, for the part of the approved overtime beyond 9 hours that day or beyond 48 hours that ISO week:

```
legal = min(ot_approved, max(daily_excess, weekly_excess))
```

Each legal minute therefore counts twice in the balance, in any netting against late and early minutes, and in the settlement. We chose this over a per-entry multiplier because every sum, the estimate, the settlement and the CSV keep working on plain signed integers, and the 1x value rule stays one rule. It also means the 2x cannot be lost by netting: 120 approved minutes and 70 late minutes give +170, which is the 2x overtime less the lateness. The cost is that a change on one day can move the weekly excess of the later days of that week, so the recompute rewrites the `ot_legal` entries of those days too. With the setting off the owner sees a warning wherever legal overtime exists.

## Consequences

- Lateness and overtime are visible to the owner and cannot hide each other.
- Pay changes only when the owner decides. The cut is proportional to time not worked, never a fine.
- Make-up time and the automatic lateness deduction are not used while credits are on. Turning credits off brings them back from the first day of the next month; balances stay and can still be settled.
- The ledger needs `credit_entries`, `credit_adjustments` and `credit_settlements`, kept 5 years as wage records ([data model](../data-model.md)).
- Credits are owner only. A privacy test asserts that no staff endpoint returns them.
- The CA reviews the defaults before the first real payroll.
