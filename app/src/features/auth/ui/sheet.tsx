/**
 * Bottom sheet on phones, centred dialog from 48rem (PRD 12.6 `Sheet`), on the native modal
 * `<dialog>`: focus is trapped and restored by the browser, Escape cancels, the page behind is
 * inert. Slides up 220 ms (none with reduced motion). Swapped for `@fs/ui`'s Sheet when it lands.
 */
import { type ReactNode, useEffect, useRef } from 'react';

export function Sheet({
  open,
  onCancel,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onCancel: () => void;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-full overflow-y-auto rounded-t-lg border border-border bg-bg p-0 text-text-body shadow-md transition-[translate,opacity] duration-220 ease-out backdrop:bg-[var(--scrim-soft)] starting:translate-y-6 starting:opacity-0 motion-reduce:transition-none md:m-auto md:max-w-[26rem] md:rounded-lg"
    >
      <div className="px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-8">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 h-1 w-10 rounded-full bg-border-strong md:hidden"
        />
        {children}
      </div>
    </dialog>
  );
}
