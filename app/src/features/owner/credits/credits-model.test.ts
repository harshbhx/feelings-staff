import type { CreditLedger, CreditsOverview, CreditsSettleView } from '@fs/contracts';
import { fixtures } from '@fs/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  activeAdjustments,
  adjustDelta,
  balanceCounts,
  canAdjust,
  capKept,
  carriedOver,
  clampSettle,
  draftFor,
  estimateFor,
  estimateWord,
  orderRows,
  perMinute,
  roughRupees,
  settleSummary,
  signedMin,
  visibleRows,
} from './credits-model';

const overview = fixtures.ownerCredits as CreditsOverview;
const ledger = fixtures.ownerCreditLedger as CreditLedger;
const settle = fixtures.ownerPayrollCredits as CreditsSettleView;
const [jinal, neha] = settle.rows as [
  CreditsSettleView['rows'][number],
  CreditsSettleView['rows'][number],
];

describe('Time credits view models (O-29)', () => {
  it('O-29.3 minutes read +50 and −130; the estimate is whole rupees, half up', () => {
    expect(signedMin(50)).toBe('+50');
    expect(signedMin(-130)).toBe('−130');
    expect(signedMin(0)).toBe('0');
    expect(roughRupees(4480)).toBe(45);
    expect(roughRupees(-9630)).toBe(96);
    expect(roughRupees(4450)).toBe(45);
    expect(estimateWord(4480, 50)).toBe('worth');
    expect(estimateWord(-9630, -130)).toBe('cut');
    expect(estimateWord(0, 0)).toBe('none');
  });

  it('O-29.7 the Credits list sorts by balance and filters plus or minus', () => {
    const rows = [
      ...overview.staff,
      { ...overview.staff[0], userId: 'x', name: 'Asha', balanceMin: 0, estimatePaise: 0 },
    ] as CreditsOverview['staff'];
    expect(balanceCounts(rows)).toEqual({ all: 3, plus: 1, minus: 1 });
    expect(visibleRows(rows, 'all', 'minus').map((r) => r.balanceMin)).toEqual([-130, 0, 50]);
    expect(visibleRows(rows, 'all', 'plus').map((r) => r.balanceMin)).toEqual([50, 0, -130]);
    expect(visibleRows(rows, 'all', 'name').map((r) => r.name)).toEqual([
      'Asha',
      'Jinal Kotak',
      'Neha Parmar',
    ]);
    expect(visibleRows(rows, 'plus', 'minus').map((r) => r.name)).toEqual(['Neha Parmar']);
    expect(visibleRows(rows, 'minus', 'minus').map((r) => r.name)).toEqual(['Jinal Kotak']);
  });

  it('O-29.7 the ledger runs newest first on phones and in date order on desktop', () => {
    expect(orderRows(ledger.items, true).map((r) => r.date)).toEqual([
      '2026-10-17',
      '2026-10-16',
      '2026-10-05',
      '2026-10-03',
    ]);
    expect(orderRows(ledger.items, false)[0]?.date).toBe('2026-10-03');
  });

  it('O-29.10 an adjusted entry shows its active adjustments; a voided one drops out', () => {
    const early = ledger.items[1];
    expect(early && activeAdjustments(early.history).map((h) => h.minutes)).toEqual([20]);
    const voided = [
      ...(early?.history ?? []),
      {
        kind: 'void' as const,
        minutes: -20,
        reason: 'Typed the wrong day',
        by: null,
        at: 1,
        adjustmentId: early?.history[1]?.adjustmentId ?? null,
      },
    ];
    expect(activeAdjustments(voided)).toEqual([]);
    expect(ledger.items.every(canAdjust)).toBe(true);
    expect(
      canAdjust({ ...(ledger.items[0] as CreditLedger['items'][number]), kind: 'settled' }),
    ).toBe(false);
  });

  it('O-29.2 the carried-over part is the balance less this month, once this month is loaded', () => {
    // Every fixture row is in October: nothing carried over into 19 Oct.
    expect(carriedOver(ledger.items, ledger.balanceMin, '2026-10-19', true)).toBe(0);
    // In November the October rows are all earlier months.
    expect(carriedOver(ledger.items, ledger.balanceMin, '2026-11-02', false)).toBe(-20);
    // A later page may still hold October rows.
    expect(carriedOver(ledger.items, ledger.balanceMin, '2026-10-19', false)).toBeNull();
  });

  it('O-29.10 an adjustment needs whole minutes and a reason; the sign follows the choice', () => {
    expect(adjustDelta({ direction: 'add', minutes: '20', reason: 'Approved by Urmi' })).toBe(20);
    expect(adjustDelta({ direction: 'take', minutes: '15', reason: 'Left early' })).toBe(-15);
    expect(adjustDelta({ direction: 'add', minutes: '0', reason: 'Approved' })).toBeNull();
    expect(adjustDelta({ direction: 'add', minutes: '2.5', reason: 'Approved' })).toBeNull();
    expect(adjustDelta({ direction: 'add', minutes: '20', reason: ' ' })).toBeNull();
    expect(draftFor(-20, 'x')).toEqual({ direction: 'take', minutes: '20', reason: 'x' });
  });

  it('O-29.4 the stepper stays between 0 and the balance, on its side', () => {
    expect(clampSettle(-150, 100)).toBe(-100);
    expect(clampSettle(-150, 200)).toBe(-150);
    expect(clampSettle(-150, -5)).toBe(0);
    expect(clampSettle(50, 55)).toBe(50);
    expect(clampSettle(47, 45 + 5)).toBe(47);
    expect(clampSettle(50, Number.NaN)).toBe(0);
  });

  it('O-29.4 money for a choice uses the run rate once saved, the overview rate before', () => {
    const jinalRate = perMinute(jinal, overview.staff[0]);
    expect(jinalRate).toEqual({ paise: 7407, min: 100 });
    // 150 x 7407 / 100 = 11110.5: one rounding, half up, exactly.
    expect(estimateFor(-150, jinalRate as { paise: number; min: number })).toBe(-11111);
    const nehaRate = perMinute(neha, overview.staff[1]);
    expect(nehaRate).toEqual({ paise: 4480, min: 50 });
    expect(estimateFor(25, nehaRate as { paise: number; min: number })).toBe(2240);
    expect(perMinute(neha, undefined)).toBeNull();
  });

  it('O-29.4 a cut trimmed by the 50% cap keeps the rest on the balance', () => {
    expect(capKept({ settleMin: -150, appliedMin: -130 })).toBe(20);
    expect(capKept(jinal)).toBe(0);
    expect(settleSummary(settle.rows)).toEqual({
      people: 2,
      settled: 1,
      minutes: -100,
      amountPaise: -7407,
    });
  });
});
