/** Root route error page: a chunk-load failure reloads once by itself; anything else is a friendly card. */
import { Button } from '@fs/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { isChunkError, recoverFromStaleChunk } from '../pwa/chunk-reload';

/** True while a stale-chunk reload is under way (the page is about to be replaced). */
export function useStaleChunkRecovery(error: unknown): boolean {
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (isChunkError(error) && recoverFromStaleChunk()) setRecovering(true);
  }, [error]);
  return recovering;
}

export function RouteErrorPage() {
  const { t } = useTranslation('common');
  const recovering = useStaleChunkRecovery(useRouteError());
  return (
    <main
      role="alert"
      className="mx-auto grid min-h-dvh max-w-sm content-center gap-3 p-6"
      data-testid="route-error"
    >
      <h1 className="text-xl font-bold text-text">
        {recovering ? t('app.updatingTitle') : t('app.errorTitle')}
      </h1>
      <p className="text-text-body">{recovering ? t('app.updatingBody') : t('app.errorBody')}</p>
      {recovering ? null : (
        <div>
          <Button onClick={() => window.location.reload()}>{t('app.reload')}</Button>
        </div>
      )}
    </main>
  );
}
