/**
 * Wires every port to its implementation (WP-1, shared; packages edit their own files, not this one).
 */
import type { Env } from '../env';
import { createAudit } from './audit';
import { createClock } from './clock';
import { createDayService } from './day';
import { createEmailSender } from './email';
import { createMapsResolver } from './maps';
import { createNotifier } from './notifier';
import { createOutbox } from './outbox';
import { createPayrollService } from './payroll';
import { createPdfRenderer } from './pdf';
import type { Services } from './ports';
import { createPushSender } from './push';
import { createStepUp } from './stepup';

export async function createServices(env: Env): Promise<Services> {
  return {
    clock: await createClock(env),
    audit: createAudit(),
    notifier: createNotifier(),
    stepUp: createStepUp(),
    days: createDayService(),
    payroll: createPayrollService(),
    pdf: createPdfRenderer(),
    push: createPushSender(),
    email: createEmailSender(),
    maps: createMapsResolver(),
    outbox: createOutbox(),
  };
}
