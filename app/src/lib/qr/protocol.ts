/**
 * Message protocol between the scanner and `qr.worker.ts` (jsQR fallback, PRD 4.5). The scanner
 * sends one frame at a time (RGBA pixels, transferred, never copied) and waits for its answer.
 */

/** Scanner -> worker: decode this frame. */
export interface QrDecodeRequest {
  type: 'decode';
  id: number;
  width: number;
  height: number;
  /** RGBA bytes, width * height * 4 long. Transferred to the worker. */
  pixels: ArrayBuffer;
}

/** Worker -> scanner: the text of the first QR code found, or null. */
export interface QrDecodeResponse {
  type: 'decoded';
  id: number;
  text: string | null;
}

export function isDecodeRequest(m: unknown): m is QrDecodeRequest {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Partial<QrDecodeRequest>;
  return (
    r.type === 'decode' &&
    typeof r.id === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    r.pixels instanceof ArrayBuffer &&
    r.pixels.byteLength === r.width * r.height * 4
  );
}

export function isDecodeResponse(m: unknown): m is QrDecodeResponse {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Partial<QrDecodeResponse>;
  return (
    r.type === 'decoded' &&
    typeof r.id === 'number' &&
    (r.text === null || typeof r.text === 'string')
  );
}
