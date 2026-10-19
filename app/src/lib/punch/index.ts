/**
 * Punch flow library (PRD 4.3-4.6). Owner: WP-4. UI-free: WP-7's check-in sheet renders on top.
 * The state machine and every state/transition are documented in `state.ts`.
 */

export { appPunchQueue, deviceSigner, idbPunchStore } from './adapters';
export {
  browserSelfieCamera,
  type CameraErrorKind,
  type CapturedSelfie,
  cameraErrorKind,
  captureStill,
  DARK_LUMINANCE,
  fitLongSide,
  isTooDark,
  meanLuminance,
  openFrontCamera,
  SELFIE_JPEG_QUALITY,
  SELFIE_LONG_SIDE_PX,
  SELFIE_MAX_BYTES,
  type SelfieCamera,
  sha256Hex,
  stopStream,
} from './camera';
export {
  createMemoryPunchStore,
  deviceSignerStub,
  OFFLINE_NONCES_KEPT,
  type OfflineNonce,
  offlineNonceUsable,
  PunchDependencyMissing,
  type PunchQueue,
  type PunchSigner,
  type PunchStore,
  pagePunchStore,
  punchQueueStub,
  type QueuedPunch,
  type TimeAnchor,
} from './deps';
export { classifyPunchError, type PunchErrorAction } from './errors';
export { ensureOfflineReady, refreshTimeAnchor } from './offline';
export {
  buildPunchRequest,
  cleanText,
  deviceTimeZone,
  offlineProof,
  PAGE_SESSION_ID,
  type PunchAck,
  type PunchFields,
  pinEnvelopePlaintext,
  punchProofMessage,
  punchSigningMessage,
  sealPin,
  signPunchRequest,
  timeAnchorFrom,
  type UnsignedPunchRequest,
} from './payload';
export {
  APPROXIMATE_ACCURACY_M,
  advance,
  DARK_TRIES_BEFORE_SEND_ANYWAY,
  type DeniedReason,
  type FailedReason,
  FINAL_RESULTS,
  FIX_TTL_MS,
  type FlowNeeds,
  initialPunchState,
  type PunchEvent,
  type PunchFlowResult,
  type PunchFlowResultKind,
  type PunchFlowState,
  type PunchStep,
  punchReducer,
  type QrRejectReason,
  resultForPunch,
  type Submission,
} from './state';
export { runSubmission, type SubmitDeps, type SubmitInput } from './submit';
export {
  flowNeeds,
  type PunchFlags,
  type PunchFlow,
  type PunchFlowOptions,
  usePunchFlow,
} from './use-punch-flow';
