# ADR-05. Staff sign-in with a PIN and a device-bound key, no SMS OTP

Status: accepted, 19 Oct 2026. Source: PRD 4.1, 10.3, 13.5.

## Context

SMS OTP in India needs DLT registration and costs per message. The owner knows every staff member in person. The main abuse to prevent is buddy punching, so a check-in must be tied to one phone and one person.

## Decision

- The owner adds a person and shares an invite with an 8-character join code (single use, 48 hours).
- The person installs the app, types the code, picks a 4 to 6 digit PIN, and the app creates a non-extractable ECDSA P-256 key in IndexedDB. The public key is registered as a pending device.
- The owner approves the device. One approved device per person; a new phone needs a new approval.
- Every punch is signed with the device key and carries the PIN.
- iOS Home Screen apps do not share storage with Safari, so the join code (and the owner's 6-digit magic code) is typed inside the installed app instead of relying on the link.

## Consequences

- No SMS cost and no DLT paperwork.
- Losing or resetting a phone always goes through the owner, which is the intended control.
- A cleared browser profile loses the key, and the person needs a new approval; the app tells them so.
- PIN hashes use a server-side pepper (`PIN_PEPPER`), so a leaked database cannot be brute-forced offline. Rotating the pepper forces PIN resets ([secrets runbook](../runbooks/secrets.md)).
