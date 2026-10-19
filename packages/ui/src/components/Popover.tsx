import { Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PopoverProps {
  /** The element that opens it (a `Button` or `IconButton`). */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  /** Accessible name for the panel when its content has no heading. */
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

/** A small panel anchored to its trigger (Radix Popover): white, hairline, `--shadow-md`. */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  'aria-label': ariaLabel,
  className,
}: PopoverProps) {
  return (
    <RPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          className={cx('fs-popover', 'fs-popover--panel', className)}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={ariaLabel}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export interface TooltipProps {
  /** The short text ("Late 25 m · in 10:25 · out 20:04"). */
  content: ReactNode;
  /** One focusable element; the tooltip describes it. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  /** Kit previews: show it without hover. */
  defaultOpen?: boolean | undefined;
}

/**
 * Extra detail on hover or focus (Radix Tooltip): ink with white text. Never the only place a
 * fact lives, since touch screens rarely show it.
 */
export function Tooltip({ content, children, side = 'top', defaultOpen }: TooltipProps) {
  return (
    <RTooltip.Provider delayDuration={300}>
      <RTooltip.Root defaultOpen={defaultOpen}>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content className="fs-tooltip" side={side} sideOffset={6}>
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
