# ADR-19. Owner access on its own host, behind Cloudflare Access, with passkeys on approved devices

Status: proposed, 21 Oct 2026. Source: Harsh, 21 Oct 2026 (08:27 UTC). Supersedes the owner sign-in part of PRD 4.1.7 once it ships; the current owner sign-in stays until the cutover step.

## Context

The owner (Urmi) and the staff share one web address, and the owner sign-in page is reachable from the staff app. Anyone who guesses `/auth/owner` sees a login for the most powerful account (payroll, pay rules, every person's data). The owner account is protected by an email code and a PIN, and email is the one thing that, if taken over, gives everything.

Harsh's decision: the owner side lives on its own unguessable address, nothing in the staff app mentions or links to it, a Cloudflare Access wall sits in front of it, and inside the app the owner signs in with a passkey (fingerprint or Face ID) on approved devices only.

## Decision

1. **Own host.** The owner app, owner API and owner sign-in are served on a separate hostname of the same Worker: a random first-level subdomain of `feelingsbeautycare.in` (chosen at cutover, kept out of the repo, the staff app, its assets and every staff-facing document; it is recorded in the secrets runbook and the Cloudflare account). A first-level name is covered by the wildcard certificate, so it does not appear as its own entry in certificate-transparency logs.
2. **Staff host knows nothing.** On the staff host (`staff.feelingsbeautycare.in`) the owner routes (`/auth/owner*`, `/o/*`, the owner API groups) answer 404 and the staff build contains no owner screens, strings or routes. The build is split into two entries (`staff` and `owner`); each host serves only its own entry. A CI check greps the staff output for owner markers.
3. **Cloudflare Access wall.** A self-hosted Access application covers the owner host. Policy: allow `urmi@feelingsbeautycare.in` and `creharsh@gmail.com`; identity provider One-time PIN (email code); session duration 7 days. The Worker also verifies the `Cf-Access-Jwt-Assertion` token (team domain, audience tag, signature through the team JWKS, expiry) on every owner-host request, so the wall cannot be bypassed through workers.dev or a DNS change. The workers.dev route of the production Worker is switched off at cutover.
4. **Passkeys inside the app (WebAuthn).** The relying-party id is the owner host. The owner signs in with a passkey; after a device is enrolled there is no email-code login for that owner.
   - **First device:** enrolled once, through the existing sign-in email (link plus code), then the browser creates the passkey.
   - **More devices:** a new device cannot enrol on its own. It creates a request; an already approved device approves it with a fingerprint (a passkey assertion) plus the owner PIN; the new device then creates its own passkey with a one-time approval token.
   - **Device list:** Settings, Security lists the approved devices with name, added date and last use, and lets the owner remove one (with passkey plus PIN). The last device cannot be removed.
   - **Recovery:** a one-time recovery code that only an admin (Harsh) can issue with a script on the VM or his laptop (stored hashed, valid 24 hours, single use, audited). It allows enrolling a new first device.
5. **Keep the PIN.** The owner PIN stays as the step-up for sensitive actions (finalise payroll, change pay rules, approve a device), in addition to the passkey.
6. **Library.** `@simplewebauthn/server` (MIT, runs on Workers through WebCrypto) for options and verification, pinned to an exact version; the browser side uses the native `navigator.credentials` API through a few lines of our own code (`@simplewebauthn/browser` only if it is small enough to lazy-load in the owner entry).

## Not chosen

- A hidden path on the staff host: security by obscurity and shared cookies, CSP and service worker with the staff app.
- Email-code login only: the mailbox is the single point of takeover.
- Passwords: phishable and reusable; the owner does not want another one.
- Google sign-in as the Access identity provider now: optional later, One-time PIN needs no setup.

## Consequences

- Two hostnames, two cookie jars (host-only cookies), two service workers and two manifests; the staff PWA no longer ships any owner code, which also helps its 170 KB budget.
- Origin and CSRF checks use a per-host allow-list instead of the single `APP_ORIGIN`; email links for the owner use the owner host.
- Cloudflare Zero Trust must be enabled on the account (the free plan covers up to 50 users). The VM's Wrangler login has no Access scope; the Access application is created by Harsh in the dashboard, or by an API token he creates (steps in [owner access](../owner-access.md)).
- Lock-out risk: mitigated by keeping the current owner sign-in until the new one is verified on two devices, and by the admin recovery code.
- Tables: `owner_passkeys`, `owner_device_requests`, `owner_recovery_codes` ([owner access](../owner-access.md)).
