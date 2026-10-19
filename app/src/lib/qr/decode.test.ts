import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { decodeQrFrame } from './decode';
import { isDecodeRequest, isDecodeResponse, type QrDecodeRequest } from './protocol';

/** Draw a uqr matrix (what the door screen shows) as RGBA pixels, `scale` px per module. */
function render(text: string, scale = 4): { width: number; height: number; pixels: ArrayBuffer } {
  const qr = encode(text, { ecc: 'M', border: 4 });
  const size = qr.size * scale;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = qr.data[Math.floor(y / scale)]?.[Math.floor(x / scale)] === true;
      const i = (y * size + x) * 4;
      const v = dark ? 0 : 255;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return { width: size, height: size, pixels: px.buffer };
}

describe('decodeQrFrame (jsQR fallback, S-06.5)', () => {
  it('S-06.5 reads a door code rendered the way the door screen draws it', () => {
    const url = 'https://staff.feelingsbeautycare.in/q/01K8WN0TQC11QKMBNWMGPP50NM/ABCDEFGHJK';
    const req: QrDecodeRequest = { type: 'decode', id: 7, ...render(url) };
    expect(isDecodeRequest(req)).toBe(true);
    const res = decodeQrFrame(req);
    expect(isDecodeResponse(res)).toBe(true);
    expect(res).toEqual({ type: 'decoded', id: 7, text: url });
  });

  it('answers null for a frame without a QR code', () => {
    const size = 64;
    const blank = new Uint8ClampedArray(size * size * 4).fill(255);
    expect(
      decodeQrFrame({ type: 'decode', id: 1, width: size, height: size, pixels: blank.buffer }),
    ).toEqual({ type: 'decoded', id: 1, text: null });
  });
});

describe('worker message guards', () => {
  it('rejects malformed requests and responses', () => {
    expect(isDecodeRequest(null)).toBe(false);
    expect(
      isDecodeRequest({ type: 'decode', id: 1, width: 2, height: 2, pixels: new ArrayBuffer(3) }),
    ).toBe(false);
    expect(isDecodeResponse({ type: 'decoded', id: 1 })).toBe(false);
    expect(isDecodeResponse({ type: 'decoded', id: 1, text: null })).toBe(true);
  });
});
