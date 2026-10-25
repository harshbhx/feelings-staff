import { type ReactNode, useEffect, useState } from 'react';
import { guidanceSuppressed } from './storage';

/**
 * Renders its children two seconds after the shell, so the tour and the install guide (their own
 * chunks) are never part of the first paint. An automated browser gets them only with `?guide=1`.
 */
export function Delayed({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (guidanceSuppressed()) return;
    const id = window.setTimeout(() => setReady(true), 2000);
    return () => window.clearTimeout(id);
  }, []);
  return ready ? children : null;
}
