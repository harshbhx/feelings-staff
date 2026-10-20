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

/**
 * Owner and staff notice emails (PRD 6: N24 payroll ready, N25 payslip ready, N30 weekly digest).
 * Plain text first, simple HTML second: title, detail lines, a link into the app and a footer.
 */
export function noticeEmail(
  t: T,
  to: string,
  n: { title: string; body: string | null; lines?: string[]; url: string; footer: string },
): EmailMessage {
  const lines = n.lines ?? [];
  const open = t('email.notice.open', { url: n.url });
  const text = [n.title, n.body ?? '', '', ...lines, '', open, '', n.footer]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1e1214;background:#ffffff">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${escapeHtml(n.title)}</h1>
${n.body ? `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(n.body)}</p>` : ''}
${lines.length ? `<ul style="font-size:16px;line-height:1.6;margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
<p style="margin:0 0 16px"><a href="${escapeHtml(n.url)}" style="display:inline-block;padding:12px 20px;background:#b3121b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(t('email.notice.button'))}</a></p>
<p style="font-size:14px;color:#5c0a14;margin:0">${escapeHtml(n.footer)}</p>
</body></html>`;
  return { to, subject: n.title, text, html };
}
