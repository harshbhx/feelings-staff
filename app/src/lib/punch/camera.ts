/**
 * Selfie camera (PRD 4.3.4, 10.4, S-07). Owner: WP-4.
 *
 * Only a live `getUserMedia` stream from the front camera: no file input, no gallery (S-07.2). The
 * camera is opened only when the selfie is required for this punch (S-07.1). The still is a JPEG,
 * 480 px on the long side, quality 0.7 (40-80 KB, always <= 200 KB: S-07.3), and its SHA-256
 * (lowercase hex of exactly those bytes) goes into the signed payload. Mean luminance below 40/255
 * means "too dark".
 */

export const SELFIE_LONG_SIDE_PX = 480;
export const SELFIE_JPEG_QUALITY = 0.7;
export const SELFIE_MAX_BYTES = 200 * 1024;
/** Mean luminance (0-255) below which the photo is too dark (PRD 4.3.4). */
export const DARK_LUMINANCE = 40;

export interface CapturedSelfie {
  blob: Blob;
  /** Lowercase hex SHA-256 of the JPEG bytes. */
  sha256: string;
  /** Mean luminance 0-255 of the captured frame. */
  luminance: number;
  width: number;
  height: number;
}

export type CameraErrorKind = 'denied' | 'failed';

/** Permission refusals are `denied` (fix-it sheet); everything else is `failed`. */
export function cameraErrorKind(e: unknown): CameraErrorKind {
  const name =
    typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError'
    ? 'denied'
    : 'failed';
}

/** Size with the long side at most `max` px (never upscaled), whole pixels. */
export function fitLongSide(
  width: number,
  height: number,
  max: number = SELFIE_LONG_SIDE_PX,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Mean Rec. 601 luminance (0-255) of RGBA pixels, sampling every `stride`-th pixel. */
export function meanLuminance(rgba: ArrayLike<number>, stride = 1): number {
  const step = Math.max(1, Math.floor(stride)) * 4;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += step) {
    sum += 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

export function isTooDark(luminance: number): boolean {
  return luminance < DARK_LUMINANCE;
}

/** Lowercase hex SHA-256 of the bytes. */
export async function sha256Hex(
  data: Blob | ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(await data.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** The front camera, live (PRD 10.4). Rejects with the browser's error (see `cameraErrorKind`). */
export async function openFrontCamera(
  getUserMedia:
    | ((c: MediaStreamConstraints) => Promise<MediaStream>)
    | undefined = typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
    ? (c) => navigator.mediaDevices.getUserMedia(c)
    : undefined,
): Promise<MediaStream> {
  if (!getUserMedia) throw new DOMException('No camera API', 'NotFoundError');
  return getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * Take one still from the live preview: 480 px long side, JPEG quality 0.7 (lower only if a frame
 * would exceed 200 KB), with its SHA-256 and mean luminance.
 */
export async function captureStill(video: HTMLVideoElement): Promise<CapturedSelfie> {
  const { width, height } = fitLongSide(video.videoWidth, video.videoHeight);
  if (!width || !height)
    throw new DOMException('The camera has no picture yet', 'InvalidStateError');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new DOMException('No 2D canvas', 'NotSupportedError');
  ctx.drawImage(video, 0, 0, width, height);
  const luminance = meanLuminance(ctx.getImageData(0, 0, width, height).data, 4);
  let blob: Blob | null = null;
  for (const quality of [SELFIE_JPEG_QUALITY, 0.55, 0.4]) {
    blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= SELFIE_MAX_BYTES) break;
  }
  if (!blob || blob.size > SELFIE_MAX_BYTES) {
    throw new DOMException('Could not make a small enough photo', 'EncodingError');
  }
  return { blob, sha256: await sha256Hex(blob), luminance, width, height };
}

/** The camera port the punch flow uses (a fake in tests). */
export interface SelfieCamera {
  open(): Promise<MediaStream>;
  capture(video: HTMLVideoElement): Promise<CapturedSelfie>;
}

export const browserSelfieCamera: SelfieCamera = {
  open: () => openFrontCamera(),
  capture: captureStill,
};
