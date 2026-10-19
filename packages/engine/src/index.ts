/**
 * @fs/engine public API (PRD 7.16). Every function is pure and deterministic.
 * Folders: schedule/, day/, pay/, leave/, money/ (WP-5); fence/, risk/ (WP-4); credits/, presence/ (WP-9).
 */

export * from './credits';
export { type ComputeDayInput, computeDay, timeRulesFromSettings } from './day';
export {
  bestFence,
  type CalibrationResult,
  type CalibrationSample,
  distanceBucket,
  fenceCheck,
  haversineM,
  proposeCalibration,
} from './fence';
export * from './leave';
export * as money from './money';
export { formatInr, type Q } from './money';
export * from './pay';
export * from './presence';
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
export { hasNightHours, resolveSchedule, segmentOffsets, templateMinutes } from './schedule';
export { ENGINE_VERSION, EngineNotReady } from './version';
