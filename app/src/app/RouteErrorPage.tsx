/** Root route error page: a chunk-load failure reloads once by itself; anything else is a friendly card. */
import { Button } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { useStaleChunkRecovery } from './useStaleChunkRecovery';

export function ErrorBoundary() {
  const { t } = useTranslation('errors');
  useStaleChunkRecovery(useRouteError());
  return (
    <main
      role="alert"
      className="mx-auto grid min-h-dvh max-w-sm content-center gap-3 p-6"
      data-testid="route-error"
    >
      <h1 className="text-xl font-bold text-text">{t('loadFailed')}</h1>
      <p className="text-text-body">{t('generic')}</p>
      <div>
        <Button onClick={() => window.location.reload()}>{t('reload')}</Button>
      </div>
    </main>
  );
}
