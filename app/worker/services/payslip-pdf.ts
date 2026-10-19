/**
 * Payslip PDFs (PRD 4.14): rendered after finalise through the PdfRenderer port and stored in R2 at
 * `payslips/<org>/<yyyy-mm>/<payslipId>-r<rev>.pdf`. A failure is retried after 1, 5 and 30 minutes
 * (state in app_meta, swept by `sweepPayslipPdfs`); after that the payslip is `failed` and the
 * download answers with the printable HTML page. A payslip of a replaced revision is rendered again
 * with the "Replaced by revision N" watermark. Owner: WP-5.
 */
import { json } from '../db';
import { sha256Hex } from '../lib/crypto';
import { fail } from '../lib/errors';
import type { RunRow } from './payroll-calc';
import { type PayslipRow, payslipRow, payslipView, runOfPayslip, staffMaySee } from './payslip';
import { renderHtml } from './pdf';
import type { Ctx } from './ports';

const RETRY_DELAYS_MIN = [1, 5, 30];

interface RetryState {
  attempts: number;
  nextAt: number;
}

const retryKey = (payslipId: string) => `pdf_retry:${payslipId}`;
export const pdfKey = (orgId: string, run: RunRow, payslipId: string) =>
  `payslips/${orgId}/${run.month}/${payslipId}-r${run.revision}.pdf`;

async function retryState(ctx: Ctx, payslipId: string): Promise<RetryState | null> {
  const row = await ctx.sys.first<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?1',
    retryKey(payslipId),
  );
  return row ? json<RetryState | null>(row.value, null) : null;
}

const watermarkFor = (run: RunRow) =>
  run.status === 'superseded' ? `Replaced by revision ${run.revision + 1}` : null;

/** Render one payslip and store it; the row becomes `ready`. Throws when rendering fails. */
export async function renderPayslipPdf(ctx: Ctx, row: PayslipRow, run: RunRow): Promise<void> {
  const view = payslipView(ctx, row, run);
  const bytes = await ctx.services.pdf.render(
    'payslip',
    { view, watermark: watermarkFor(run) },
    'en',
  );
  const key = pdfKey(ctx.orgId ?? '', run, row.id);
  await ctx.env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: {
      'x-org-id': ctx.orgId ?? '',
      'x-sha256': await sha256Hex(new Uint8Array(bytes)),
    },
  });
  await ctx.db.batch([
    ctx.db.update('payslips', { pdf_key: key, pdf_status: 'ready' }, 'id = ?', row.id),
    ctx.db.stmt('DELETE FROM app_meta WHERE key = ?', retryKey(row.id)),
  ]);
}

/** One attempt with the retry bookkeeping; never throws. */
async function attempt(ctx: Ctx, row: PayslipRow): Promise<void> {
  const run = await runOfPayslip(ctx, row);
  try {
    await renderPayslipPdf(ctx, row, run);
  } catch (e) {
    const attempts = ((await retryState(ctx, row.id))?.attempts ?? 0) + 1;
    console.error(
      JSON.stringify({ msg: 'payslip.pdf_failed', payslipId: row.id, attempts, error: String(e) }),
    );
    const delay = RETRY_DELAYS_MIN[attempts - 1];
    if (delay === undefined) {
      await ctx.db.batch([
        ctx.db.update('payslips', { pdf_status: 'failed' }, 'id = ?', row.id),
        ctx.db.stmt('DELETE FROM app_meta WHERE key = ?', retryKey(row.id)),
        ctx.services.audit.stmt(ctx, {
          category: 'change',
          action: 'payslip.pdf_failed',
          entity: 'payslip',
          entityId: row.id,
          actorType: 'system',
          actorId: null,
          reason: 'Browser Run failed after the last retry; the online slip is shown instead.',
        }),
      ]);
      await ctx.services.notifier.emit(ctx, {
        type: 'payslip_pdf_failed',
        orgId: ctx.orgId ?? '',
        at: ctx.now(),
        runId: run.id,
        month: run.month,
        failedCount: 1,
      });
      return;
    }
    const state: RetryState = { attempts, nextAt: ctx.now() + delay * 60_000 };
    await ctx.db.run(
      'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
      retryKey(row.id),
      JSON.stringify(state),
    );
  }
}

/** First attempt for every pending payslip of a run (called with waitUntil after finalise or reopen). */
export async function generateRunPdfs(ctx: Ctx, runId: string): Promise<void> {
  const rows = await ctx.db.all<PayslipRow>(
    "SELECT * FROM payslips WHERE org_id = ?org AND payroll_run_id = ? AND pdf_status = 'pending' ORDER BY created_at, id",
    runId,
  );
  for (const row of rows) await attempt(ctx, row);
}

/** Retry what is pending and due; for the scheduled job to call every few minutes. */
export async function sweepPayslipPdfs(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.all<PayslipRow>(
    "SELECT * FROM payslips WHERE org_id = ?org AND pdf_status = 'pending' ORDER BY created_at, id LIMIT 50",
  );
  let done = 0;
  for (const row of rows) {
    const state = await retryState(ctx, row.id);
    if (state && state.nextAt > ctx.now()) continue;
    await attempt(ctx, row);
    done += 1;
  }
  return done;
}

/** The printable page shown when the PDF could not be made (PRD 4.14 states table). */
export async function payslipFallbackHtml(ctx: Ctx, row: PayslipRow): Promise<string> {
  const run = await runOfPayslip(ctx, row);
  return renderHtml(
    {
      template: 'payslip',
      data: { view: payslipView(ctx, row, run), watermark: watermarkFor(run) },
    },
    'en',
    true,
  );
}

/** 200 with the stored PDF, 202 while it is being made; staff only get their own. */
export async function payslipPdf(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user ?? fail('UNAUTHENTICATED');
  const row = await payslipRow(ctx, id);
  if (user.role === 'staff' && (row.user_id !== user.id || !(await staffMaySee(ctx)))) {
    fail('NOT_FOUND', 'That payslip was not found.');
  }
  if (row.pdf_status === 'failed') {
    // Browser Run gave up: the printable online slip stands in (PRD 4.14).
    return new Response(await payslipFallbackHtml(ctx, row), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }
  const object =
    row.pdf_status === 'ready' && row.pdf_key ? await ctx.env.MEDIA.get(row.pdf_key) : null;
  if (!object) {
    return new Response(JSON.stringify({ status: 'pending' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '5' },
    });
  }
  const run = await runOfPayslip(ctx, row);
  const name = `payslip-${run.month}-r${run.revision}.pdf`;
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
