/**
 * Slim banners under the header (PRD 5 shared states, 4.3.6): offline with the time of the data
 * on screen, check-ins waiting to send, and a failed queue item ("Tap to see why").
 */
import { Banner, Button } from '@fs/ui';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOfflineState } from '../../../pwa/offline';
import { useQueue } from '../../../pwa/queue';
import { useFmt } from '../lib/format';

/** Opened from a banner only, so it is its own chunk. */
const QueueSheet = lazy(() => import('./QueueSheet').then((m) => ({ default: m.QueueSheet })));

export function ShellBanners({ dataAt }: { dataAt?: number | undefined }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const offline = useOfflineState();
  const queue = useQueue();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);

  const showOffline = !offline.online || offline.cachedAt !== null;
  const shownAt = offline.cachedAt ?? dataAt ?? null;

  return (
    <>
      {showOffline ? (
        <Banner icon="wifi-slash" live>
          {shownAt
            ? t('staff:shell.offline', { time: fmt.clock(shownAt) })
            : t('staff:shell.offlineShort')}
        </Banner>
      ) : null}
      {queue.failed > 0 ? (
        <Banner icon="warning-circle" live>
          <button
            type="button"
            className="min-h-11 w-full text-left font-semibold underline underline-offset-4"
            onClick={() => setOpen(true)}
          >
            {t('staff:shell.queueFailed', { count: queue.failed })}
          </button>
        </Banner>
      ) : queue.waiting > 0 ? (
        <Banner
          icon="hourglass"
          live
          action={
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              {t('staff:queue.title')}
            </Button>
          }
        >
          {t('staff:shell.queued', { count: queue.waiting })}
        </Banner>
      ) : null}
      {mounted ? (
        <Suspense fallback={null}>
          <QueueSheet open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
