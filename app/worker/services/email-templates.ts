/** Email bodies (PRD 6 N30, N31). Plain text first, simple HTML second. Owner: WP-8. */

import type { T } from './notifier-plan';
import type { EmailMessage } from './ports';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** N31: "Your Feelings Staff sign-in code: 482913", link and code, valid 15 minutes. */
export function signInEmail(t: T, to: string, url: string, code: string): EmailMessage {
  const subject = t('email.signin.subject', { code });
  const text = [
    t('email.signin.intro'),
    '',
    t('email.signin.code', { code }),
    t('email.signin.link', { url }),
    '',
    t('email.signin.valid'),
    t('email.signin.ignore'),
  ].join('\n');
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1e1214;background:#ffffff">
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(t('email.signin.intro'))}</p>
<p style="font-size:28px;font-weight:800;letter-spacing:4px;margin:0 0 16px">${escapeHtml(code)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#b3121b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(t('email.signin.button'))}</a></p>
<p style="font-size:14px;line-height:1.5;color:#5c0a14;margin:0 0 8px">${escapeHtml(t('email.signin.valid'))}</p>
<p style="font-size:14px;line-height:1.5;color:#5c0a14;margin:0">${escapeHtml(t('email.signin.ignore'))}</p>
</body></html>`;
  return { to, subject, text, html };
}

/** N30 weekly digest (P1). */
export function digestEmail(t: T, to: string, title: string, body: string | null): EmailMessage {
  const footer = t('email.digest.footer');
  const text = [title, body ?? '', '', footer].join('\n').trim();
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1e1214;background:#ffffff">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${escapeHtml(title)}</h1>
${body ? `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(body)}</p>` : ''}
<p style="font-size:14px;color:#5c0a14;margin:0">${escapeHtml(footer)}</p>
</body></html>`;
  return { to, subject: title, text, html };
}
