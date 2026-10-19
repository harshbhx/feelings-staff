/**
 * Email through Cloudflare Email Service, Resend fallback, outbox in preview (ADR-09). Owner: WP-8.
 * `EMAIL_PROVIDER` picks the route: `cloudflare` (the `EMAIL` send_email binding), `resend`, or
 * `outbox` (record in the preview outbox, send nothing).
 */
import { fail } from '../lib/errors';
import type { EmailMessage, EmailSender } from './ports';

/** `Name <a@b.c>` or `a@b.c` to its parts. */
export function parseFrom(from: string): { name: string | null; address: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] ? (m[1] as string) : null, address: m[2] as string };
  return { name: null, address: from.trim() };
}

export function createEmailSender(): EmailSender {
  return {
    async send(ctx, msg: EmailMessage) {
      const provider = ctx.env.EMAIL_PROVIDER;
      if (provider === 'outbox') {
        await ctx.services.outbox.record(ctx, 'email', msg.to, msg);
        return;
      }
      if (provider === 'resend') {
        const key = ctx.env.RESEND_API_KEY;
        if (!key) fail('UNAVAILABLE', 'Email is not set up yet.');
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: ctx.env.EMAIL_FROM,
            to: [msg.to],
            subject: msg.subject,
            text: msg.text,
            ...(msg.html ? { html: msg.html } : {}),
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) fail('UNAVAILABLE', 'Email could not be sent right now.');
        return;
      }
      const binding = ctx.env.EMAIL;
      if (!binding) fail('UNAVAILABLE', 'Email is not set up yet.');
      const from = parseFrom(ctx.env.EMAIL_FROM);
      await binding.send({
        to: msg.to,
        from: from.name ? { email: from.address, name: from.name } : from.address,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      });
    },
  };
}
