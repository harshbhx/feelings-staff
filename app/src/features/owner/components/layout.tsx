/** Small layout pieces shared by owner screens: sections with an h2, a muted meta line, a ticking clock. */
import { type ReactNode, useEffect, useId, useState } from 'react';

/**
 * For a ListRow whose trailing chips or buttons would squeeze the name: below about 10rem of text the
 * trailing part moves to its own line, right-aligned, instead of breaking the name letter by letter.
 */
export const WRAP_ROW = 'flex-wrap [&>.fs-row__text]:basis-[10rem] [&>.fs-row__trailing]:ml-auto';

export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: ReactNode;
  count?: number | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className ?? 'grid gap-2'}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-bold text-lg text-text tracking-name">
          {title}
          {count !== undefined ? (
            <span className="ml-2 font-semibold text-sm text-text-muted tabular-nums">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm text-text-muted ${className ?? ''}`}>{children}</p>;
}

/** A neutral pill for words that are not statuses ("Inside", "Edge", "Added by you"). */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-full border border-border-strong px-2.5 font-bold text-text-body text-xs">
      {children}
    </span>
  );
}

/** Client clock that ticks every `everyMs` (live hours on Today update each minute). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
