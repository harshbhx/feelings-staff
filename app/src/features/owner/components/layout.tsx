/** Small layout pieces shared by owner screens: sections with an h2, a muted meta line, a ticking clock. */
import { type ReactNode, useEffect, useId, useState } from 'react';
import './rows.css';

/** For a ListRow whose trailing chips or buttons would squeeze the name (see rows.css). */
export const WRAP_ROW = 'owner-wrap-row';

/** Filter chips that scroll on phones and wrap from 64rem (see rows.css). */
export const CHIPS_WRAP = 'owner-chips-wrap';

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

/**
 * One part of a quiet line: a string, or a node with a key (a word set in bold, free text that may
 * wrap inside itself with `wrap`).
 */
export type LinePart =
  | string
  | { key: string; node: ReactNode; wrap?: boolean | undefined }
  | null
  | undefined
  | false;

/**
 * "Stylist · FBC-003 · 98250 11201": a line may break between the parts, never inside a code or a
 * phone number, and the dot stays at the end of a line, never the start of the next. Each part is
 * its own element, so the words can be found without the dot.
 */
export function NoBreakParts({ parts }: { parts: readonly LinePart[] }) {
  const shown = parts.filter((p): p is Exclude<LinePart, null | undefined | false> => Boolean(p));
  return (
    <>
      {shown.map((p, i) => {
        const last = i === shown.length - 1;
        return (
          <span key={typeof p === 'string' ? p : p.key}>
            <span className={typeof p !== 'string' && p.wrap ? undefined : 'whitespace-nowrap'}>
              <span>{typeof p === 'string' ? p : p.node}</span>
              {last ? null : ' ·'}
            </span>
            {last ? null : ' '}
          </span>
        );
      })}
    </>
  );
}

/**
 * A quiet word that is not a status ("Phone", "Kiosk"). Square-ish corners so it never reads as a
 * button; for words with a meaning by colour use the kit's `Badge` (WP-10).
 */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-sm border border-border-strong bg-bg px-2 font-bold text-text-body text-xs">
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
