/**
 * PdfRenderer (ADR-07): the shared templates rendered to HTML, then to PDF by Cloudflare Browser
 * Run. Retries and the HTML fallback live in payslip-pdf.ts; this file only renders. Owner: WP-5.
 */
import puppeteer from '@cloudflare/puppeteer';
import type { PayslipView } from '@fs/contracts';
import { createI18n } from '@fs/i18n';
import {
  PayslipDocument,
  type RegisterData,
  RegisterDocument,
  renderDocument,
  type SalaryRegisterData,
  SalaryRegisterDocument,
  type T,
} from '@fs/templates';
import { createElement } from 'react';
import type { Env } from '../env';
import type { PdfRenderer } from './ports';

/** The brand tokens the print stylesheet names, inlined because a PDF has no app CSS (packages/ui). */
const TOKENS_CSS = `:root{--text:#1e1214;--text-muted:#76656a;--border:#efe3e1;--border-strong:#f2d8d6;--accent:#b3121b;--font-sans:'Plus Jakarta Sans','Noto Sans Gujarati',system-ui,sans-serif}`;

export type PdfData =
  | { template: 'payslip'; data: { view: PayslipView; watermark?: string | null } }
  | { template: 'register'; data: RegisterData }
  | { template: 'salary_register'; data: SalaryRegisterData };

async function translator(lang: 'en' | 'gu'): Promise<T> {
  const i18n = await createI18n(lang);
  return (key, vars) => (vars ? i18n.t(key, vars) : i18n.t(key)) as string;
}

/** The full HTML page of a document; `fallback` adds the print notice (PRD 4.14 states table). */
export async function renderHtml(
  doc: PdfData,
  lang: 'en' | 'gu',
  fallback = false,
): Promise<string> {
  const t = await translator(lang);
  const body =
    doc.template === 'payslip'
      ? createElement(PayslipDocument, {
          view: doc.data.view,
          t,
          watermark: doc.data.watermark ?? null,
        })
      : doc.template === 'register'
        ? createElement(RegisterDocument, { data: doc.data, t })
        : createElement(SalaryRegisterDocument, { data: doc.data, t });
  return renderDocument(body, {
    title: t(
      doc.template === 'payslip'
        ? 'payslip:title'
        : `payslip:${doc.template === 'register' ? 'register' : 'salaryRegister'}.title`,
    ),
    lang,
    tokensCss: TOKENS_CSS,
    ...(fallback
      ? {
          fallback: {
            notice: t('payslip:fallback.notice'),
            printLabel: t('payslip:fallback.print'),
          },
        }
      : {}),
  });
}

export function createPdfRenderer(env?: Pick<Env, 'BROWSER'>): PdfRenderer {
  return {
    async render(template, data, lang) {
      const html = await renderHtml({ template, data } as PdfData, lang);
      if (!env?.BROWSER) throw new Error('Browser Run is not configured');
      const browser = await puppeteer.launch(env.BROWSER);
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'a4',
          printBackground: true,
          landscape: template !== 'payslip',
        });
        return new Uint8Array(pdf).buffer as ArrayBuffer;
      } finally {
        await browser.close();
      }
    },
  };
}
