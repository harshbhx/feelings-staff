/**
 * @fs/engine public API (PRD 7.16). Every function is pure and deterministic.
 * Folders: schedule/, day/, pay/, leave/, money/ (WP-5); fence/, risk/ (WP-4).
 * Until a package lands, its folder exports a stub that throws EngineNotReady.
 */

export { computeDay } from './day';
export {
  bestFence,
  type CalibrationResult,
  type CalibrationSample,
  distanceBucket,
  fenceCheck,
  haversineM,
  proposeCalibration,
} from './fence';
export { computePayslip } from './pay';
export {
  DOOR_STEP_MS,
  doorStep,
  doorToken,
  isDoorTokenShape,
  isSuspectAsn,
  matchDoorToken,
  outcomeForScore,
  RISK_POINTS,
  riskScore,
  riskSignals,
} from './risk';
export { resolveSchedule } from './schedule';
export { ENGINE_VERSION, EngineNotReady } from './version';
