/**
 * Print stylesheet for the payslip and the registers. It uses the brand tokens by name (they come
 * from packages/ui on screen and are inlined by the PDF renderer), so no colour is written here.
 */
export const PRINT_CSS = `
.fs-doc { font-family: var(--font-sans, 'Plus Jakarta Sans', 'Noto Sans Gujarati', system-ui, sans-serif);
  color: var(--text, inherit); font-size: 13px; line-height: 1.45; position: relative; }
.fs-doc h1 { font-size: 20px; font-weight: 800; margin: 0; }
.fs-doc h2 { font-size: 13px; font-weight: 700; margin: 18px 0 6px; text-transform: none; }
.fs-doc table { width: 100%; border-collapse: collapse; }
.fs-doc th, .fs-doc td { padding: 5px 6px; border-bottom: 1px solid var(--border, currentColor); text-align: left; vertical-align: top; }
.fs-doc th { font-weight: 600; color: var(--text-muted, inherit); }
.fs-doc .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fs-doc .muted { color: var(--text-muted, inherit); }
.fs-doc .formula { color: var(--text-muted, inherit); font-size: 12px; }
.fs-doc .total td { font-weight: 700; border-top: 1px solid var(--text, currentColor); }
.fs-doc .net td { font-weight: 800; font-size: 15px; }
.fs-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid var(--accent, currentColor); padding-bottom: 8px; }
.fs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 24px; margin-top: 10px; }
.fs-grid div { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border, currentColor); padding: 3px 0; }
.fs-two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
.fs-verify { display: flex; gap: 12px; align-items: center; margin-top: 18px; }
.fs-verify svg { width: 84px; height: 84px; }
.fs-foot { margin-top: 18px; font-size: 12px; color: var(--text-muted, inherit); }
.fs-watermark { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-size: 34px; font-weight: 800;
  transform: rotate(-18deg); color: var(--text-muted, inherit); opacity: 0.28; pointer-events: none; }
.fs-reg th, .fs-reg td { padding: 2px 3px; font-size: 10px; text-align: center; border: 1px solid var(--border, currentColor); }
.fs-reg td.name, .fs-reg th.name { text-align: left; white-space: nowrap; }
.fs-fallback { margin: 0 0 12px; padding: 8px 10px; border: 1px solid var(--border-strong, currentColor); }
@page { size: A4; margin: 14mm; }
@media print { .fs-noprint { display: none; } }
`;
