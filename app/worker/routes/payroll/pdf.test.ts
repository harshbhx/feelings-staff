/** WP-5 payslip PDFs (PRD 4.14; O-14.1, O-14.4, O-13.4): rendering after finalise, retries, fallback, watermark. */
import type { PayrollRunView } from '@fs/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfRenderer } from '../../services/ports';
import { setServiceOverridesForTests } from '../../services/registry';
import { fakeNotifier, fakePdf } from '../../test/fakes';
import {
  call,
  callJson,
  e2eHeaders,
  resetScenario,
  type Scenario,
  testEnv,
} from '../../test/helpers';
import { setClock } from '../auth/test/kit';
import {
  addPerson,
  fillMonth,
  login,
  monthIsOver,
  NOV_2,
  noHolidays,
  type Person,
  stepUpLogin,
  sundayRoster,
} from './test/kit';

let s: Scenario;
let owner: string;
let priya: Person;

async function finalise(): Promise<string> {
  const run = await callJson<PayrollRunView>('POST', '/owner/payroll-runs', {
    cookie: owner,
    body: { month: '2026-10' },
  });
  const id = run.body.run.id;
  const done = await call('POST', `/owner/payroll-runs/${id}/finalise`, {
    cookie: await stepUpLogin(s.ownerId),
    body: { acceptDefaults: true },
  });
  expect(done.status).toBe(200);
  return id;
}

const slip = () =>
  testEnv.DB.prepare('SELECT id, pdf_status, pdf_key FROM payslips WHERE user_id = ?1')
    .bind(priya.id)
    .first<{ id: string; pdf_status: string; pdf_key: string | null }>();

/** A renderer that fails the first `failures` calls. */
function flaky(failures: number): PdfRenderer & { calls: number } {
  const inner = fakePdf();
  const r = {
    calls: 0,
    async render(...args: Parameters<PdfRenderer['render']>) {
      r.calls += 1;
      if (r.calls <= failures) throw new Error('Browser Run unavailable');
      return inner.render(...args);
    },
  };
  return r;
}

beforeEach(async () => {
  s = await resetScenario('basic-salon');
  owner = await login(s.ownerId);
  await noHolidays();
  priya = await addPerson(owner, { name: 'Priya Solanki' });
  await sundayRoster(priya.id, '2026-10');
  await fillMonth(priya.id, '2026-10');
  await monthIsOver();
});

afterEach(async () => {
  setServiceOverridesForTests(null);
  await setClock(null);
});

describe('O-14.1 a PDF per payslip after finalising', () => {
  it('O-14.1 renders through the PdfRenderer port and stores it at the R2 path', async () => {
    const pdf = fakePdf();
    setServiceOverridesForTests({ pdf });
    const runId = await finalise();
    await vi.waitFor(async () => expect((await slip())?.pdf_status).toBe('ready'));
    const row = await slip();
    expect(pdf.renders).toEqual(['payslip']);
    expect(row?.pdf_key).toMatch(new RegExp(`^payslips/[0-9A-Z]{26}/2026-10/${row?.id}-r1\\.pdf$`));
    const stored = await testEnv.MEDIA.get(row?.pdf_key ?? '');
    expect(await stored?.text()).toBe('%PDF-1.4 fake');
    expect(stored?.customMetadata?.['x-sha256']).toMatch(/^[0-9a-f]{64}$/);
    const res = await call('GET', `/payslips/${row?.id}/pdf`, { cookie: owner });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(runId).toBeTruthy();
  });
});

describe('O-14.4 retries and the HTML fallback', () => {
  it('O-14.4 retries after 1, 5 and 30 minutes, then serves the printable page', async () => {
    const renderer = flaky(99);
    const notifier = fakeNotifier();
    setServiceOverridesForTests({ pdf: renderer, notifier });
    await finalise();
    await vi.waitFor(async () => expect(renderer.calls).toBe(1));
    expect((await slip())?.pdf_status).toBe('pending');
    // the five-minute job retries after 1, 5 and 30 minutes
    let now = NOV_2;
    for (const minutes of [1, 5, 30]) {
      now += minutes * 60_000 + 1000;
      await setClock(now);
      const row = await slip();
      expect(row?.pdf_status).toBe('pending');
      await sweepWith(now);
    }
    expect((await slip())?.pdf_status).toBe('failed');
    expect(renderer.calls).toBe(4);
    expect(notifier.events.filter((e) => e.type === 'payslip_pdf_failed')).toHaveLength(1);
    const staff = await login(priya.id);
    const page = await call('GET', `/payslips/${(await slip())?.id}/pdf`, { cookie: staff });
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toMatch(/^text\/html/);
    const html = await page.text();
    expect(html).toContain('Print or save as PDF');
    expect(html).toContain('Salary slip');
    const audit = await testEnv.DB.prepare(
      "SELECT action FROM audit_log WHERE action = 'payslip.pdf_failed'",
    ).all();
    expect(audit.results).toHaveLength(1);
  });

  it('O-14.4 a retry that works makes the PDF ready', async () => {
    const renderer = flaky(1);
    setServiceOverridesForTests({ pdf: renderer });
    await finalise();
    await vi.waitFor(async () => expect(renderer.calls).toBe(1));
    await sweepWith(NOV_2 + 61_000);
    expect((await slip())?.pdf_status).toBe('ready');
  });
});

describe('O-13.4 reopen keeps revision 1 as superseded with a watermark', () => {
  it('O-13.4 renders the old payslip again with "Replaced by revision 2"', async () => {
    const seen: unknown[] = [];
    const inner = fakePdf();
    setServiceOverridesForTests({
      pdf: {
        async render(t, data, lang) {
          seen.push(data);
          return inner.render(t, data, lang);
        },
      },
    });
    const runId = await finalise();
    await vi.waitFor(async () => expect((await slip())?.pdf_status).toBe('ready'));
    const reopened = await call('POST', `/owner/payroll-runs/${runId}/reopen`, {
      cookie: await stepUpLogin(s.ownerId),
      body: { reason: 'Missed an incentive', settleMode: 'reissue' },
    });
    expect(reopened.status).toBe(200);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect((seen[1] as { watermark: string }).watermark).toBe('Replaced by revision 2');
    expect((seen[0] as { watermark: string | null }).watermark).toBeNull();
  });
});

/** Run the sweep as the worker would, with the request clock at `at`. */
async function sweepWith(at: number): Promise<void> {
  await setClock(at);
  const res = await call('POST', '/__test/cron', {
    headers: e2eHeaders(),
    body: { job: 'rules', at },
  });
  expect(res.status).toBe(200);
}
