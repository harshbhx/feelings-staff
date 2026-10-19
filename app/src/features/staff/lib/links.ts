/** Human fallbacks (PRD 2.3): call or WhatsApp the owner with the context prefilled. */

/** `https://wa.me/918000661578?text=...` for an E.164 Indian number. */
export function whatsappLink(phoneE164: string, text?: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function telLink(phoneE164: string): string {
  return `tel:${phoneE164.replace(/[^\d+]/g, '')}`;
}
