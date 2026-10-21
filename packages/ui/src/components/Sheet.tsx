import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../lib/cx';
import { IconButton } from './Button';

export interface SheetProps {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** An element that opens the sheet (usually a `Button`). */
  trigger?: ReactNode;
  /** The sheet's heading. Always present for screen readers; `titleHidden` hides it visually. */
  title: ReactNode;
  titleHidden?: boolean | undefined;
  description?: ReactNode;
  /** Actions pinned to the bottom of the sheet (the one primary action, plus a secondary). */
  footer?: ReactNode;
  /**
   * Whether Escape, the backdrop and the close button dismiss it. Turn off while a punch is in
   * flight, so it cannot be lost halfway.
   */
  dismissible?: boolean | undefined;
  /** Render into this element instead of `document.body` (the kit's phone frames). */
  container?: HTMLElement | null | undefined;
  /** `false` keeps the page interactive (kit previews). Default `true`: focus is trapped. */
  modal?: boolean | undefined;
  /** Skip moving focus into the sheet on open (kit previews only). */
  noAutoFocus?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

/**
 * Bottom sheet on phones, centred dialog from 48rem (Radix Dialog). Drag handle, `--shadow-md`,
 * slide-up 220 ms (a fade with reduced motion). Focus is trapped and returns to the trigger.
 */
export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  titleHidden = false,
  description,
  footer,
  dismissible = true,
  container,
  modal = true,
  noAutoFocus = false,
  className,
  children,
}: SheetProps) {
  const { t } = useTranslation();
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <Dialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal container={container}>
        {modal ? <Dialog.Overlay className="fs-sheet-overlay" /> : null}
        <Dialog.Content
          className={cx('fs-sheet', className)}
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          // A dismissible sheet opens with focus on itself, not on its close button: the X is not
          // the thing to do, and a ring on it at open read as a red action (docs/ui-redesign-plan.md,
          // problem 9). Tab reaches it next. Without a close button Radix focuses the first control.
          onOpenAutoFocus={
            noAutoFocus
              ? (e) => e.preventDefault()
              : dismissible
                ? (e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement | null)?.focus();
                  }
                : undefined
          }
          // Without a description Radix wants an explicit "none" (it warns otherwise).
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="fs-sheet__handle" aria-hidden="true" />
          <div className="fs-sheet__head">
            <Dialog.Title className={cx('fs-sheet__title', titleHidden && 'sr-only')}>
              {title}
            </Dialog.Title>
            {dismissible ? (
              <Dialog.Close asChild>
                <IconButton icon="x" label={t('ui:sheet.close')} className="fs-sheet__close" />
              </Dialog.Close>
            ) : null}
          </div>
          {description ? (
            <Dialog.Description className="fs-sheet__desc">{description}</Dialog.Description>
          ) : null}
          <div className="fs-sheet__body">{children}</div>
          {footer ? <div className="fs-sheet__footer">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
