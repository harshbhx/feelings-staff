/**
 * The door's own idea of server time (PRD 4.5): signed server time from `GET /time` plus the
 * monotonic clock since, so it keeps working offline and ignores later changes of the device
 * clock. Re-synced hourly. Before the first sync there is no time and no code.
 */
export interface DoorClock {
  /** Server time now, or null before the first sync. */
  now(): number | null;
  sync(serverTime: number): void;
  synced(): boolean;
}

export function createDoorClock(perfNow: () => number = () => performance.now()): DoorClock {
  let anchor: { serverTime: number; perf: number } | null = null;
  return {
    now: () => (anchor ? anchor.serverTime + (perfNow() - anchor.perf) : null),
    sync(serverTime) {
      anchor = { serverTime, perf: perfNow() };
    },
    synced: () => anchor !== null,
  };
}

export const CLOCK_RESYNC_MS = 3_600_000;
export const STATUS_POLL_MS = 30_000;
