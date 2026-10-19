/**
 * Door QR scanner (PRD 4.5, 5.1 "Scan", S-06.5). Owner: WP-4; the `/scan` screen (WP-7) renders the
 * viewport, the square guide, the torch toggle and the "Type the code" fallback on top of it.
 *
 *   const scanner = await createScanner(videoEl, { onDecode: (text) => { ... parseDoorUrl(text) } });
 *   scanner.torchAvailable && scanner.setTorch(true);
 *   scanner.stop(); // always, on unmount
 *
 * Rear camera (`facingMode: environment`). Decoding uses `BarcodeDetector` (`qr_code`) where the
 * browser has it, else jsQR in a Web Worker on frames scaled to 640 px. One frame is decoded at a
 * time, every `intervalMs`. The worker (and jsQR) load only on the fallback path, so they stay out
 * of the main bundle (PRD 11.10). Import this module lazily from the scan screen.
 */
import { type CameraErrorKind, cameraErrorKind } from '../punch/camera';
import { type DetectorScope, nativeQrDetector, type ScanEngine, scaledFrameSize } from './detector';
import { isDecodeResponse, type QrDecodeRequest } from './protocol';

export type ScannerErrorKind = CameraErrorKind | 'unsupported';

export class ScannerError extends Error {
  readonly kind: ScannerErrorKind;
  constructor(kind: ScannerErrorKind, cause?: unknown) {
    super(`Scanner unavailable: ${kind}`, cause === undefined ? undefined : { cause });
    this.name = 'ScannerError';
    this.kind = kind;
  }
}

export interface QrScanner {
  readonly engine: ScanEngine;
  /** The rear camera reports a controllable torch. */
  readonly torchAvailable: boolean;
  /** Turn the torch on or off; resolves false when the camera refused. */
  setTorch(on: boolean): Promise<boolean>;
  /** Stop decoding, release the camera and the worker. Safe to call twice. */
  stop(): void;
}

/** The parts of a Worker the scanner uses (a fake in tests). */
export interface QrWorkerLike {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage(message: QrDecodeRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface ScannerOptions {
  /** Every decoded QR text, as is. Parse it with `parseDoorUrl`; the scanner keeps running. */
  onDecode: (text: string) => void;
  /** Pause between decode attempts (default 200 ms). */
  intervalMs?: number;
  /** Test seams; the defaults use the browser. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  scope?: DetectorScope;
  createWorker?: () => QrWorkerLike;
  grabFrame?: (video: HTMLVideoElement, width: number, height: number) => ImageData | null;
}

export const REAR_CAMERA: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

function defaultGetUserMedia(): ScannerOptions['getUserMedia'] {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return undefined;
  return (c) => navigator.mediaDevices.getUserMedia(c);
}

function defaultWorker(): QrWorkerLike {
  return new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' });
}

function canvasFrameGrabber(): NonNullable<ScannerOptions['grabFrame']> {
  let canvas: HTMLCanvasElement | null = null;
  return (video, width, height) => {
    canvas ??= document.createElement('canvas');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  };
}

/** Open the rear camera on `video` and start decoding. Rejects with a `ScannerError`. */
export async function createScanner(
  video: HTMLVideoElement,
  opts: ScannerOptions,
): Promise<QrScanner> {
  const getUserMedia = opts.getUserMedia ?? defaultGetUserMedia();
  if (!getUserMedia) throw new ScannerError('unsupported');
  let stream: MediaStream;
  try {
    stream = await getUserMedia(REAR_CAMERA);
  } catch (e) {
    throw new ScannerError(cameraErrorKind(e), e);
  }
  // iOS needs playsinline and muted to show the stream inline (PRD 11.8).
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // Autoplay may refuse until the stream has data; frames still arrive.
  }

  const Native = await nativeQrDetector(opts.scope);
  const detector = Native ? new Native({ formats: ['qr_code'] }) : null;
  const engine: ScanEngine = detector ? 'barcode-detector' : 'jsqr';
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as
    | (MediaTrackCapabilities & { torch?: boolean })
    | undefined;
  const torchAvailable = caps?.torch === true;

  const grabFrame = opts.grabFrame ?? canvasFrameGrabber();
  const waiting = new Map<number, (text: string | null) => void>();
  let worker: QrWorkerLike | null = null;
  let nextId = 1;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const ensureWorker = (): QrWorkerLike => {
    if (worker) return worker;
    const w = (opts.createWorker ?? defaultWorker)();
    w.onmessage = (e) => {
      const m = e.data;
      if (!isDecodeResponse(m)) return;
      const done = waiting.get(m.id);
      waiting.delete(m.id);
      done?.(m.text);
    };
    worker = w;
    return w;
  };

  const decodeFrame = async (): Promise<string | null> => {
    if (detector) {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue ?? null;
    }
    const { width, height } = scaledFrameSize(video.videoWidth, video.videoHeight);
    if (!width || !height) return null;
    const frame = grabFrame(video, width, height);
    if (!frame) return null;
    const w = ensureWorker();
    const id = nextId++;
    const pixels = frame.data.buffer;
    return new Promise<string | null>((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ type: 'decode', id, width, height, pixels }, [pixels]);
    });
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const text = await decodeFrame();
      if (text && !stopped) opts.onDecode(text);
    } catch {
      // A frame the decoder could not read (not ready yet, or a glitch): try the next one.
    }
    if (!stopped) timer = setTimeout(() => void tick(), opts.intervalMs ?? 200);
  };
  void tick();

  return {
    engine,
    torchAvailable,
    async setTorch(on) {
      if (!track || !torchAvailable) return false;
      try {
        const torch = { torch: on } as unknown as MediaTrackConstraintSet;
        await track.applyConstraints({ advanced: [torch] });
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker?.terminate();
      worker = null;
      for (const t of stream.getTracks()) t.stop();
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}
