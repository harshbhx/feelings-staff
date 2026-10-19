/** Engine semver, stored with every DayResult and PayslipResult (PRD 7.16). Bump on any rule change. */
export const ENGINE_VERSION = '0.1.0';

export class EngineNotReady extends Error {
  constructor(fn: string) {
    super(`@fs/engine: ${fn} is not implemented yet`);
    this.name = 'EngineNotReady';
  }
}
