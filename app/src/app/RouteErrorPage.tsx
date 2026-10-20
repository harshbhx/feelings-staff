/** Root route error page: a chunk-load failure reloads once by itself; anything else is a friendly card. */
import { Button } from '@fs/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { isChunkError, recoverFromStaleChunk } from '../pwa/chunk-reload';

/** A chunk-load failure reloads once by itself (the guard in chunk-reload.ts). */
export function useStaleChunkRecovery(error: unknown): void {
  useEffect(() => {
    if (isChunkError(error)) recoverFromStaleChunk();
  }, [error]);
}

export function RouteErrorPage() {
  const { t } = useTranslation('common');
  useStaleChunkRecovery(useRouteError());
  return (
    <main
      role="alert"
      className="mx-auto grid min-h-dvh max-w-sm content-center gap-3 p-6"
      data-testid="route-error"
    >
      <h1 className="text-xl font-bold text-text">{t('app.errorTitle')}</h1>
      <p className="text-text-body">{t('app.errorBody')}</p>
      <div>
        <Button onClick={() => window.location.reload()}>{t('app.reload')}</Button>
      </div>
    </main>
  );
}
