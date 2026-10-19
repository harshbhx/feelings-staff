/**
 * WhatsApp Cloud API utility templates to the owner (P1, PRD 6, needs the Meta setup of Q15).
 * Behind a flag: nothing is sent unless `notifications.whatsappFallback` is on and the credentials
 * exist. In preview and local the message is recorded in the outbox instead. Owner: WP-8.
 */
import { isNonProd } from '../env';
import type { Ctx } from './ports';

export interface WhatsAppTemplate {
  /** Approved template name (utility category). */
  template: string;
  lang: 'en' | 'gu';
  params: string[];
}

export type WhatsAppResult = 'sent' | 'recorded' | 'skipped' | 'failed';

export async function sendWhatsApp(
  ctx: Ctx,
  toE164: string,
  msg: WhatsAppTemplate,
): Promise<WhatsAppResult> {
  if (isNonProd(ctx.env)) {
    await ctx.services.outbox.record(ctx, 'whatsapp', toE164, msg);
    return 'recorded';
  }
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId } = ctx.env;
  if (!token || !phoneId) return 'skipped';
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toE164.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: msg.template,
          language: { code: msg.lang === 'gu' ? 'gu' : 'en' },
          components: [
            { type: 'body', parameters: msg.params.map((text) => ({ type: 'text', text })) },
          ],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
