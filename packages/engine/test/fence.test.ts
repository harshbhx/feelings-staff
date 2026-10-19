/** Fence rules (PRD 4.4.1, 14.2 "Fence and risk") and calibration (PRD 4.15.2, O-09.2). */
import type { Fix, SiteGeo } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import {
  bestFence,
  distanceBucket,
  EARTH_RADIUS_M,
  fenceCheck,
  haversineM,
  median,
  percentile,
  proposeCalibration,
} from '../src/fence';

const SALON = { lat: 22.4606479, lng: 70.0565093 };
const site = (over: Partial<SiteGeo> = {}): SiteGeo => ({
  id: '01K8WN0TQC11QKMBNWMGPP50NM',
  ...SALON,
  radiusM: 100,
  maxAccuracyM: 50,
  ...over,
});

/** A point `m` metres due north of `from` (exact along a meridian). */
function north(m: number, from: { lat: number; lng: number } = SALON) {
  return { lat: from.lat + (m / EARTH_RADIUS_M) * (180 / Math.PI), lng: from.lng };
}

const fix = (m: number, accuracy: number, from = SALON): Fix => ({
  ...north(m, from),
  accuracy,
  samples: 5,
  spreadM: 8,
  accuracySpreadM: 4,
  altitudeNullAll: false,
  speedNullAll: false,
});

describe('haversineM against known pairs (PRD 14.2)', () => {
  it.each([
    ['same point', SALON, SALON, 0, 0.001],
    [
      'the old wrong pin is about 1.1 km off',
      { lat: 22.470722, lng: 70.057711 },
      SALON,
      1126.98,
      0.01,
    ],
    [
      'one degree of longitude at the equator',
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      111195.08,
      0.01,
    ],
    ['equator to pole', { lat: 0, lng: 0 }, { lat: 90, lng: 0 }, 10007557.22, 0.01],
    ['antipodes', { lat: 0, lng: 0 }, { lat: 0, lng: 180 }, 20015114.44, 0.01],
    ['100 m due north', SALON, north(100), 100, 0.001],
  ])('%s', (_name, a, b, expected, tolerance) => {
    expect(Math.abs(haversineM(a, b) - expected)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(haversineM(b, a) - expected)).toBeLessThanOrEqual(tolerance);
  });
});

describe('fenceCheck: PASS, UNCERTAIN, OUTSIDE, APPROXIMATE at the boundaries (S-04.1)', () => {
  it.each([
    // [label, distance m, accuracy m, site overrides, expected]
    ['at the centre with a good fix', 0, 10, {}, 'pass'],
    ['just inside R with accuracy exactly A_max', 99.99, 50, {}, 'pass'],
    ['just inside R with accuracy just over A_max', 99.99, 50.01, {}, 'uncertain'],
    ['just outside R, circle overlaps', 100.01, 10, {}, 'uncertain'],
    ['d - a just under R', 159.99, 60, {}, 'uncertain'],
    ['d - a just over R', 160.01, 60, {}, 'outside'],
    ['340 m away', 340, 20, {}, 'outside'],
    ['accuracy just under 1000 m at the centre', 0, 999.99, {}, 'uncertain'],
    ['accuracy exactly 1000 m', 0, 1000, {}, 'approximate'],
    ['accuracy 1500 m far away', 5000, 1500, {}, 'approximate'],
    [
      'wide calibrated fence: 290 m with 90 m accuracy',
      290,
      90,
      { radiusM: 300, maxAccuracyM: 100 },
      'pass',
    ],
    [
      'wide fence, accuracy over its A_max',
      290,
      101,
      { radiusM: 300, maxAccuracyM: 100 },
      'uncertain',
    ],
  ] as const)('%s -> %s', (_label, d, a, over, expected) => {
    const r = fenceCheck(fix(d, a), site(over));
    expect(r.result).toBe(expected);
    expect(Math.abs(r.distanceM - d)).toBeLessThan(0.001);
  });
});

describe('bestFence: PASS on either site is enough (PRD 4.4.1, S-08.1)', () => {
  const salon = site({ id: '01K8WN0TQC11QKMBNWMGPP5SAL' });
  const venueFar = {
    ...north(3000),
    id: '01K8WN0TQC11QKMBNWMGPP5VEN',
    radiusM: 200,
    maxAccuracyM: 50,
  };

  it('returns null without sites', () => {
    expect(bestFence(fix(0, 10), [])).toBeNull();
  });

  it('picks the venue when the salon is outside', () => {
    const r = bestFence(fix(3010, 15), [salon, venueFar]);
    expect(r?.site.id).toBe(venueFar.id);
    expect(r?.check.result).toBe('pass');
  });

  it('keeps the salon when it passes and the venue does not', () => {
    const r = bestFence(fix(5, 15), [salon, venueFar]);
    expect(r?.site.id).toBe(salon.id);
    expect(r?.check.result).toBe('pass');
  });

  it('prefers UNCERTAIN over OUTSIDE', () => {
    const r = bestFence(fix(2900, 60), [salon, venueFar]);
    expect(r?.site.id).toBe(venueFar.id);
    expect(r?.check.result).toBe('uncertain');
  });

  it('breaks a tie on the result by distance, whichever comes first', () => {
    const near = site({ id: '01K8WN0TQC11QKMBNWMGPP5NER', ...north(400) });
    const far = site({ id: '01K8WN0TQC11QKMBNWMGPP5FAR', ...north(900) });
    expect(bestFence(fix(0, 10), [far, near])?.site.id).toBe(near.id);
    expect(bestFence(fix(0, 10), [near, far])?.site.id).toBe(near.id);
  });
});

describe('distanceBucket', () => {
  it.each([
    [0, '0-50'],
    [49.9, '0-50'],
    [50, '50-100'],
    [99.9, '50-100'],
    [100, '100-200'],
    [199.9, '100-200'],
    [200, '200-500'],
    [499.9, '200-500'],
    [500, '500+'],
    [12000, '500+'],
  ] as const)('%s m -> %s', (m, bucket) => {
    expect(distanceBucket(m)).toBe(bucket);
  });
});

describe('median and percentile', () => {
  it.each([
    [[5], 5],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ])('median(%j) = %s', (values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it.each([
    [[10], 0.95, 10],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 0.95, 19],
    [[3, 1, 2], 0, 1],
    [[3, 1, 2], 1, 3],
  ])('percentile(%j, %s) = %s', (values, p, expected) => {
    expect(percentile(values, p)).toBe(expected);
  });
});

describe('proposeCalibration (O-09.2: median centre, p95 + 25 m rounded up to 25, min 75, cap 300)', () => {
  const session = (offsets: [number, number][], from = SALON) =>
    offsets.map(([m, accuracyM]) => ({ ...north(m, from), accuracyM }));

  it('returns null without samples', () => {
    expect(proposeCalibration([])).toBeNull();
    expect(proposeCalibration([[], []])).toBeNull();
  });

  it('needs two sessions before it counts as enough data', () => {
    const r = proposeCalibration([
      session([
        [0, 12],
        [3, 20],
      ]),
    ]);
    expect(r?.enoughData).toBe(false);
    expect(r?.stats.sessions).toBe(1);
  });

  it('uses the median of each session best fix and never goes below 75 m', () => {
    const r = proposeCalibration([
      session([
        [10, 30],
        [2, 8],
      ]),
      session([
        [4, 10],
        [20, 40],
      ]),
      session([
        [6, 5],
        [0, 25],
      ]),
    ]);
    // best fixes are 2 m, 4 m and 6 m north; the median is 4 m north.
    expect(Math.abs(haversineM(r?.centre ?? SALON, north(4)))).toBeLessThan(0.001);
    expect(r?.radiusM).toBe(75);
    expect(r?.enoughData).toBe(true);
    expect(r?.stats).toMatchObject({ sessions: 3, samples: 6, medianAccuracyM: 17.5 });
  });

  it('adds 25 m to the p95 distance and rounds up to 25 m', () => {
    // two sessions with best fixes at 0 m and 0 m; fixes spread to 80 m
    const r = proposeCalibration([
      session([
        [0, 5],
        [80, 30],
      ]),
      session([
        [0, 6],
        [40, 30],
      ]),
    ]);
    // p95 of [0, 80, 0, 40] (nearest rank 4 of 4) is 80; 80 + 25 = 105 -> 125
    expect(r?.stats.p95DistanceM).toBe(80);
    expect(r?.radiusM).toBe(125);
  });

  it('caps the radius at 300 m', () => {
    const r = proposeCalibration([
      session([
        [0, 5],
        [600, 60],
      ]),
      session([[0, 5]]),
    ]);
    expect(r?.radiusM).toBe(300);
  });

  it('averages the two middle best fixes for an even number of sessions', () => {
    const r = proposeCalibration([session([[0, 5]]), session([[10, 5]])]);
    expect(Math.abs(haversineM(r?.centre ?? SALON, north(5)))).toBeLessThan(0.001);
  });
});
