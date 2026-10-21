/**
 * Forgotten owner PIN (docs/owner-access.md, Passkeys flow 6; PRD 4.1.7). Owner: WP-3.
 *
 * A fresh sign-in (the 6-digit code or the magic link; on the owner host a passkey sign-in or the
 * first-device enrolment) lets the owner set a new PIN without the old one for 15 minutes, once.
 * The window lives on the session row (`sessions.pin_reset_until`, like `step_up_until`): the
 * sign-in route opens it from the session's own `created_at`, and any PIN set or change in that
 * session closes it. The client never opens it.
 * A password sign-in never opens it, or the password alone would replace the PIN. Staff PINs are
 * not touched here.
 */
import { istDate, istTime } from '@fs/contracts';
import { ownerOrigin } from '../lib/hosts';
import type { Ctx } from './ports';

/** Same window as the first owner PIN. */
export const PIN_RESET_WINDOW_MS = 15 * 60_000;

/**
 * Open the window on a session that just signed in by email or with a passkey. Call it right after
 * the session is issued; never after a password sign-in.
 */
export async function openPinResetWindow(ctx: Ctx, tokenHash: string): Promise<void> {
  await ctx.db.run(
    'UPDATE sessions SET pin_reset_until = created_at + ? WHERE org_id = ?org AND token_hash = ?',
    PIN_RESET_WINDOW_MS,
    tokenHash,
  );
}

/** Statement that closes the window of one session (after any PIN set or change in it). */
export function closePinResetWindowStmt(ctx: Ctx, tokenHash: string): D1PreparedStatement {
  return ctx.db.stmt(
    'UPDATE sessions SET pin_reset_until = NULL WHERE org_id = ?org AND token_hash = ?',
    tokenHash,
  );
}

/**
 * Until when the current session may set a new owner PIN without the current one, or null when the
 * window is closed (no PIN yet, no fresh email sign-in, older than 15 minutes, or already used).
 */
export async function pinResetUntil(
  ctx: Ctx,
  owner: { id: string; pin_hash: string | null },
): Promise<number | null> {
  const session = ctx.session;
  if (!owner.pin_hash || !session || session.kind !== 'user' || session.userId !== owner.id)
    return null;
  const row = await ctx.db.first<{ pin_reset_until: number | null }>(
    `SELECT pin_reset_until FROM sessions
      WHERE org_id = ?org AND token_hash = ? AND user_id = ? AND revoked_at IS NULL`,
    session.tokenHash,
    owner.id,
  );
  const until = row?.pin_reset_until ?? null;
  return until !== null && until > ctx.now() ? until : null;
}

/** "Your PIN was changed" to the owner address, after a reset. */
export function pinChangedEmail(opts: { origin: string; name: string; at: number }): {
  subject: string;
  text: string;
} {
  const first = opts.name.trim().split(/\s+/)[0] ?? opts.name;
  return {
    subject: 'Your Feelings Staff owner PIN was changed',
    text: [
      `Hi ${first},`,
      '',
      `Your owner PIN was changed on ${istDate(opts.at)} at ${istTime(opts.at)} (India time) in Settings, Security, after a new sign-in. Every other phone and computer signed in as you was signed out.`,
      '',
      'If this was you, there is nothing to do.',
      `If it was not you, sign in now at ${opts.origin}/auth/owner with a code from this email, set a new PIN in Settings, Security, and keep this email account safe: it is the key to the owner account.`,
    ].join('\n'),
  };
}

/** Send the notice; a mail failure is logged and never undoes the reset. */
export async function sendPinChangedEmail(
  ctx: Ctx,
  owner: { email: string | null; name: string },
): Promise<void> {
  if (!owner.email) return;
  const mail = pinChangedEmail({ origin: ownerOrigin(ctx.env), name: owner.name, at: ctx.now() });
  try {
    await ctx.services.email.send(ctx, { to: owner.email, subject: mail.subject, text: mail.text });
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: 'auth.pin_reset_email_failed',
        requestId: ctx.requestId,
        provider: ctx.env.EMAIL_PROVIDER,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
