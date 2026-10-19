# ADR-07. PDFs through Browser Run from HTML templates

Status: accepted, 19 Oct 2026. Source: PRD 4.14, 13.5.

## Context

Payslips need Gujarati in version 1.1. `pdf-lib` inside a Worker cannot shape Gujarati conjuncts, so text would render wrongly.

## Decision

Render a print HTML template (the same one the app shows on screen, from `packages/templates`) and convert it to PDF with the Cloudflare Browser Run binding (`BROWSER`, `@cloudflare/puppeteer`). Workers Paid includes 10 browser hours a month; one payslip takes about 2 to 3 seconds. The `PdfRenderer` port wraps it. If rendering fails, it retries with back-off and the HTML payslip offers print or save as PDF.

## Consequences

- One template for screen and PDF.
- PDF generation depends on a beta-era binding, so there is a fallback that never blocks the owner.
- Previews have the binding too, so payslips can be checked there.
