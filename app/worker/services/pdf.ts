/** PdfRenderer through Browser Run with retries and the HTML fallback (ADR-07). Owner: WP-5. */
import type { PdfRenderer } from './ports';

export function createPdfRenderer(): PdfRenderer {
  return {
    async render() {
      throw new Error('PdfRenderer not implemented yet (WP-5)');
    },
  };
}
