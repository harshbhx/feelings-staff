/**
 * iOS navigation bar state (iOS layer): true once `ref` has moved above the bar, so the bar can turn
 * from clear to the material and show its small title. One IntersectionObserver, no scroll listener;
 * without the API the bar simply stays clear.
 */
import { type RefObject, useEffect, useState } from 'react';

export function useUnderBar(ref: RefObject<HTMLElement | null>): boolean {
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => setUnder(!!e && !e.isIntersecting && e.boundingClientRect.top < 80),
      { rootMargin: '-52px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return under;
}
