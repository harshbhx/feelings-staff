/**
 * Security headers on every Worker response (PRD 10.5). `upgrade-insecure-requests` is left out on
 * purpose: every source is 'self', HSTS already forces HTTPS, and WebKit applies the upgrade to
 * http://localhost, which breaks the CI E2E run. Static assets get the same set from
 * public/_headers; a test keeps the two in sync.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Permissions-Policy':
    'geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), bluetooth=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function withSecurityHeaders(res: Response, requestId?: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (requestId) out.headers.set('X-Request-Id', requestId);
  return out;
}
