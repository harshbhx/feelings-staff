/** Loading skeleton that keeps the final layout (PRD 5 shared states: no spinners on screens). */
import { isApiError } from '@fs/contracts';
import { Button, Skeleton, SkeletonGroup } from '@fs/ui';
import { useTranslation } from 'react-i18next';

export function ScreenFallback() {
  const { t } = useTranslation();
  return (
    <>
      <div className="staff-header">
        <div className="staff-header__row">
          <Skeleton width="9rem" height="1.25rem" />
        </div>
      </div>
      <main className="staff-main">
        <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-4">
          <Skeleton width="70%" height="2rem" />
          <Skeleton shape="block" height="7rem" />
          <Skeleton shape="block" height="4rem" />
          <Skeleton width="50%" />
        </SkeletonGroup>
      </main>
    </>
  );
}

/** Inline error card in place of content: plain words, one action, request id under Details. */
export function ErrorCard({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="staff-card flex flex-col gap-3" role="alert">
      <p className="font-semibold text-text">{message}</p>
      {onRetry ? (
        <div>
          <Button size="sm" variant="secondary" icon="arrows-clockwise" onClick={onRetry}>
            {t('common:actions.tryAgain')}
          </Button>
        </div>
      ) : null}
      {requestId ? (
        <details className="text-sm text-text-muted">
          <summary className="min-h-11 cursor-pointer py-2">{t('errors:details')}</summary>
          <p>{t('errors:requestId', { id: requestId })}</p>
        </details>
      ) : null}
    </div>
  );
}

/** The error card for a failed query: what happened in words, Try again, the request id. */
export function QueryError({
  error,
  message,
  onRetry,
}: {
  error: unknown;
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const offline = isApiError(error, 'UNAVAILABLE');
  return (
    <ErrorCard
      message={offline ? t('errors:network') : message}
      requestId={isApiError(error) ? error.requestId : undefined}
      onRetry={onRetry}
    />
  );
}
