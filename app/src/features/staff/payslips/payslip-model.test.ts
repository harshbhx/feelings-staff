import type { PayslipLine, PayslipView } from '@fs/contracts';
import { describe, expect, it } from 'vitest';
import { payslipSections, sortPayslips } from './payslip-model';

const line = (over: Partial<PayslipLine>): PayslipLine => ({
  code: 'salary',
  label: 'Monthly salary',
  formula: '15,000.00 for 31 days',
  amountPaise: 1500000,
  kind: 'earning',
  refId: null,
  ...over,
});

function view(lines: PayslipLine[]): PayslipView {
  return { result: { lines } } as unknown as PayslipView;
}

describe('staff payslip rows', () => {
  it('splits earnings, deductions and rounding with positive amounts', () => {
    const s = payslipSections(
      view([
        line({}),
        line({ code: 'lop', label: 'Unpaid days', amountPaise: -72581, kind: 'deduction' }),
        line({ code: 'rounding', label: 'Rounding', amountPaise: -45, kind: 'rounding' }),
      ]),
    );
    expect(s.earnings.map((r) => r.amountPaise)).toEqual([1500000]);
    expect(s.deductions.map((r) => r.amountPaise)).toEqual([72581]);
    expect(s.rounding).toHaveLength(1);
  });

  it('shows a settlement only as an adjustment: no formula, minutes or credits wording', () => {
    const s = payslipSections(
      view([
        line({
          code: 'time_credits',
          label: 'Time credits',
          formula: '483.87 × 50 min ÷ 540',
          amountPaise: 4480,
        }),
        line({ code: 'bonus', label: 'Time credits bonus', formula: '50 credits' }),
      ]),
    );
    expect(s.earnings.map((r) => r.kind)).toEqual(['adjustment', 'adjustment']);
    for (const r of s.earnings) {
      expect(r.formula).toBeNull();
      expect(r.label).toBe('');
    }
  });

  it('orders newest month first, newest revision first', () => {
    const list = [
      { month: '2026-09', revision: 1 },
      { month: '2026-10', revision: 1 },
      { month: '2026-10', revision: 2 },
    ];
    expect(sortPayslips(list)).toEqual([
      { month: '2026-10', revision: 2 },
      { month: '2026-10', revision: 1 },
      { month: '2026-09', revision: 1 },
    ]);
  });
});
