# ADR-06. Server time, IST work dates, integer paise and exact fractions

Status: accepted, 19 Oct 2026. Source: PRD 7, 13.5.

## Context

Disputes are about minutes and rupees. Every number on a payslip must be reproducible from the stored records, and a phone clock cannot be trusted.

## Decision

- The server's receive time is the canonical time of a punch. Offline punches are bounded by server-signed time anchors.
- A work date is the IST calendar date, stored as `YYYY-MM-DD`. Instants are UTC epoch milliseconds.
- Money is integer paise. Rates are exact fractions, and rounding happens once per line.
- The rules live in `packages/engine` as pure functions, so the same inputs always give the same payslip.

## Consequences

- Payroll can be recomputed at any time and gives the same answer; every payslip line can show its formula.
- Each payroll run stores the engine version and a snapshot of the settings it used.
- Nobody is made late by verification: a pending punch keeps the time of its first submission.
