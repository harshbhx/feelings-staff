import { lazy, Suspense, useEffect, useState } from 'react';
import { guidanceSuppressed } from './storage';
import type { TourStep } from './Tour';

const UxLayer = lazy(() => import('./UxLayer').then((m) => ({ default: m.UxLayer })));

/**
 * Mounts the guidance layer two seconds after the shell, as its own chunk, so nothing about the
 * tour or the install guide is in the first paint. Does nothing in automated browsers.
 */
export function LazyUx({
  audience,
  userId,
  steps,
}: {
  audience: 'staff' | 'owner';
  userId: string | undefined;
  steps: readonly TourStep[];
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Always schedule the mount (guidance on demand from More or Me still needs the layer), but
    // an automated browser only gets it when asked for with ?guide=1.
    if (guidanceSuppressed()) return;
    const id = window.setTimeout(() => setReady(true), 2000);
    return () => window.clearTimeout(id);
  }, []);
  if (!ready || !userId) return null;
  return (
    <Suspense fallback={null}>
      <UxLayer role={audience} userId={userId} steps={steps} />
    </Suspense>
  );
}
