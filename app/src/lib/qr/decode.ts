/**
 * The jsQR call behind the worker (PRD 4.5 fallback). Kept apart from `qr.worker.ts` so it can be
 * unit-tested; only the worker imports it, so jsQR stays out of the main bundle (PRD 11.10).
 */
import jsQR from 'jsqr';
import type { QrDecodeRequest, QrDecodeResponse } from './protocol';

export function decodeQrFrame(req: QrDecodeRequest): QrDecodeResponse {
  let text: string | null = null;
  try {
    const found = jsQR(new Uint8ClampedArray(req.pixels), req.width, req.height, {
      inversionAttempts: 'dontInvert',
    });
    text = found?.data ? found.data : null;
  } catch {
    text = null;
  }
  return { type: 'decoded', id: req.id, text };
}
