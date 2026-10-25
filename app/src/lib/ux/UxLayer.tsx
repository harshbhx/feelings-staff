/**
 * The guidance layer one shell mounts (lazily, after first paint): the first-login tour for this
 * person, once, and only inside the installed app (a browser tab on a phone never gets this far:
 * the install gate stands in front). It can be replayed from More or Me through `openGuide`.
 * Nothing shows unprompted in an automated browser (see storage.ts).
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { browserAllowed } from '../../features/staff/install/allow-browser';
import { isStandalone } from '../../pwa/push';
import { onGuide } from './bus';
import { WithUx } from './ns';
import { guidanceForced, guidanceSuppressed, readKey, writeKey } from './storage';
import { Tour, type TourStep } from './Tour';

type Role = 'staff' | 'owner';

const tourKey = (role: Role, userId: string) => `fs.ux.tour.${role}.${userId}`;

interface GuidesProps {
  audience: Role;
  userId: string;
  steps: readonly TourStep[];
  /** Path prefixes where the tour waits (a wizard with its own guidance). */
  skip: readonly string[];
}

export function UxLayer(props: GuidesProps) {
  return guidanceSuppressed() ? null : (
    <WithUx>
      <Guides {...props} />
    </WithUx>
  );
}

function Guides({ audience: role, userId, steps, skip }: GuidesProps) {
  const { pathname } = useLocation();
  const [tour, setTour] = useState(false);

  // First login: the tour, once per person, a moment after the screen has settled, inside the app.
  useEffect(() => {
    if (readKey(tourKey(role, userId)) === '1') return;
    if (!(isStandalone() || browserAllowed() || guidanceForced())) return;
    if (skip.some((p) => pathname.startsWith(p)) || pathname.startsWith('/auth')) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"]')) setTour(true);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [role, userId, pathname, skip]);

  useEffect(() => onGuide(() => setTour(true)), []);

  return tour ? (
    <Tour
      steps={steps}
      onClose={() => {
        writeKey(tourKey(role, userId), '1');
        setTour(false);
      }}
    />
  ) : null;
}
