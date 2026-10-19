# Security

Feelings Staff holds names, phone numbers, check-in times and locations, and pay records for the staff of Feelings Beauty Care. This page says how to report a problem privately, and what the app protects and how. The full design is in [`docs/PRD.md`](docs/PRD.md) section 10.

## Report a problem privately

Please do not open a public issue, a public pull request or a WhatsApp group message for a security problem.

- **Preferred:** open a private security advisory in this repository (Security tab, "Report a vulnerability"), if it is available to you.
- **Otherwise:** message Harsh Bhanushali (GitHub `harshbhx`) directly and say it is about security. He built the app and runs it.
- **If you work at the salon** and think someone is using your account, or you lost your phone, tell Urmi first. She can remove the phone and sign out sessions at once ([owner guide](docs/guides/owner.md#when-something-is-wrong)).

Include:

1. What you found and where (the screen, or the method and path of the API call).
2. The steps to repeat it, and what you expected to happen.
3. What data or action it exposes, and for whom.
4. Your name or handle, if you want credit.

Do not include real staff data, PINs, join codes or session cookies. If you saw some by accident, say so and delete them.

What to expect: Harsh will confirm that he got your report, look into it, tell you what he found, and fix it before anyone talks about it publicly. He will tell Urmi, the salon owner, the same day if staff data is affected. How he handles an incident is written in [`docs/runbooks/incident.md`](docs/runbooks/incident.md).

Testing in good faith: use a preview or your own test data, not the real staff of the salon. Do not read or change other people's data, do not run volume attacks, and stop once you have shown the problem.

## What is in scope

- The app at `https://staff.feelingsbeautycare.in` and its previews: the web app, the `/api/v1` API, the service worker and the scheduled jobs.
- The code and workflows in this repository.

Not in scope: Cloudflare, GitHub and Resend themselves; attacks that rely on tricking a person (phishing); and the known limits below.

## What the app protects, and how

| Protected | How (PRD 10) |
|---|---|
| A check-in is really that person's | One approved phone per person. The phone holds a non-extractable ECDSA key, and every check-in is signed with it. The owner approves each new phone. The PIN is typed on every check-in. Single-use nonces and idempotency keys stop replays. |
| PINs and passwords | PINs are hashed with an HMAC and a secret server-side pepper (`PIN_PEPPER`), so a copy of the database cannot be brute-forced offline. The owner password uses PBKDF2 (100,000 rounds, the Workers ceiling) and the same pepper, a 10-character minimum and a common-password list. Five wrong PINs lock the account for 15 minutes; ten in a day alert the owner. |
| Sessions | A random 32-byte token in an `HttpOnly; Secure; SameSite=Strict` cookie. The server stores only its SHA-256. Sessions are revoked on logout, device removal, exit, PIN reset and "sign out others". |
| Forged requests | `SameSite=Strict`, an `Origin` check and a custom `X-FS-Client` header on every non-GET request. |
| Scripts running in the page | A strict Content Security Policy with no inline scripts and no third parties except the OpenStreetMap tile host, plus `Permissions-Policy`, HSTS, `nosniff`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `frame-ancestors 'none'` and `noindex`. No analytics and no ad scripts. |
| One salon's data from another's | Every table row has an `org_id`, and every query goes through a data layer that adds it. Tests prove another organisation's ids answer 404 and change nothing. A CI check blocks raw database access elsewhere. R2 keys start with the organisation id. |
| Who did what | An append-only audit log of changes, sign-ins, lockouts, device changes, step-ups, exports and owner views of selfies. Staff see the entries that touch their own days. |
| Sensitive owner actions | A step-up PIN (valid 10 minutes) for payroll finalise and reopen, salary changes, device approval, geofence changes, door pairing, exports, retention and managers. |
| Door code | A 30-second QR derived from a per-site secret that is stored encrypted (`QR_MASTER_KEY`). It never works alone: the person still needs the device key and the PIN. |
| Personal data in transit and at rest | TLS everywhere; D1 and R2 are encrypted at rest by Cloudflare. R2 is private with no public URL; files are served only through session-checked routes. IP addresses are never stored raw, only as an HMAC. |
| Location and selfies | Location is read only at check-in and check-out. Exact locations are deleted after 90 days and selfies after 30. Selfies are off by default, need separate consent, and there is no face matching. See the [retention runbook](docs/runbooks/retention-purge.md). |
| Secrets | Eight Worker secrets, generated on Harsh's machine and set through Wrangler. Each has a rotation procedure in the [secrets runbook](docs/runbooks/secrets.md). Tests use throwaway secrets generated on every run. |
| Operator access | There is no hidden admin or support login. Harsh works through Cloudflare with his own account. Any direct action on production data is done at the owner's request and written to the [ops log](docs/ops-log.md) and the audit log. |
| Supply chain | Dependencies are pinned. `pnpm audit --prod` runs nightly and fails on high-severity advisories. |

## Known limits

We say these plainly, to staff and to the owner:

- **A phone can be made to report a fake location.** A browser cannot prove where a phone is. The app asks for accurate readings, catches common tricks (repeated identical fixes, impossible jumps, VPNs) and flags them. The real answer is the door code for people you do not trust.
- **A photo of the door code** forwarded on WhatsApp works for up to 60 seconds, but still needs the person's phone key and PIN.
- **The owner's email is the root of owner access.** If the mailbox is taken over, so is the owner account. Sign-in links are single use and last 15 minutes, important actions need the PIN, and "sign out others" is one tap. Passkeys are planned.
- **The owner is the employer.** The owner can edit history. Every edit is logged with the old and new value and a reason, and staff can see that a day was edited.
- **Styles allow `'unsafe-inline'`** because a UI library injects a style tag. Scripts do not. A nonce-based policy is planned.

## Privacy

The salon is the data fiduciary under the Digital Personal Data Protection Act, 2023, and Harsh is the processor. Staff see a plain-language privacy notice when they join and can view their data, ask for corrections and withdraw selfie consent in the app. A breach is handled as described in the incident runbook, which includes telling the owner the same day and helping her inform affected staff and the Data Protection Board.
