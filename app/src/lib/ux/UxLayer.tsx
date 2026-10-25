/**
 * The guidance layer one shell mounts (lazily, after first paint): the first-login tour for this
 * person, then, in a browser tab, the install guide at a quiet moment. Both can be reopened from
 * More or Me through `openGuide`. Neither ever shows in an automated browser (see storage.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { currentInstallContext } from '../../features/staff/install/platform';
import { useInstallPrompt } from '../../features/staff/install/prompt';
import { onGuide } from './bus';
import { InstallSheet } from './InstallSheet';
import { guidanceSuppressed, readKey, writeKey } from './storage';
import { type TourStep, Tour } from './Tour';

type Role = 'staff' | 'owner';

const DAY = 24 * 60 * 60 * 1000;
const tourKey = (role: Role, userId: string) => `fs.ux.tour.${role}.${userId}`;
const INSTALL_KEY = 'fs.ux.install';

/** `null` = may show; a number = snoozed until then; 'never' = the person said stop. */
function installBlocked(now: number): boolean {
  const v = readKey(INSTALL_KEY);
  if (v === 'never') return true;
  const until = Number(v);
  return Number.isFinite(until) && until > now;
}

export function UxLayer({
  role,
  userId,
  steps,
}: {
  role: Role;
  userId: string;
  steps: readonly TourStep[];
}) {
  const { pathname } = useLocation();
  const [tour, setTour] = useState(false);
  const [install, setInstall] = useState(false);
  const moves = useRef(0);
  const first = useRef(pathname);
  const prompt = useInstallPrompt();
  const context = currentInstallContext();
  const platform = context === 'ios-safari' ? 'ios' : context === 'android' ? 'android' : null;

  // Count screens the person has opened: the install guide waits for a second one.
  useEffect(() => {
    if (pathname !== first.current) moves.current += 1;
  }, [pathname]);

  // First login: the tour, once per person, a moment after the screen has settled.
  useEffect(() => {
    if (guidanceSuppressed() || readKey(tourKey(role, userId)) === '1') return;
    if (pathname.startsWith('/o/setup') || pathname.startsWith('/auth')) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"]')) setTour(true);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [role, userId, pathname]);

  // The install guide: browser tab only, after the tour, once the person has moved around a little.
  useEffect(() => {
    if (guidanceSuppressed() || !platform || tour) return;
    if (readKey(tourKey(role, userId)) !== '1' || installBlocked(Date.now())) return;
    if (platform === 'android' && !prompt.available) return;
    const id = window.setTimeout(() => {
      if (moves.current >= 2 && !document.querySelector('[role="dialog"]')) setInstall(true);
    }, 4000);
    return () => window.clearTimeout(id);
  }, [platform, role, userId, tour, prompt.available, pathname]);

  useEffect(
    () =>
      onGuide((kind) => {
        if (kind === 'tour') setTour(true);
        else setInstall(true);
      }),
    [],
  );

  return (
    <>
      {tour ? (
        <Tour
          steps={steps}
          onClose={() => {
            writeKey(tourKey(role, userId), '1');
            setTour(false);
          }}
        />
      ) : null}
      {install ? (
        <InstallSheet
          open
          platform={platform ?? 'ios'}
          onClose={(choice) => {
            writeKey(INSTALL_KEY, choice === 'never' ? 'never' : String(Date.now() + (choice === 'done' ? 30 : 7) * DAY));
            setInstall(false);
          }}
        />
      ) : null}
    </>
  );
}
