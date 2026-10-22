/**
 * Root route error page. A chunk-load failure reloads once by itself (public/recover.js); anything
 * else is one of two calm screens: "You're offline" (the phone has no connection, so the page or its
 * data could not load; it retries by itself when the connection returns) or "Something went wrong"
 * with a retry and a hint to tell the owner. Copy is in the bundled `errors` catalog so the page
 * itself never needs a download.
 */
import { Bindi, Button } from '@fs/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { useOfflineState } from '../pwa/offline';
import { useStaleChunkRecovery } from './useStaleChunkRecovery';

function seenAt(): string {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

export function ErrorBoundary() {
  const { t } = useTranslation(['errors', 'common']);
  useStaleChunkRecovery(useRouteError());
  const { online } = useOfflineState();
  useEffect(() => {
    if (online) return;
    const back = () => window.location.reload();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [online]);
  const kind = online ? 'crash' : 'offline';
  return (
    <main
      role="alert"
      className="mx-auto grid min-h-dvh max-w-sm content-center gap-3 p-6 sm:justify-items-center sm:text-center"
      data-testid="route-error"
      data-kind={kind}
    >
      <h1 className="text-2xl font-extrabold text-text">
        {t(`errors:${kind}.title`)}
        <Bindi size="heading" />
      </h1>
      <p className="text-text-body">{t(`errors:${kind}.body`)}</p>
      <div>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('common:actions.tryAgain')}
        </Button>
      </div>
      {online ? (
        <p className="text-sm text-text-muted" data-testid="route-error-stamp">
          {t('errors:crash.stamp', { time: seenAt() })}
        </p>
      ) : null}
    </main>
  );
}
