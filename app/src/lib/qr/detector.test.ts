import { describe, expect, it } from 'vitest';
import { nativeQrDetector, pickScanEngine, SCAN_FRAME_PX, scaledFrameSize } from './detector';

function detectorClass(formats: string[] | null, opts: { throwOnNew?: boolean } = {}) {
  return class {
    static getSupportedFormats = formats ? async () => formats : undefined;
    constructor() {
      if (opts.throwOnNew) throw new TypeError('not supported on this platform');
    }
    async detect() {
      return [];
    }
  };
}

describe('pickScanEngine (S-06.5 both decoders)', () => {
  it('S-06.5 uses BarcodeDetector when it reads qr_code (Chrome on Android)', async () => {
    const scope = { BarcodeDetector: detectorClass(['ean_13', 'qr_code']) };
    expect(await pickScanEngine(scope)).toBe('barcode-detector');
    expect(await nativeQrDetector(scope)).toBe(scope.BarcodeDetector);
  });

  it('S-06.5 falls back to jsQR without BarcodeDetector (iOS)', async () => {
    expect(await pickScanEngine({})).toBe('jsqr');
    expect(await nativeQrDetector({})).toBeNull();
  });

  it('falls back to jsQR when qr_code is not a supported format', async () => {
    expect(await pickScanEngine({ BarcodeDetector: detectorClass(['ean_13']) })).toBe('jsqr');
  });

  it('falls back to jsQR when the detector cannot be constructed', async () => {
    const scope = { BarcodeDetector: detectorClass(['qr_code'], { throwOnNew: true }) };
    expect(await pickScanEngine(scope)).toBe('jsqr');
  });

  it('uses the detector when the browser cannot list formats but constructs fine', async () => {
    expect(await pickScanEngine({ BarcodeDetector: detectorClass(null) })).toBe('barcode-detector');
  });

  it('ignores a BarcodeDetector that is not a class', async () => {
    expect(await pickScanEngine({ BarcodeDetector: {} })).toBe('jsqr');
  });
});

describe('scaledFrameSize (jsQR frames at 640 px)', () => {
  it('scales the long side to 640 px', () => {
    expect(SCAN_FRAME_PX).toBe(640);
    expect(scaledFrameSize(1280, 720)).toEqual({ width: 640, height: 360 });
    expect(scaledFrameSize(720, 1280)).toEqual({ width: 360, height: 640 });
    expect(scaledFrameSize(1920, 1080)).toEqual({ width: 640, height: 360 });
  });

  it('never scales up and handles an empty frame', () => {
    expect(scaledFrameSize(480, 360)).toEqual({ width: 480, height: 360 });
    expect(scaledFrameSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
