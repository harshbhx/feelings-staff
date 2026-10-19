import { Tabs as RTabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** A count after the label ("Leave 2"). */
  count?: number | string | undefined;
  content: ReactNode;
  disabled?: boolean | undefined;
}

export interface TabsProps {
  /** Names the tab list ("Requests"). */
  label: string;
  items: readonly TabItem[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /**
   * `segmented` (default): a blush track with the active segment in white (Leave · Fixes).
   * `underline`: text tabs over a hairline with an ink rule (the staff profile).
   */
  variant?: 'segmented' | 'underline' | undefined;
  className?: string | undefined;
}

/** Tabs (Radix): arrow keys move between tabs, Tab moves into the panel. */
export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  variant = 'segmented',
  className,
}: TabsProps) {
  return (
    <RTabs.Root
      className={cx('fs-tabs', className)}
      data-variant={variant}
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      activationMode="manual"
    >
      <RTabs.List className="fs-tabs__list" aria-label={label}>
        {items.map((it) => (
          <RTabs.Trigger
            key={it.value}
            value={it.value}
            disabled={it.disabled}
            className="fs-tabs__trigger"
          >
            {it.label}
            {it.count !== undefined ? <span className="fs-tabs__count">{it.count}</span> : null}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((it) => (
        <RTabs.Content key={it.value} value={it.value} className="fs-tabs__panel">
          {it.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
