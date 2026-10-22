/**
 * Static error pages written by the Worker (no JavaScript, no files to fetch, so they work when the
 * asset layer or the database does not). Brand colours are the website's tokens
 * (packages/ui/src/styles/tokens.css); English only. The inline style is allowed by the CSP.
 */

interface Page {
  title: string;
  heading: string;
  body: string;
  /** A way back; omitted where a link would only lead to another failure. */
  link?: { href: string; label: string };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function render(p: Page): string {
  const link = p.link
    ? `<p><a href="${escapeHtml(p.link.href)}">${escapeHtml(p.link.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(p.title)}</title><style>
html{background:#fff7f6}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#4b3b3e;line-height:1.55;font-size:17px}
main{max-width:24rem}
h1{margin:0 0 12px;font-size:1.75rem;line-height:1.15;font-weight:800;color:#1e1214}
h1::after{content:"";display:inline-block;width:.17em;height:.17em;margin-left:.06em;border-radius:50%;background:#b3121b}
p{margin:0 0 16px}
a{display:inline-flex;align-items:center;min-height:48px;padding:0 28px;border-radius:999px;background:#b3121b;color:#fff;font-weight:700;text-decoration:none}
a:hover{background:#8f0e16}
a:focus-visible{outline:3px solid #b3121b;outline-offset:3px}
@media (min-width:640px){main{text-align:center}}
</style></head><body><main><h1>${escapeHtml(p.heading)}</h1><p>${escapeHtml(p.body)}</p>${link}</main></body></html>`;
}

const NOT_FOUND = render({
  title: "That page isn't here",
  heading: "That page isn't here",
  body: 'The link may be old, or a letter got lost on the way. Nothing is wrong with your account.',
  link: { href: '/', label: 'Back to Feelings' },
});

/** A real 404 for an address that is not part of the app. HEAD gets the headers only. */
export function notFoundPage(method = 'GET'): Response {
  return new Response(method === 'HEAD' ? null : NOT_FOUND, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
