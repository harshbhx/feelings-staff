/**
 * Which QR decoder to use (PRD 4.5, S-06.5): the native `BarcodeDetector` where it exists and
 * reads `qr_code` (Chrome on Android), else jsQR in a Web Worker (iOS, Firefox, desktop Safari).
 */

export type ScanEngine = 'barcode-detector' | 'jsqr';

/** Long side of the frames handed to jsQR (PRD 4.5: frames from the rear camera at 640 px). */
export const SCAN_FRAME_PX = 640;

export interface DetectedBarcodeLike {
  rawValue: string;
}

export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcodeLike[]>;
}

export interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Where to look for BarcodeDetector (globalThis in the app, a fake in tests). */
export interface DetectorScope {
  BarcodeDetector?: unknown;
}

/** The native detector constructor when it can read QR codes, else null. */
export async function nativeQrDetector(
  scope: DetectorScope = globalThis as DetectorScope,
): Promise<BarcodeDetectorCtor | null> {
  const Ctor = scope.BarcodeDetector;
  if (typeof Ctor !== 'function') return null;
  const ctor = Ctor as BarcodeDetectorCtor;
  try {
    if (typeof ctor.getSupportedFormats === 'function') {
      const formats = await ctor.getSupportedFormats();
      if (!formats.includes('qr_code')) return null;
    }
    // Some builds expose the class but throw on construction (no platform support).
    const probe = new ctor({ formats: ['qr_code'] });
    return typeof probe.detect === 'function' ? ctor : null;
  } catch {
    return null;
  }
}

export async function pickScanEngine(
  scope: DetectorScope = globalThis as DetectorScope,
): Promise<ScanEngine> {
  return (await nativeQrDetector(scope)) ? 'barcode-detector' : 'jsqr';
}

/** Frame size for jsQR: the long side scaled down to `max` px (never up), whole pixels. */
export function scaledFrameSize(
  width: number,
  height: number,
  max: number = SCAN_FRAME_PX,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
