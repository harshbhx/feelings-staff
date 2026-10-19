/**
 * Email through Cloudflare Email Service, Resend fallback, outbox in preview (ADR-09). Owner: WP-8.
 * Until WP-8 lands: EMAIL_PROVIDER=outbox records the message in the preview outbox; anything else
 * refuses to send.
 */
import { fail } from '../lib/errors';
import type { EmailSender } from './ports';

export function createEmailSender(): EmailSender {
  return {
    async send(ctx, msg) {
      if (ctx.env.EMAIL_PROVIDER === 'outbox') {
        await ctx.services.outbox.record(ctx, 'email', msg.to, msg);
        return;
      }
      fail('UNAVAILABLE', 'Email is not set up yet.');
    },
  };
}
