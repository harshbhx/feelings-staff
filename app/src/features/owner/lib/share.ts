/**
 * Sharing from the owner's phone (PRD 4.1.2 invite, 4.14 payslip): the Web Share API first
 * (with a file when the browser can share files), then a `wa.me` link, then Copy.
 */
import { formatIndianPhone } from '@fs/contracts';

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

export function canShare(data?: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (data && typeof navigator.canShare === 'function') return navigator.canShare(data);
  return true;
}

/** Open the system share sheet. Cancelling is not an error. */
export async function shareNative(data: ShareData): Promise<ShareOutcome> {
  if (!canShare(data)) return 'unsupported';
  try {
    await navigator.share(data);
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

/** Copy text; falls back to a hidden textarea where the async clipboard is not allowed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

/** `+919825011201` -> `919825011201` for wa.me. */
export function waNumber(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** WhatsApp chat link, with optional prefilled text. */
export function waLink(e164: string, text?: string): string {
  const base = `https://wa.me/${waNumber(e164)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** `tel:` link. */
export function telLink(e164: string): string {
  return `tel:${e164}`;
}

/** `98250 11201` for display. */
export function phoneLabel(e164: string): string {
  return formatIndianPhone(e164);
}

/** Wrap a downloaded blob (payslip PDF from `api.payslipPdf`) as a File for Web Share Level 2. */
export function asFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || 'application/pdf' });
}
