# Owner recovery runbook

What to do when the owner cannot get past her own PIN, and later when she has lost every device ([owner access](../owner-access.md#passkeys), flows 5 and 6). The self-service path comes first; the admin script is for when that does not work.

Contents: [Forgotten owner PIN: she does it herself](#forgotten-owner-pin-she-does-it-herself) · [Forgotten owner PIN: the admin clears it](#forgotten-owner-pin-the-admin-clears-it) · [The script](#the-script) · [Lost every device: recovery code](#lost-every-device-recovery-code) · [Ops notes](#ops-notes)

## Forgotten owner PIN: she does it herself

This needs no one else and works on the staff host today (before the owner host cutover).

1. **Settings**, **Security**, under **Owner PIN**: **Forgot your PIN?**, then **Sign in with an email code**.
2. She types her email, then the 6-digit code from the email. The link in the email works too. The password does not count: a password sign-in never lets her skip the old PIN.
3. She is back on **Security**, which now shows **Set new PIN** with no "current PIN" field. She has 15 minutes from the sign-in, and one go.
4. When she saves:
   - the new PIN works at once and the old one stops;
   - wrong-try counters and any lock are cleared;
   - every other phone and computer signed in as her is signed out (this one stays);
   - she gets an email, "Your Feelings Staff owner PIN was changed";
   - the audit log gets `owner.pin_reset` ("Owner PIN reset after a new sign-in").

If 15 minutes pass, or she already used the window, the server refuses ("Enter your current PIN. Forgot it? Sign in again with a code from your email, then set a new one.") and she starts again at step 1. The server decides from the session alone (`sessions.pin_reset_until`, set only by an email-code or magic-link sign-in, or on the owner host a passkey sign-in), never from anything the browser sends. On the owner host after the cutover, **Forgot your PIN?** asks for the fingerprint or Face ID instead of an email code. If the email does not arrive, see [the owner cannot sign in](troubleshooting.md#the-owner-cannot-sign-in).

## Forgotten owner PIN: the admin clears it

Use this only when the self-service path does not work for her, and only when she asked for it herself.

1. **Confirm the request.** Call Urmi on the number you know. Never act on an email or a chat message alone.
2. **Practise on preview first** if you have not run the script before (same commands with `--database fbc-staff-preview --remote --config app/wrangler.preview-migrations.jsonc`).
3. **Dry run** on production. It looks the owner up (read only) and prints the plan and the exact SQL. Check the name and the masked email are hers.

   ```sh
   node scripts/owner-recovery.mjs --clear-pin --database fbc-staff --remote --config app/wrangler.jsonc \
     --reason "Urmi forgot the owner PIN, asked by phone"
   ```

4. **Run it** with the same command plus `--yes`. It prints `PIN now not set` and the audit row id.
5. **Tell her:** sign in with an email code, then **Settings**, **Security**, **Set PIN** within 15 minutes. Until she does, the password fallback cannot sign in (it needs the PIN too), and actions that need the PIN ask her to set one first.
6. **Ops log:** add an entry to [the ops log](../ops-log.md) with the time, who asked and how, the command (without `--yes` is fine), and the audit row id. No PIN, code or token.

What it changes, all in one `wrangler d1 execute`: `users.pin_hash`, `pin_salt` and `pin_set_at` set to NULL, `pin_failures` 0, `pin_locked_until` NULL; every session of the owner revoked; one `audit_log` row `owner.pin_cleared_by_admin` (`actor_type = system`, your `--reason`). Every statement is safe to repeat: if it stops halfway, run it again.

## The script

`scripts/owner-recovery.mjs` runs `wrangler d1 execute` against the database you name. It needs a machine with `pnpm install` done and a Wrangler login on the salon's Cloudflare account with D1 access. It runs Wrangler as `pnpm exec wrangler` from `app/`; set `WRANGLER_CMD` (for example `WRANGLER_CMD=wrangler`) to use another one.

| Option | Meaning |
|---|---|
| `--clear-pin` or `--issue-code` | The action (exactly one). `--issue-code` is [recovery codes](#lost-every-device-recovery-code). |
| `--database <name>` | D1 database name: `fbc-staff` (production) or `fbc-staff-preview`. Required. |
| `--remote` or `--local` | Which copy. One of them is required, so a command never hits production by default. |
| `--config <file>` | Wrangler config, relative to where you run the command (`app/wrangler.jsonc`, `app/wrangler.preview-migrations.jsonc`). Optional. |
| `--env <name>` | Wrangler environment. Optional. |
| `--email <address>` | Which owner, when the database has more than one. |
| `--reason "<text>"` | Written to the audit row (200 characters at most). Default "Owner forgot the PIN" or, with `--issue-code`, "Owner lost every device". |
| `--yes` | Do it. Without it nothing is written. |

It never prints a PIN, a hash, a salt or a token (the one thing it shows is the recovery code, once, after the write), and it masks the owner email (`u***@feelingsbeautycare.in`). The SQL lives in `scripts/owner-recovery-sql.mjs`; the Workers tests (`app/worker/routes/auth/pin-reset.test.ts`) run the same statements against the real schema.

## Lost every device: recovery code

Use this only when the owner has no phone or computer that signs her in (an approved device can always add another with **Add this device**), and only when she asked for it herself. It works on the owner host, so it needs `OWNER_HOST` set and the Access policy in place; before the cutover the owner signs in by email and this case cannot happen.

1. **Confirm the request.** Call Urmi on the number you know. Never act on an email or a chat message alone.
2. **Practise on preview first** if you have not issued a code before (same commands with `--database fbc-staff-preview --remote --config app/wrangler.preview-migrations.jsonc`).
3. **Dry run** on production. It looks the owner up (read only) and prints the plan and the SQL. The SQL shows only a placeholder for the hash, and the code itself is never printed in a dry run.

   ```sh
   node scripts/owner-recovery.mjs --issue-code --database fbc-staff --remote --config app/wrangler.jsonc \
     --reason "Urmi lost her phone, asked by phone"
   ```

4. **Run it** with the same command plus `--yes`. After the write it prints the code once (`K7QM-4T9X-B2NE-VH5R` style) and the audit row id. Copy it now: nothing stores it in a readable form, and a second run makes a different code and ends the first.
5. **Give it to her by phone**, not in a chat or an email. It works for 24 hours, once.
6. **She** opens the owner host, taps **Lost your phone?**, **Use a recovery code**, types the code (capitals, dashes and spaces do not matter), then **Make this phone your key** and names the phone. Inside 10 minutes of the code being accepted, once.
7. **What that does:** every old passkey is removed, every session of hers is signed out, the new phone is her only device. She should then add a second one with **Add this device**.
8. **Ops log:** add an entry to [the ops log](../ops-log.md) with the time, who asked and how, the command (without `--yes` is fine) and the audit row id. Never the code.

If she says the code does not work: the screen gives the same answer for a typo, a used code, an expired one and a stale one, on purpose. Check the audit log for `owner.recovery_used` (it was accepted; the 10 minutes may have passed, issue a new code) and `owner.recovery_failed` (typed wrongly; five misses per phone in 15 minutes pause the screen for 15 minutes). Then issue a new code; that ends the old one.

What `--issue-code` changes, in one `wrangler d1 execute`: earlier unused codes of the owner end (`expires_at` set to now); one `owner_recovery_codes` row (SHA-256 of the code, `issued_by = admin`, 24 hours); one `audit_log` row `owner.recovery_issued` (`actor_type = system`, your `--reason`). It touches no session and no passkey: those change only when she redeems the code and enrols. The [cutover runbook](owner-cutover.md) requires one practice run on a spare device before the old owner routes are closed.

## Ops notes

- A person runs the script, after a dry run, at the owner's request. Never from CI, a scheduled job or an automated agent, and never without `--remote`/`--local` chosen on purpose.
- Self-service resets need no ops log entry (the audit row is the record). An admin clear always gets one.
- Audit rows to look for with recovery codes: `owner.recovery_issued` (system, with the reason), `owner.recovery_used`, `owner.passkey_enrolled` with `via: recovery`, and `owner.recovery_failed` (several in a row from one place: someone is guessing; the route stops after five per IP, and a code has 80 random bits, but tell Harsh).
- Audit rows to look for: `owner.pin_reset` (the owner, self-service), `owner.pin_cleared_by_admin` (system, with the reason), then `owner.pin_set` when she sets the new one.
- A "PIN was changed" email nobody expected, or several resets in a short time, means someone else may have her email: follow the [incident runbook](incident.md), sign out other devices, and secure the email account first. The email account is the key to the owner account.
