/**
 * Small pieces shared by the credits screens: the kind chip (tint, icon and word), signed minutes,
 * and the estimate in words ("worth about ₹45", "might cut around ₹96"), never a bare number.
 */
import type { CreditLedgerKind } from '@fs/contracts';
import { Badge } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { money } from '../lib/format';
import { estimateWord, KIND_BADGE, roughRupees, signedMin } from './credits-model';

export function KindBadge({ kind }: { kind: CreditLedgerKind | 'adjusted' }) {
  const { t } = useTranslation();
  const b = KIND_BADGE[kind];
  return (
    <Badge tone={b.tone} icon={b.icon}>
      {t(`owner:credits.kinds.${kind}`)}
    </Badge>
  );
}

/** `+50 min`, `−130 min`. */
export function useMinText() {
  const { t } = useTranslation();
  return (min: number) => t('owner:credits.min', { value: signedMin(min) });
}

/** "worth about ₹45" for plus, "might cut around ₹96" for minus, at 1x (PRD 4.19.1). */
export function useEstimateText() {
  const { t } = useTranslation();
  return (paise: number, min: number) => {
    const word = estimateWord(paise, min);
    if (word === 'none') return t('owner:credits.even');
    const m = money(roughRupees(paise) * 100);
    return word === 'worth'
      ? t('owner:credits.worth', { money: m })
      : t('owner:credits.cut', { money: m });
  };
}

/** Bold signed minutes for tables and row ends, tinted only by weight (status words carry colour). */
export function Balance({ min, className }: { min: number; className?: string }) {
  const text = useMinText();
  return (
    <span className={`whitespace-nowrap font-bold text-text tabular-nums ${className ?? ''}`}>
      {text(min)}
    </span>
  );
}
