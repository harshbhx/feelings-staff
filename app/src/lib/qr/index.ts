/**
 * Door QR helpers (PRD 4.5). Parsing and engine selection are tiny and safe to import anywhere; the
 * scanner itself (`./scanner`) should be imported lazily by the scan screen.
 */
export {
  type DetectorScope,
  nativeQrDetector,
  pickScanEngine,
  SCAN_FRAME_PX,
  type ScanEngine,
  scaledFrameSize,
} from './detector';
export {
  DOOR_TOKEN_LENGTH,
  type DoorUrlError,
  type DoorUrlParse,
  doorUrl,
  normaliseDoorToken,
  parseDoorUrl,
} from './parse';
export type { QrDecodeRequest, QrDecodeResponse } from './protocol';
export type { QrScanner, QrWorkerLike, ScannerErrorKind, ScannerOptions } from './scanner';
