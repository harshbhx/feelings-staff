/**
 * Door kiosk logic (PRD 4.5): pairing, the once-a-second countdown and code, the hourly clock
 * sync, the 30 s "last check-in" poll and the screen wake lock.
 *
 * `phase`: `loading` (reading the store) -> `unpaired` (pairing form) or `paired`. While paired,
 * `code` is null until the first clock sync ("Clock not synced yet"). `offline` is true when the
 * last status or time request failed; the code keeps rotating from the synced clock.
 */
import { type ApiClient, ApiError, normaliseCode } from '@fs/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../../api/provider';
import { CLOCK_RESYNC_MS, createDoorClock, STATUS_POLL_MS } from './clock';
import { type DoorPairing, type DoorStore, idbDoorStore } from './store';
import { currentDoorCode, type DoorCode } from './token';

export type DoorPhase = 'loading' | 'unpaired' | 'paired';
export type PairError = 'format' | 'wrong' | 'network';

export interface DoorState {
  phase: DoorPhase;
  pairing: DoorPairing | null;
  code: DoorCode | null;
  synced: boolean;
  offline: boolean;
  lastCheckIn: { firstName: string; at: number } | null;
  pairError: PairError | null;
  pairBusy: boolean;
}

export interface UseDoorOptions {
  store?: DoorStore;
  origin?: string;
}

export function pairErrorOf(e: unknown): PairError {
  if (e instanceof ApiError && e.status > 0 && e.status < 500) return 'wrong';
  return 'network';
}

type WakeLockSentinelLike = { release(): Promise<void> };

export function useDoor(options: UseDoorOptions = {}) {
  const api: ApiClient = useApi();
  const storeRef = useRef<DoorStore>(options.store ?? idbDoorStore);
  const clock = useRef(createDoorClock()).current;
  const origin = options.origin ?? (typeof location === 'undefined' ? '' : location.origin);
  const [phase, setPhase] = useState<DoorPhase>('loading');
  const [pairing, setPairing] = useState<DoorPairing | null>(null);
  const pairingRef = useRef<DoorPairing | null>(null);
  pairingRef.current = pairing;
  const [code, setCode] = useState<DoorCode | null>(null);
  const [synced, setSynced] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastCheckIn, setLastCheckIn] = useState<DoorState['lastCheckIn']>(null);
  const [pairError, setPairError] = useState<PairError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void storeRef.current.get().then((p) => {
      if (!live) return;
      setPairing(p);
      setPhase(p ? 'paired' : 'unpaired');
    });
    return () => {
      live = false;
    };
  }, []);

  const syncClock = useCallback(async () => {
    try {
      const t = await api.time();
      clock.sync(t.serverTime);
      setSynced(true);
      setOffline(false);
      // The owner may have rotated this device's secret: take the current one.
      const current = pairingRef.current;
      if (current) {
        try {
          const s = await api.doorSecret();
          if (s.secret !== current.secret) {
            const next = { ...current, secret: s.secret };
            await storeRef.current.set(next);
            setPairing(next);
          }
        } catch {
          // Offline or not rotated: the stored secret keeps working until the next sync.
        }
      }
    } catch {
      setOffline(true);
    }
  }, [api, clock]);

  // Clock sync: now and hourly.
  useEffect(() => {
    if (phase !== 'paired') return;
    void syncClock();
    const id = setInterval(() => void syncClock(), CLOCK_RESYNC_MS);
    return () => clearInterval(id);
  }, [phase, syncClock]);

  // Code: recomputed every second from the synced clock.
  const secret = pairing?.secret;
  const siteId = pairing?.siteId;
  useEffect(() => {
    if (phase !== 'paired' || !secret || !siteId) return;
    let live = true;
    const tick = async () => {
      const now = clock.now();
      if (now === null) return;
      const next = await currentDoorCode(secret, siteId, now, origin);
      if (live)
        setCode((prev) =>
          prev && prev.token === next.token && prev.secondsLeft === next.secondsLeft ? prev : next,
        );
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, secret, siteId, origin, clock]);

  // "Last check-in": every 30 s while visible.
  useEffect(() => {
    if (phase !== 'paired') return;
    let live = true;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const s = await api.doorStatus();
        if (!live) return;
        setLastCheckIn(s.lastCheckIn);
        setOffline(false);
      } catch (e) {
        if (!live) return;
        // The door session was ended by the owner: back to the pairing form.
        if (e instanceof ApiError && e.status === 401) {
          await storeRef.current.clear();
          setPairing(null);
          setCode(null);
          setPhase('unpaired');
          return;
        }
        setOffline(true);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, api]);

  // Keep the screen awake; take the lock again when the tab comes back.
  useEffect(() => {
    if (phase !== 'paired') return;
    let sentinel: WakeLockSentinelLike | null = null;
    let live = true;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    const acquire = async () => {
      if (!nav.wakeLock || document.visibilityState !== 'visible') return;
      try {
        const s = await nav.wakeLock.request('screen');
        if (live) sentinel = s;
        else await s.release();
      } catch {
        // Not allowed right now (low battery, background): try again on the next visibility change.
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [phase]);

  const pair = useCallback(
    async (input: string) => {
      const pairingCode = normaliseCode(input, 8);
      if (!pairingCode) {
        setPairError('format');
        return;
      }
      setBusy(true);
      setPairError(null);
      try {
        const r = await api.doorPair({ body: { pairingCode } });
        const p: DoorPairing = {
          doorDeviceId: r.doorDeviceId,
          siteId: r.siteId,
          siteName: r.siteName,
          secret: r.secret,
        };
        await storeRef.current.set(p);
        clock.sync(r.serverTime);
        setSynced(true);
        setPairing(p);
        setPhase('paired');
      } catch (e) {
        setPairError(pairErrorOf(e));
      } finally {
        setBusy(false);
      }
    },
    [api, clock],
  );

  const state: DoorState = {
    phase,
    pairing,
    code,
    synced,
    offline,
    lastCheckIn,
    pairError,
    pairBusy: busy,
  };
  return { ...state, pair };
}
