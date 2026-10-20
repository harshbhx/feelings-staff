/**
 * Shown in place of an owner screen that crashed or whose code could not be loaded (for example
 * after an update replaced the old files). The shell, tabs and rail stay, so Urmi can move on; the
 * error text sits behind "Details" for support (PRD 5 shared states: never a raw error up front).
 */
import { Button } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { useStaleChunkRecovery } from '../../../app/RouteErrorPage';

export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  useStaleChunkRecovery(error);
  const detail = error instanceof Error ? error.message : null;
  return (
    <div
      role="alert"
      className="grid gap-3 rounded-md border border-border bg-bg p-5"
      data-testid="owner-route-error"
    >
      <p className="font-bold text-text">{t('owner:errors.screenTitle')}</p>
      <p className="text-text-body">{t('owner:errors.screenBody')}</p>
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon="arrows-clockwise"
          onClick={() => window.location.reload()}
        >
          {t('owner:errors.reload')}
        </Button>
      </div>
      {detail ? (
        <details className="text-sm text-text-muted">
          <summary className="cursor-pointer">{t('owner:common.details')}</summary>
          <p className="mt-1 break-words">{detail}</p>
        </details>
      ) : null}
    </div>
  );
}
