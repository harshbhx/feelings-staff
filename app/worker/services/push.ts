/**
 * Web Push sender with @pushforge/builder and VAPID (ADR-08). Owner: WP-8.
 * In preview and local nothing leaves the Worker: the Notifier records every push in the outbox
 * and this sender reports success. 404/410 mean the subscription is gone; 413 and 429 are handled
 * by the Notifier (shorter payload, one retry after Retry-After).
 */
import { buildPushHTTPRequest } from '@pushforge/builder';
import type { Env } from '../env';
import { isNonProd } from '../env';
import type { PushOutcome, PushSender } from './ports';

const SEND_TIMEOUT_MS = 8000;

function parseJwk(raw: string): JsonWebKey | null {
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

export function createPushSender(env?: Env): PushSender {
  return {
    async send(sub, payload, opts): Promise<PushOutcome> {
      if (!env) return { ok: false, status: 501, gone: false };
      if (isNonProd(env)) return { ok: true, status: 201 };
      const jwk = parseJwk(env.VAPID_PRIVATE_JWK);
      if (!jwk) return { ok: false, status: 500, gone: false };

      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK: jwk,
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message: {
          payload,
          adminContact: env.VAPID_SUBJECT,
          options: {
            ttl: opts.ttlSec,
            urgency: opts.urgency,
            ...(opts.topic ? { topic: opts.topic } : {}),
          },
        },
      });
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, status: 0, gone: false };
      }
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
      const retryAfter = Number(res.headers.get('Retry-After'));
      return {
        ok: false,
        status: res.status,
        gone: res.status === 404 || res.status === 410,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSec: retryAfter } : {}),
      };
    },
  };
}
