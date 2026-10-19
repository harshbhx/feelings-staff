/**
 * jsQR in a Web Worker (PRD 4.5, 11.8: iOS has no BarcodeDetector). Started only by the scanner's
 * fallback path, so jsQR never reaches the main bundle (PRD 11.10).
 */
import { decodeQrFrame } from './decode';
import { isDecodeRequest, type QrDecodeResponse } from './protocol';

/** The parts of DedicatedWorkerGlobalScope this worker uses (the app tsconfig has no WebWorker lib). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage(message: QrDecodeResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  if (isDecodeRequest(e.data)) scope.postMessage(decodeQrFrame(e.data));
};
