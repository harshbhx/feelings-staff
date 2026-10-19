/** Web Push sender with @pushforge/builder (ADR-08). Owner: WP-8. Stub until it lands. */
import type { PushSender } from './ports';

export function createPushSender(): PushSender {
  return {
    async send() {
      return { ok: false, status: 501, gone: false };
    },
  };
}
