# ADR-20. Decisions of 21 October 2026

Status: accepted, 21 Oct 2026 (Harsh, between 08:13 and 08:27 UTC). One record for four small decisions made the same morning, so they are not lost in chat.

## 1. Staff see their distance from the salon, never the radius

When staff are about to check in and their position is known, the app shows only how far they are: under 1 km in metres rounded sensibly ("You are 340 m from the salon"), from 1 km in kilometres with one decimal ("You are 1.2 km from the salon"). The allowed radius is never shown to staff, in the UI, in error messages, in logs shown to staff or in staff documents, because people would stand just inside it. Outside the radius the copy is calm and does not reveal the number: "You are 340 m from the salon. Come closer to check in." The owner settings and owner guide may still show the radius. The geofence logic itself does not change.

## 2. Owner access: own host, Cloudflare Access, passkeys

The owner side moves to its own unguessable address, behind a Cloudflare Access wall with a 7-day session (allowed: urmi@feelingsbeautycare.in and creharsh@gmail.com, email one-time code), with passkeys (fingerprint or Face ID) on approved devices only inside the app. Nothing in the staff app mentions the owner side. Full decision: [ADR-19](0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md); design and build plan: [owner access](../owner-access.md). The current owner sign-in stays until the cutover is verified.

## 3. The UI redesign is scheduled after 8 PM IST (14:30 UTC) on 21 Oct 2026

It includes the interaction-feel work (press, hover, focus, pending and disabled states, haptics, success moments). Brief and slices: [UI redesign plan](../ui-redesign-plan.md), with the interaction design in section 5a and the owner access screens in section 5b. One designer agent (Opus only for design decisions, Sonnet for implementation), small PRs, baselines through CI, production only through green `main` and the redeploy recipe.

## 4. Photo check-in is researched, not approved

Research: [photo check-in](../research/photo-checkin.md). Recommendation there: Phase 0 only (required live selfie with an on-screen code, owner review queue), keeping the door QR as the fallback; no face matching. Nothing is built and the QR stays as it is. Revisit only when Harsh asks for it.
