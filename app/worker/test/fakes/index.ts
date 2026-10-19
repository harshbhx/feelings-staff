/**
 * Fakes for every port (PRD 16.3), so packages test without each other. The implementing package
 * owns and may refine its fake. Usage in a Workers API test:
 *
 *   const notifier = fakeNotifier();
 *   setServiceOverridesForTests({ notifier });
 *   ... call the API ...
 *   expect(notifier.events.map((e) => e.type)).toContain('new_device');
 *   setServiceOverridesForTests(null);
 */
import type { DayResult, NotifyEvent, PayrollRunView, PushPayload } from '@fs/contracts';
import type {
  DayService,
  EmailMessage,
  EmailSender,
  MapsResolver,
  Notifier,
  PayrollService,
  PdfRenderer,
  PushOpts,
  PushSender,
  PushSub,
} from '../../services/ports';

export function fakeNotifier(): Notifier & { events: NotifyEvent[] } {
  const events: NotifyEvent[] = [];
  return {
    events,
    async emit(_ctx, e) {
      events.push(e);
    },
  };
}

export function fakeEmail(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(_ctx, msg) {
      sent.push(msg);
    },
  };
}

/**
 * Push sender that records every call (with its Urgency/TTL/Topic options). `status` is the answer
 * to every send; pass a list to answer call by call (the last one repeats), e.g. `[429, 201]`.
 */
export function fakePush(
  status: number | number[] = 201,
): PushSender & { sent: { sub: PushSub; payload: PushPayload; opts: PushOpts }[] } {
  const sent: { sub: PushSub; payload: PushPayload; opts: PushOpts }[] = [];
  const answers = Array.isArray(status) ? status : [status];
  return {
    sent,
    async send(sub, payload, opts) {
      sent.push({ sub, payload, opts });
      const code = answers[Math.min(sent.length - 1, answers.length - 1)] ?? 201;
      return code < 300
        ? { ok: true, status: code }
        : {
            ok: false,
            status: code,
            gone: code === 404 || code === 410,
            ...(code === 429 ? { retryAfterSec: 0 } : {}),
          };
    },
  };
}

/** DayService that records calls and returns the given result (or a minimal OPEN day). */
export function fakeDayService(
  result?: Partial<DayResult>,
): DayService & { calls: [string, string][] } {
  const calls: [string, string][] = [];
  return {
    calls,
    async recompute(_ctx, userId, date) {
      calls.push([userId, date]);
      return {
        version: 'fake',
        userId,
        workDate: date,
        dayType: 'work',
        templateId: null,
        scheduledMin: 540,
        workedMin: 0,
        breakMin: 0,
        lateMin: 0,
        lateBillableMin: 0,
        earlyMin: 0,
        earlyBillableMin: 0,
        overbreakMin: 0,
        makeupMin: 0,
        undertimeMin: 0,
        otPreapprovedMin: 0,
        otCandidateMin: 0,
        status: 'OPEN',
        leaveCode: null,
        offdayCredit: 0,
        offdayOtMin: 0,
        tags: [],
        firstInTs: null,
        lastOutTs: null,
        open: true,
        ...result,
      };
    },
  };
}

export function fakePayroll(view: PayrollRunView): PayrollService {
  return { draft: async () => view, recompute: async () => view, finalise: async () => view };
}

export function fakeMaps(
  point = { lat: 22.4606479, lng: 70.0565093, label: 'Feelings Beauty Care' },
): MapsResolver {
  return { resolve: async () => point };
}

export function fakePdf(): PdfRenderer & { renders: string[] } {
  const renders: string[] = [];
  return {
    renders,
    async render(template) {
      renders.push(template);
      return new TextEncoder().encode('%PDF-1.4 fake').buffer as ArrayBuffer;
    },
  };
}
