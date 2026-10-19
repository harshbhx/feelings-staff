/** Risk signals and outcomes (PRD 4.4.3-4.4.4, 14.2 "Fence and risk", S-05). */
import type { RiskInput, RiskReason } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M } from '../src/fence';
import {
  HOSTING_VPN_ASNS,
  isSuspectAsn,
  outcomeForScore,
  RISK_POINTS,
  riskScore,
  riskSignals,
} from '../src/risk';

const NOW = Date.parse('2026-10-19T10:02:00+05:30');
const HOUR = 3_600_000;
const SALON = { lat: 22.4606479, lng: 70.0565093 };
const north = (m: number) => ({
  lat: SALON.lat + (m / EARTH_RADIUS_M) * (180 / Math.PI),
  lng: SALON.lng,
});

function base(over: Partial<RiskInput> = {}): RiskInput {
  return {
    fence: 'pass',
    fix: {
      ...SALON,
      accuracy: 18,
      samples: 5,
      spreadM: 12,
      accuracySpreadM: 6,
      altitudeNullAll: false,
      speedNullAll: false,
    },
    recentFixes: [{ lat: 22.46071, lng: 70.05644 }],
    previousFix: null,
    nowTs: NOW,
    ipCountry: 'IN',
    ipAsn: 55836,
    deviceTz: 'Asia/Kolkata',
    clockSkewMs: 1200,
    deviceApprovedAt: NOW - 30 * 24 * HOUR,
    offline: false,
    salonNetworkMatch: false,
    doorQrValid: false,
    offsitePass: false,
    flagAt: 30,
    proofAt: 60,
    ...over,
  };
}

const zeroJitterFix = {
  ...SALON,
  accuracy: 10,
  samples: 3,
  spreadM: 0,
  accuracySpreadM: 0,
  altitudeNullAll: true,
  speedNullAll: true,
};

describe('S-05.1 each risk signal adds its exact points', () => {
  it('a clean punch inside the salon scores 0 with no reasons', () => {
    expect(riskScore(base())).toEqual({ score: 0, reasons: [], outcome: 'accept' });
  });

  it.each<[string, Partial<RiskInput>, RiskReason, number]>([
    ['fence uncertain', { fence: 'uncertain' }, 'fence_uncertain', 35],
    ['zero jitter', { fix: zeroJitterFix }, 'zero_jitter', 30],
    [
      'replayed point (same to 6 decimals)',
      { recentFixes: [{ lat: 22.460648, lng: 70.056509 }] },
      'replayed_point',
      25,
    ],
    [
      'impossible jump (50 km in 10 min)',
      { previousFix: { ...north(50_000), ts: NOW - 10 * 60_000 } },
      'impossible_jump',
      60,
    ],
    ['non-Indian network', { ipCountry: 'US' }, 'network_suspect', 25],
    ['hosting or VPN ASN', { ipAsn: 16509 }, 'network_suspect', 25],
    ['device time zone not IST', { deviceTz: 'Europe/London' }, 'device_tz', 15],
    ['clock ahead by more than 5 min', { clockSkewMs: 5 * 60_000 + 1 }, 'clock_skew', 15],
    ['clock behind by more than 5 min', { clockSkewMs: -(5 * 60_000 + 1) }, 'clock_skew', 15],
    [
      'device approved less than 24 h ago',
      { deviceApprovedAt: NOW - 24 * HOUR + 1 },
      'new_device',
      10,
    ],
    ['offline punch', { offline: true }, 'offline', 10],
    ['salon network match', { salonNetworkMatch: true }, 'salon_network', -30],
    ['valid door QR', { doorQrValid: true }, 'door_qr', -100],
    ['off-site duty pass', { offsitePass: true }, 'offsite_duty', 0],
  ])('%s', (_label, over, reason, points) => {
    const r = riskScore(base(over));
    expect(r.reasons).toEqual([reason]);
    expect(r.score).toBe(points);
    expect(RISK_POINTS[reason]).toBe(points);
  });

  it.each<[string, Partial<RiskInput>]>([
    ['zero jitter needs 3 samples', { fix: { ...zeroJitterFix, samples: 2 } }],
    ['zero jitter needs identical points', { fix: { ...zeroJitterFix, spreadM: 0.4 } }],
    ['zero jitter needs identical accuracy', { fix: { ...zeroJitterFix, accuracySpreadM: 1 } }],
    ['zero jitter needs null altitude', { fix: { ...zeroJitterFix, altitudeNullAll: false } }],
    ['zero jitter needs null speed', { fix: { ...zeroJitterFix, speedNullAll: false } }],
    [
      'replay: same latitude, other longitude',
      { recentFixes: [{ lat: 22.4606479, lng: 70.0566 }] },
    ],
    ['replay: other latitude', { recentFixes: [{ lat: 22.4607, lng: 70.0565093 }] }],
    ['no fix: no location signals', { fix: null, fence: 'pass', recentFixes: [{ ...SALON }] }],
    ['jump: slow walk', { previousFix: { ...north(2000), ts: NOW - HOUR } }],
    ['jump: older than 12 h', { previousFix: { ...north(500_000), ts: NOW - 12 * HOUR - 1 } }],
    [
      'jump: close in time counts as a minute',
      { previousFix: { ...north(1500), ts: NOW - 30_000 } },
    ],
    ['network: unknown country, Indian ISP', { ipCountry: null, ipAsn: 55836 }],
    ['network: nothing known', { ipCountry: null, ipAsn: null }],
    ['time zone: legacy IST alias', { deviceTz: 'Asia/Calcutta' }],
    ['time zone: unknown', { deviceTz: null }],
    ['clock: exactly 5 min', { clockSkewMs: 5 * 60_000 }],
    ['clock: unknown', { clockSkewMs: null }],
    ['device approved exactly 24 h ago', { deviceApprovedAt: NOW - 24 * HOUR }],
    ['device approval time unknown', { deviceApprovedAt: null }],
  ])('no signal: %s', (_label, over) => {
    expect(riskSignals(base(over))).toEqual([]);
  });

  it('a jump within a minute is judged as if a minute apart (3 km in 30 s is too fast)', () => {
    expect(riskSignals(base({ previousFix: { ...north(3000), ts: NOW - 30_000 } }))).toEqual([
      'impossible_jump',
    ]);
  });

  it('a previous fix later than this one (an offline punch) is compared by absolute time', () => {
    expect(riskSignals(base({ previousFix: { ...north(50_000), ts: NOW + 5 * 60_000 } }))).toEqual([
      'impossible_jump',
    ]);
  });

  it('adds signals together in table order', () => {
    const r = riskScore(
      base({
        fence: 'uncertain',
        deviceApprovedAt: NOW - HOUR,
        offline: true,
        salonNetworkMatch: true,
      }),
    );
    expect(r.reasons).toEqual(['fence_uncertain', 'new_device', 'offline', 'salon_network']);
    expect(r.score).toBe(35 + 10 + 10 - 30);
  });
});

describe('S-05.2 thresholds: 29 accepted, 30 flagged, 60 flagged, 61 needs proof', () => {
  it.each([
    [29, 'accept'],
    [30, 'flag'],
    [45, 'flag'],
    [60, 'flag'],
    [61, 'proof'],
    [-100, 'accept'],
  ] as const)('score %s -> %s', (score, outcome) => {
    expect(outcomeForScore(score, { flagAt: 30, proofAt: 60 })).toBe(outcome);
  });

  it.each([
    ['device tz + clock skew = 30', { deviceTz: 'UTC', clockSkewMs: 400_000 }, 30, 'flag'],
    ['uncertain + replayed = 60', { fence: 'uncertain', recentFixes: [{ ...SALON }] }, 60, 'flag'],
    ['uncertain + zero jitter = 65', { fence: 'uncertain', fix: zeroJitterFix }, 65, 'proof'],
    ['new device + device tz = 25', { deviceApprovedAt: NOW, deviceTz: 'UTC' }, 25, 'accept'],
  ] as const)('%s -> %s', (_label, over, score, outcome) => {
    const r = riskScore(base(over as Partial<RiskInput>));
    expect(r.score).toBe(score);
    expect(r.outcome).toBe(outcome);
  });

  it('uses the configured thresholds', () => {
    const r = riskScore(base({ deviceTz: 'UTC', flagAt: 10, proofAt: 14 }));
    expect(r.outcome).toBe('proof');
  });
});

describe('location outcome and the door QR override (S-05, S-06)', () => {
  it.each([
    ['outside without anything else blocks', { fence: 'outside' }, 'block'],
    ['approximate blocks', { fence: 'approximate' }, 'block'],
    ['no location blocks', { fence: 'none', fix: null }, 'block'],
    ['outside with a valid door QR is accepted', { fence: 'outside', doorQrValid: true }, 'accept'],
    [
      'approximate with a valid door QR is accepted',
      { fence: 'approximate', doorQrValid: true },
      'accept',
    ],
    [
      'uncertain + zero jitter with a door QR is accepted',
      { fence: 'uncertain', fix: zeroJitterFix, doorQrValid: true },
      'accept',
    ],
    [
      'an off-site duty pass with no fence is accepted',
      { fence: 'none', offsitePass: true },
      'accept',
    ],
  ] as const)('%s', (_label, over, outcome) => {
    expect(riskScore(base(over as Partial<RiskInput>)).outcome).toBe(outcome);
  });
});

describe('hosting and VPN ASN list', () => {
  it('flags listed networks and nothing else', () => {
    expect(isSuspectAsn(16509)).toBe(true);
    expect(isSuspectAsn(13335)).toBe(true);
    expect(isSuspectAsn(55836)).toBe(false);
    expect(isSuspectAsn(null)).toBe(false);
  });

  it('never lists the big Indian consumer networks', () => {
    for (const asn of [55836, 45609, 38266, 9829, 24309, 17488]) {
      expect(HOSTING_VPN_ASNS.has(asn)).toBe(false);
    }
  });
});
