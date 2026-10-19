/**
 * Wires every port to its implementation (WP-1, shared; packages edit their own files, not this one).
 * Tests can swap ports with `setServiceOverridesForTests` (ignored in production).
 */
import type { Env } from '../env';
import { isNonProd } from '../env';
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

let overrides: Partial<Services> | null = null;

/** Replace ports for the following requests (Workers API tests only). Pass null to restore. */
export function setServiceOverridesForTests(o: Partial<Services> | null): void {
  overrides = o;
}

export async function createServices(env: Env): Promise<Services> {
  const services: Services = {
    clock: await createClock(env),
    audit: createAudit(),
    notifier: createNotifier(),
    stepUp: createStepUp(),
    days: createDayService(),
    payroll: createPayrollService(),
    pdf: createPdfRenderer(env),
    push: createPushSender(env),
    email: createEmailSender(),
    maps: createMapsResolver(),
    outbox: createOutbox(),
  };
  return overrides && isNonProd(env) ? { ...services, ...overrides } : services;
}
