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

If 15 minutes pass, or she already used the window, the server refuses ("Enter your current PIN. Forgot it? Sign in again with a code from your email, then set a new one.") and she starts again at step 1. The server decides from the session alone (`sessions.pin_reset_until`, set only by an email sign-in), never from anything the browser sends. If the email does not arrive, see [the owner cannot sign in](troubleshooting.md#the-owner-cannot-sign-in).

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
| `--clear-pin` | The action (exactly one). `--issue-code` comes with [recovery codes](#lost-every-device-recovery-code). |
| `--database <name>` | D1 database name: `fbc-staff` (production) or `fbc-staff-preview`. Required. |
| `--remote` or `--local` | Which copy. One of them is required, so a command never hits production by default. |
| `--config <file>` | Wrangler config, relative to where you run the command (`app/wrangler.jsonc`, `app/wrangler.preview-migrations.jsonc`). Optional. |
| `--env <name>` | Wrangler environment. Optional. |
| `--email <address>` | Which owner, when the database has more than one. |
| `--reason "<text>"` | Written to the audit row (200 characters at most). Default "Owner forgot the PIN". |
| `--yes` | Do it. Without it nothing is written. |

It never prints a PIN, a hash, a salt or a token, and it masks the owner email (`u***@feelingsbeautycare.in`). The SQL lives in `scripts/owner-recovery-sql.mjs`; the Workers tests (`app/worker/routes/auth/pin-reset.test.ts`) run the same statements against the real schema.

## Lost every device: recovery code

Not built yet. It comes with owner access slice 7 part B, after the passkey core: `--issue-code` issues a one-time code (shown once, stored hashed, 24 hours, audited as `owner.recovery_issued`), and "I lost my phone" on the owner host accepts it. Until the owner host cutover the owner signs in by email, so this case cannot happen yet. The [cutover runbook](owner-cutover.md) requires it to be tested once before the old owner routes are closed.

## Ops notes

- A person runs the script, after a dry run, at the owner's request. Never from CI, a scheduled job or an automated agent, and never without `--remote`/`--local` chosen on purpose.
- Self-service resets need no ops log entry (the audit row is the record). An admin clear always gets one.
- Audit rows to look for: `owner.pin_reset` (the owner, self-service), `owner.pin_cleared_by_admin` (system, with the reason), then `owner.pin_set` when she sets the new one.
- A "PIN was changed" email nobody expected, or several resets in a short time, means someone else may have her email: follow the [incident runbook](incident.md), sign out other devices, and secure the email account first. The email account is the key to the owner account.
