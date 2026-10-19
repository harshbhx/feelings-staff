/** Full HTML documents for the PDF renderer and the "print or save as PDF" fallback. */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRINT_CSS } from './css';
import type { T } from './types';

export interface HtmlOptions {
  title: string;
  lang: 'en' | 'gu';
  /** Brand tokens (:root custom properties) from packages/ui, inlined for the PDF. */
  tokensCss?: string;
  /** Fallback page: a notice and a Print button (hidden when printing). */
  fallback?: { notice: string; printLabel: string };
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderDocument(body: ReactElement, o: HtmlOptions): string {
  const page = (
    <html lang={o.lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{o.title}</title>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own stylesheet; React would escape its quotes */}
        <style dangerouslySetInnerHTML={{ __html: `${o.tokensCss ?? ''}${PRINT_CSS}` }} />
      </head>
      <body>
        {o.fallback ? (
          <div
            className="fs-fallback fs-noprint"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by esc() above
            dangerouslySetInnerHTML={{
              __html: `<p>${esc(o.fallback.notice)}</p><button type="button" onclick="window.print()">${esc(o.fallback.printLabel)}</button>`,
            }}
          />
        ) : null}
        {body}
      </body>
    </html>
  );
  return `<!doctype html>${renderToStaticMarkup(page)}`;
}

export type { T };
