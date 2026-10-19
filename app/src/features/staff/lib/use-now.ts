/** A clock that re-renders on each minute boundary (live hours on Today, PRD 5.1 / S-10.1). */
import { useEffect, useState } from 'react';

export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const t = Date.now();
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        stepMs - (t % stepMs) + 50,
      );
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stepMs]);
  return now;
}
