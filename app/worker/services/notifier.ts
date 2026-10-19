/**
 * Notifier (PRD 6): inbox rows, recipients, prefs, batching, topics, quiet hours. Owner: WP-8.
 * Stub until WP-8 lands: events are dropped (logged in preview/local).
 */
import { isNonProd } from '../env';
import type { Notifier } from './ports';

export function createNotifier(): Notifier {
  return {
    async emit(ctx, e) {
      if (isNonProd(ctx.env))
        console.info(
          JSON.stringify({ msg: 'notify.stub', type: e.type, requestId: ctx.requestId }),
        );
    },
  };
}
