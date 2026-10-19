/**
 * Frozen check-in sheet states for visual baselines and review (localhost mock mode only):
 * `/?mock=1&allowBrowser=1&sheet=locating`. Loaded lazily, so fixtures never reach the app bundle.
 */
import { PunchResult } from '@fs/contracts';
import { fixtures, variants } from '@fs/contracts/fixtures';
import type { PlaceFix, PunchAction, PunchFlowState } from './flow-types';
import type { LocalView } from './PunchSheet';

export interface FrozenSheet {
  kind: PunchAction;
  state: PunchFlowState;
  view: LocalView;
}

const SALON: PlaceFix = { type: 'salon', name: null, distanceM: 12, accuracyM: 18 };
const flow: LocalView = { view: 'flow' };

export function frozenSheet(name: string): FrozenSheet | null {
  const accepted = PunchResult.parse(fixtures.punchCreate);
  const proof = PunchResult.parse(variants.punchCreate?.['needs-proof']);
  const outAt = Date.parse('2026-10-19T20:08:22+05:30');
  const out: typeof accepted = {
    ...accepted,
    punch: { ...accepted.punch, kind: 'out', effectiveTs: outAt, serverTs: outAt },
    day: { ...accepted.day, status: 'P', workedMin: 546, lastOutTs: outAt },
    stayedAfterMin: 8,
  };
  const at = (kind: PunchAction, state: PunchFlowState, view: LocalView = flow): FrozenSheet => ({
    kind,
    state,
    view,
  });
  switch (name) {
    case 'confirm-week-off':
      return at('in', { step: 'idle' }, { view: 'confirm', reason: 'week_off' });
    case 'confirm-too-early':
      return at('in', { step: 'idle' }, { view: 'confirm', reason: 'too_early' });
    case 'permission':
      return at('in', { step: 'permission', kind: 'in' });
    case 'locating':
      return at('in', { step: 'locating', kind: 'in', accuracyM: 42 });
    case 'camera':
      return at('in', {
        step: 'camera',
        kind: 'in',
        place: SALON,
        stream: null,
        photoUrl: null,
        tooDark: false,
        darkTries: 0,
      });
    case 'pin':
      return at('in', { step: 'pin', kind: 'in', place: SALON, wrong: null, forApproval: false });
    case 'pin-wrong':
      return at('in', {
        step: 'pin',
        kind: 'in',
        place: SALON,
        wrong: { triesLeft: 3 },
        forApproval: false,
      });
    case 'submitting':
      return at('in', { step: 'submitting', kind: 'in' });
    case 'success-in':
      return at('in', { step: 'result', kind: 'in', result: accepted, place: SALON });
    case 'success-out':
      return at('out', { step: 'result', kind: 'out', result: out, place: SALON });
    case 'needs-proof':
      return at('in', { step: 'result', kind: 'in', result: proof, place: SALON });
    case 'scanning':
      return at('in', { step: 'scanning', kind: 'in', error: null });
    case 'scan-expired':
      return at('in', { step: 'scanning', kind: 'in', error: 'expired' });
    case 'sent':
      return at('in', { step: 'sent', kind: 'in', effectiveTs: proof.punch.effectiveTs });
    case 'queued':
      return at('in', { step: 'queued', kind: 'in', clientTs: Date.now() });
    case 'denied':
      return at('in', { step: 'problem', kind: 'in', problem: { code: 'location_denied' } });
    case 'timeout':
      return at('in', { step: 'problem', kind: 'in', problem: { code: 'location_timeout' } });
    case 'approximate':
      return at('in', {
        step: 'problem',
        kind: 'in',
        problem: { code: 'location_approximate', accuracyM: 1500 },
      });
    case 'outside':
      return at('in', {
        step: 'problem',
        kind: 'in',
        problem: { code: 'outside', distanceM: 340, venueAllowed: true },
      });
    case 'camera-denied':
      return at('in', { step: 'problem', kind: 'in', problem: { code: 'camera_denied' } });
    case 'pin-locked':
      return at('in', {
        step: 'problem',
        kind: 'in',
        problem: { code: 'pin_locked', untilTs: Date.parse('2026-10-19T10:57:00+05:30') },
      });
    case 'device-pending':
      return at('in', { step: 'problem', kind: 'in', problem: { code: 'device_pending' } });
    case 'fixit-location':
      return at(
        'in',
        { step: 'problem', kind: 'in', problem: { code: 'location_denied' } },
        { view: 'fixit', topic: 'location' },
      );
    case 'venue':
      return at(
        'in',
        {
          step: 'problem',
          kind: 'in',
          problem: { code: 'outside', distanceM: 340, venueAllowed: true },
        },
        { view: 'venue' },
      );
    case 'note':
      return at(
        'in',
        { step: 'result', kind: 'in', result: proof, place: SALON },
        { view: 'note' },
      );
    default:
      return null;
  }
}

export const FROZEN_SHEETS = [
  'confirm-week-off',
  'confirm-too-early',
  'permission',
  'locating',
  'camera',
  'pin',
  'pin-wrong',
  'submitting',
  'success-in',
  'success-out',
  'needs-proof',
  'scanning',
  'scan-expired',
  'sent',
  'queued',
  'denied',
  'timeout',
  'approximate',
  'outside',
  'camera-denied',
  'pin-locked',
  'device-pending',
  'fixit-location',
  'venue',
  'note',
] as const;
