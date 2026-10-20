/**
 * Presence and roll-call routes (WP-9, P1, PRD 9.4). Handlers are thin; presence.ts and rollcall.ts
 * own the rules and the audit rows. Staff routes never return credits, minutes of credit or rupees.
 */
import type { Handlers } from '../../lib/api';
import {
  awayDecide,
  awayList,
  awayNote,
  awayPatch,
  imBack,
  mePresence,
  mePresenceHistory,
  presenceCheck,
  presenceDay,
  stepOut,
} from '../../services/presence';
import { rollCallDay, rollCallSubmit, rollCallView } from '../../services/rollcall';

export const handlers: Handlers = {
  // Staff
  mePresence: (_i, ctx) => mePresence(ctx),
  presenceStepOut: ({ body }, ctx) => stepOut(ctx, body),
  presenceBack: ({ body }, ctx) => imBack(ctx, body),
  mePresenceAwayNote: ({ params, body }, ctx) => awayNote(ctx, params.id, body),
  presenceCheck: ({ body }, ctx) => presenceCheck(ctx, body),
  mePresenceHistory: ({ query }, ctx) => mePresenceHistory(ctx, query),

  // Roll-calls, away edits and the day view: owner and managers with `rollcall`. The away list and
  // decisions (confirm, work, ignore) are owner only.
  ownerRollCalls: ({ query }, ctx) => rollCallDay(ctx, query),
  ownerRollCallGet: ({ params }, ctx) => rollCallView(ctx, params.id),
  ownerRollCallSubmit: ({ params, body }, ctx) => rollCallSubmit(ctx, params.id, body),
  ownerAwayList: ({ query }, ctx) => awayList(ctx, query),
  ownerAwayPatch: ({ params, body }, ctx) => awayPatch(ctx, params.id, body),
  ownerAwayDecide: ({ params, body }, ctx) => awayDecide(ctx, params.id, body),
  ownerPresenceDay: ({ params }, ctx) => presenceDay(ctx, params.userId, params.date),
};
