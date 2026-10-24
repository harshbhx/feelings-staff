/**
 * The staff shell (PRD 5.1, 12.5): install gate in a browser tab, otherwise the app with its tab
 * bar, update toast and upgrade screen. Each screen renders its own `ScreenHeader` (title, bell,
 * banners) and, when it has one, its `ActionBar` with the one sindoor button.
 */
import { applyDocumentLang } from '@fs/i18n/fonts';
import { ToastProvider } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { mockChoice, useApi } from '../../../api/provider';
import { saveLang } from '../../../app/i18n';
import { onQueueEvent, setResigner, startQueue } from '../../../pwa/queue';
import { ensurePersisted } from '../../../pwa/storage';
import { staffKeys, useStaffMe } from '../api';
import { browserAllowed } from '../install/allow-browser';
// Catches `beforeinstallprompt` from the first moment, before the lazy gate chunk arrives.
import '../install/prompt';
import { currentInstallContext } from '../install/platform';
import '../staff.css';
import { ScreenFallback } from './ScreenFallback';
import { StaffTabBar } from './StaffTabBar';
import { UpdateToast, UpgradeOverlay } from './UpdatePrompts';

/** Only a browser tab ever shows it (with the QR encoder for computers), so it is its own chunk. */
const InstallGate = lazy(() =>
  import('../install/InstallGate').then((m) => ({ default: m.InstallGate })),
);

export function StaffShell() {
  const context = useMemo(currentInstallContext, []);
  const allowed = context === 'standalone' || browserAllowed();
  if (!allowed)
    return (
      <Suspense fallback={null}>
        <InstallGate context={context} url={`${window.location.origin}/`} />
      </Suspense>
    );
  return <StaffApp standalone={context === 'standalone'} />;
}

function StaffApp({ standalone }: { standalone: boolean }) {
  useStaffBoot(standalone);
  return (
    <ToastProvider bottomOffset="calc(var(--tabbar-h) + var(--app-bar-h) + env(safe-area-inset-bottom) + 0.5rem)">
      <div className="staff-frame">
        <Suspense fallback={<ScreenFallback />}>
          <Outlet />
        </Suspense>
      </div>
      <StaffTabBar />
      <UpdateToast />
      <UpgradeOverlay />
    </ToastProvider>
  );
}

/** Offline queue, storage persistence and language sync (main.tsx starts the service worker). */
function useStaffBoot(standalone: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  const me = useStaffMe();
  const { i18n } = useTranslation();

  useEffect(() => {
    // The re-signer (409 NONCE_INVALID) needs the device key and the punch adapters, both only
    // reached from here (PRD 11.10: keep them out of the staff initial chunk). Set it before the
    // queue starts, so the first flush never races it.
    let cancelled = false;
    let stopQueue: (() => void) | null = null;
    const off = onQueueEvent((e) => {
      if (e.type === 'synced') void qc.invalidateQueries({ queryKey: staffKeys.all });
    });
    void Promise.all([
      import('../../../lib/punch/adapters'),
      import('../../../lib/punch/resign'),
    ]).then(
      ([adapters, resign]) => {
        if (cancelled) return;
        setResigner(resign.createPunchResigner({ api, getSigner: adapters.deviceSigner }));
        stopQueue = startQueue(api);
      },
      () => {
        // A chunk that will not load (stale hash after a deploy) must not strand queued punches:
        // flush without the re-signer; a 409 NONCE_INVALID then stays queued for the next start.
        if (!cancelled) stopQueue = startQueue(api);
      },
    );
    return () => {
      cancelled = true;
      off();
      stopQueue?.();
      setResigner(null);
    };
  }, [api, qc]);

  useEffect(() => {
    // PRD 4.3.6: keep this phone ready to check in offline (two offline nonces, the PIN-sealing key,
    // a signed server time), on open and whenever the app comes back to the front.
    if (mockChoice()) return;
    const load = () =>
      Promise.all([import('../../../lib/punch/offline'), import('../../../lib/punch/adapters')]);
    const prepare = () => {
      void load().then(([offline, adapters]) => {
        void offline.ensureOfflineReady(api, adapters.idbPunchStore);
        void offline.refreshTimeAnchor(api, adapters.idbPunchStore);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') prepare();
    };
    prepare();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [api]);

  useEffect(() => {
    // Pull to refresh (iOS layer): refetches what is on screen. Its own chunk, after first paint.
    let off: (() => void) | undefined;
    let gone = false;
    void import('../../../lib/pull-refresh').then((m) => {
      if (!gone)
        off = m.attachPullRefresh(
          () => qc.refetchQueries({ type: 'active' }),
          i18n.t('common:states.refreshing'),
        );
    });
    return () => {
      gone = true;
      off?.();
    };
  }, [qc, i18n]);

  useEffect(() => {
    // PRD 4.1.4, 11.8: persist storage once installed so the device key and queue survive.
    if (standalone) void ensurePersisted();
  }, [standalone]);

  // The person's language lives on the server (PATCH /me); follow it on every device.
  const lang = me.user.lang;
  useEffect(() => {
    if (i18n.language !== lang) {
      void i18n.changeLanguage(lang);
      saveLang(lang);
    }
    applyDocumentLang(lang);
  }, [i18n, lang]);
}
