/** Email through Cloudflare Email Service, Resend fallback, outbox in preview (ADR-09). Owner: WP-8. */
import type { EmailSender } from './ports';

export function createEmailSender(): EmailSender {
  return {
    async send() {
      throw new Error('EmailSender not implemented yet (WP-8)');
    },
  };
}
