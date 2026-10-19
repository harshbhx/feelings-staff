import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QrDecodeRequest } from './protocol';
import { createScanner, type QrWorkerLike, REAR_CAMERA, ScannerError } from './scanner';

const URL_TEXT = 'https://staff.test/q/01K8WN0TQC11QKMBNWMGPP50NM/ABCDEFGHJK';

function fakeStream(caps: Record<string, unknown> = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => caps,
    applyConstraints: vi.fn(async () => {}),
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function fakeVideo(width = 1280, height = 720): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: width });
  Object.defineProperty(video, 'videoHeight', { value: height });
  video.play = async () => {};
  return video;
}

function fakeWorker(answer: (req: QrDecodeRequest) => string | null) {
  const posted: { req: QrDecodeRequest; transfer: Transferable[] }[] = [];
  const worker: QrWorkerLike & { terminated: boolean } = {
    onmessage: null,
    terminated: false,
    postMessage(req, transfer) {
      posted.push({ req, transfer });
      queueMicrotask(() =>
        worker.onmessage?.({
          data: { type: 'decoded', id: req.id, text: answer(req) },
        } as unknown as MessageEvent<unknown>),
      );
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return { worker, posted };
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

describe('createScanner (PRD 4.5, S-06.5)', () => {
  it('opens the rear camera inline and muted', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    const video = fakeVideo();
    const scanner = await createScanner(video, {
      onDecode: () => {},
      getUserMedia,
      scope: {},
      createWorker: () => fakeWorker(() => null).worker,
      grabFrame: () => null,
    });
    stops.push(() => scanner.stop());
    expect(getUserMedia).toHaveBeenCalledWith(REAR_CAMERA);
    expect(video.getAttribute('playsinline')).toBe('');
    expect(video.muted).toBe(true);
  });

  it('S-06.5 decodes with BarcodeDetector where available', async () => {
    const { stream } = fakeStream();
    const BarcodeDetector = class {
      static getSupportedFormats = async () => ['qr_code'];
      async detect() {
        return [{ rawValue: URL_TEXT }];
      }
    };
    const createWorker = vi.fn();
    const decoded: string[] = [];
    const scanner = await createScanner(fakeVideo(), {
      onDecode: (text) => decoded.push(text),
      getUserMedia: async () => stream,
      scope: { BarcodeDetector },
      createWorker,
      intervalMs: 5,
    });
    stops.push(() => scanner.stop());
    expect(scanner.engine).toBe('barcode-detector');
    await vi.waitFor(() => expect(decoded).toContain(URL_TEXT));
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('S-06.5 falls back to jsQR in a worker on 640 px frames', async () => {
    const { stream } = fakeStream();
    const { worker, posted } = fakeWorker(() => URL_TEXT);
    const grabFrame = vi.fn(
      (_v: HTMLVideoElement, width: number, height: number) =>
        ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }) as unknown as ImageData,
    );
    const decoded: string[] = [];
    const scanner = await createScanner(fakeVideo(1280, 720), {
      onDecode: (text) => decoded.push(text),
      getUserMedia: async () => stream,
      scope: {},
      createWorker: () => worker,
      grabFrame,
      intervalMs: 5,
    });
    stops.push(() => scanner.stop());
    expect(scanner.engine).toBe('jsqr');
    await vi.waitFor(() => expect(decoded).toContain(URL_TEXT));
    expect(grabFrame).toHaveBeenCalledWith(expect.anything(), 640, 360);
    const first = posted[0];
    expect(first?.req).toMatchObject({ type: 'decode', width: 640, height: 360 });
    expect(first?.transfer).toEqual([first?.req.pixels]);
  });

  it('stop releases the camera and the worker', async () => {
    const { stream, track } = fakeStream();
    const { worker } = fakeWorker(() => null);
    const video = fakeVideo();
    const scanner = await createScanner(video, {
      onDecode: () => {},
      getUserMedia: async () => stream,
      scope: {},
      createWorker: () => worker,
      grabFrame: (_v, width, height) =>
        ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }) as unknown as ImageData,
      intervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    scanner.stop();
    scanner.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
  });

  it('turns the torch on only when the camera has one', async () => {
    const withTorch = fakeStream({ torch: true });
    const s1 = await createScanner(fakeVideo(), {
      onDecode: () => {},
      getUserMedia: async () => withTorch.stream,
      scope: {},
      grabFrame: () => null,
    });
    stops.push(() => s1.stop());
    expect(s1.torchAvailable).toBe(true);
    expect(await s1.setTorch(true)).toBe(true);
    expect(withTorch.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });

    const without = fakeStream({});
    const s2 = await createScanner(fakeVideo(), {
      onDecode: () => {},
      getUserMedia: async () => without.stream,
      scope: {},
      grabFrame: () => null,
    });
    stops.push(() => s2.stop());
    expect(s2.torchAvailable).toBe(false);
    expect(await s2.setTorch(true)).toBe(false);
  });

  it('maps a refused camera to denied and other failures to failed', async () => {
    const denied = createScanner(fakeVideo(), {
      onDecode: () => {},
      getUserMedia: async () => {
        throw new DOMException('no', 'NotAllowedError');
      },
    });
    await expect(denied).rejects.toBeInstanceOf(ScannerError);
    await expect(denied).rejects.toMatchObject({ kind: 'denied' });
    const failed = createScanner(fakeVideo(), {
      onDecode: () => {},
      getUserMedia: async () => {
        throw new DOMException('busy', 'NotReadableError');
      },
    });
    await expect(failed).rejects.toMatchObject({ kind: 'failed' });
  });
});
