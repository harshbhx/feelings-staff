/**
 * The punch flow as the check-in sheet sees it (PRD 4.3, 4.4.4, 4.5, 4.6 B).
 *
 * WP-4 owns the real state machine (`usePunchFlow` in `app/src/lib/punch/`). The sheet renders this
 * view of it, so the UI does not depend on WP-4's internal names: `flow-live.ts` adapts WP-4's
 * hook to this shape, and `flow-stub.ts` drives it from fixtures in mock mode (visual tests).
 */
import type { PunchKind, PunchRequest, PunchResult } from '@fs/contracts';
import type { ScanError } from '../scan/ScanPanel';
import type { PunchConfirm } from '../today/today-model';

export type PunchAction = Extract<PunchKind, 'in' | 'out'>;

/** Confirmations sent with the punch (PRD 4.3.2). */
export type PunchAck = PunchRequest['ack'][number];

/** Where the location check put the person. */
export interface PlaceFix {
  /** `salon` or `venue` (an off-site duty), `none` when the fence was not decided client-side. */
  type: 'salon' | 'venue' | 'none';
  /** Venue name for "Got it: at Hotel Aram". */
  name: string | null;
  distanceM: number | null;
  accuracyM: number | null;
}

/** Problems the sheet explains in words, each with its options (PRD 4.3.3-4.3.5, 4.3.2). */
export type PunchProblem =
  | { code: 'location_denied' }
  | { code: 'location_timeout' }
  | { code: 'location_approximate'; accuracyM: number | null }
  | { code: 'outside'; distanceM: number | null; venueAllowed: boolean }
  | { code: 'camera_denied' }
  | { code: 'camera_failed' }
  | { code: 'pin_locked'; untilTs: number | null }
  | { code: 'device_pending' }
  | { code: 'device_revoked' }
  | { code: 'account_inactive' }
  | { code: 'upgrade_required' }
  | { code: 'session_expired' }
  /** Today was out of date: already checked in, or not checked in yet. */
  | { code: 'conflict'; checkedIn: boolean }
  /** Offline, and this phone has no offline nonce or signed time yet (PRD 4.3.6). */
  | { code: 'offline_unavailable' }
  | { code: 'unknown'; requestId: string | null };

export type PunchFlowState =
  | { step: 'idle' }
  /** Explain before the first location request ("We check your location only when..."). */
  | { step: 'permission'; kind: PunchAction }
  /** "Finding you... 42 m accuracy" */
  | { step: 'locating'; kind: PunchAction; accuracyM: number | null }
  /** Live camera for the selfie (only when the owner requires it). */
  | {
      step: 'camera';
      kind: PunchAction;
      place: PlaceFix;
      stream: MediaStream | null;
      /** Object URL of the captured still, while reviewing it. */
      photoUrl: string | null;
      tooDark: boolean;
      /** Dark retakes so far; after 2 the person may send anyway (flagged). */
      darkTries: number;
    }
  /** "Enter your PIN" */
  | {
      step: 'pin';
      kind: PunchAction;
      place: PlaceFix;
      wrong: { triesLeft: number | null } | null;
      /** The punch goes to the owner (outside, venue): copy says so. */
      forApproval: boolean;
    }
  | { step: 'submitting'; kind: PunchAction }
  /** The server asked to confirm (week off, holiday, leave day, before the earliest time). */
  | { step: 'confirm'; kind: PunchAction; reason: PunchConfirm }
  /** The server answered: accepted, flagged (looks the same to staff), needs proof or pending. */
  | { step: 'result'; kind: PunchAction; result: PunchResult; place: PlaceFix }
  /** Saved offline; sends by itself (PRD 4.3.6). */
  | { step: 'queued'; kind: PunchAction; clientTs: number }
  /** Door QR scanner inside the sheet. */
  | { step: 'scanning'; kind: PunchAction; error: ScanError }
  /** Sent to the owner (pending): "Urmi will check it. Your time stays 10:03." */
  | { step: 'sent'; kind: PunchAction; effectiveTs: number }
  | { step: 'problem'; kind: PunchAction; problem: PunchProblem };

export interface PunchFlowActions {
  /**
   * Begin a punch. `ack` carries the confirmations the person already gave in the sheet
   * ("Check in anyway" on a week off, holiday, leave day or before the earliest time).
   */
  start(kind: PunchAction, ack: PunchAck[]): void;
  /** From the pre-permission explainer: ask for location from this tap. */
  allowLocation(): void;
  retry(): void;
  /** Take the still from the live preview the sheet shows. */
  capture(video: HTMLVideoElement | null): void;
  retake(): void;
  usePhoto(): void;
  sendWithoutPhoto(): void;
  submitPin(pin: string): void;
  /** Open the in-sheet scanner (outside / needs proof). */
  scanDoorCode(): void;
  submitDoorCode(token: string): void;
  /** "Send to Urmi for approval", with an optional note. */
  sendToOwner(note: string): void;
  /** "I'm at a venue": place name and note (PRD 4.6 B). */
  atVenue(placeName: string, note: string): void;
  close(): void;
}

export interface PunchFlow {
  state: PunchFlowState;
  actions: PunchFlowActions;
  /** True while the sheet must stay open (blocks the update prompt, PRD 11.7). */
  busy: boolean;
}
