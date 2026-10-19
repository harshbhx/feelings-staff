/**
 * @fs/engine public API (PRD 7.16). Every function is pure and deterministic.
 * Folders: schedule/, day/, pay/, leave/, money/ (WP-5); fence/, risk/ (WP-4).
 * Until a package lands, its folder exports a stub that throws EngineNotReady.
 */

export { computeDay } from './day';
export { fenceCheck, haversineM } from './fence';
export { computePayslip } from './pay';
export { riskScore } from './risk';
export { resolveSchedule } from './schedule';
export { ENGINE_VERSION, EngineNotReady } from './version';
