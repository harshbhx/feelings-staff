# ADR-18. Presence by roll-call and step-out, not background location

Status: accepted, 19 Oct 2026. Source: PRD 4.18, 7.18, 11.12 (Harsh, 19 Oct, 15:22 UTC).

## Context

Harsh's brief: count every minute, and track it when someone leaves the salon early. The punch says when a person arrived and left, but not what happened in between. The web app cannot see that by itself: a service worker has no geolocation, Android Chrome and iOS Safari give a page location only while it is visible, Periodic Background Sync is Chromium only and not guaranteed, and iOS allows nothing in the background except a push that needs a tap (PRD 11.12).

## Decision

Time away is found in two human ways, with no hardware and no phone prompts:

1. **Roll-call (primary).** The owner or a manager with the `rollcall` permission checks who is here two or three times a shift (default 12:00, 15:00, 18:00). Everyone defaults to Here and only the exceptions are tapped. A Not here mark starts an away interval and counts at once, because the owner or manager is the authority. It stays editable and audited.
2. **Step out and I'm back (fallback).** The staff member taps it with a reason chip. The interval waits for the owner, who confirms it, marks it as work or ignores it.
3. **Foreground check (optional).** A silent location check while the app happens to be open. It can only raise a "seems away" hint. It never asks for permission, never creates an interval or a credit, and stores no coordinates.

Overlapping intervals merge. Minutes are clipped to the shift, to the day's presence and outside the break window, and intervals under 5 minutes are dropped, so away and early time never overlap. Presence never changes pay by itself: minutes become money only when the owner settles credits ([ADR-17](0017-time-credits-an-owner-settled-minute-ledger-instead-of-automatic-late-and-overtime-pay.md)). People give a separate consent, can decline and still work, and see their own presence history (never credits).

Not chosen: a push every 30 minutes asking staff to tap (staff are with clients), and salon Wi-Fi presence from a router or Raspberry Pi (needs hardware and enrolment of phone addresses).

## Consequences

- It works with the app closed and on iPhone, and costs the staff phone nothing.
- Accuracy depends on the owner doing the roll-call. A missed one assumes nothing; Today shows "Roll-call at 15:00 not done".
- A native wrapper (Capacitor or TWA) with OS geofences stays a future option (PRD X-08). It would feed the same away intervals.
- Tables: `roll_calls`, `roll_call_marks`, `away_intervals`, `presence_checks` ([data model](../data-model.md)). Check rows are kept 90 days; away intervals and credit records 5 years as wage records.
