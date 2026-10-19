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
import type { DayResult, NotifyEvent, PayrollRunView } from '@fs/contracts';
import type {
  DayService,
  EmailMessage,
  EmailSender,
  MapsResolver,
  Notifier,
  PayrollService,
  PdfRenderer,
  PushSender,
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

export function fakePush(status = 201): PushSender & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    async send(sub, payload) {
      sent.push({ sub, payload });
      return status < 300
        ? { ok: true, status }
        : { ok: false, status, gone: status === 404 || status === 410 };
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
