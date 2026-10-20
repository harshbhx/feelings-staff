/**
 * Shared screen states (PRD 5 "Shared states"): skeletons that keep the layout, an inline error card
 * with one action and the request id behind "Details", and one-sentence empty states.
 */
import { ApiError, type ErrorCode } from '@fs/contracts';
import { Button, EmptyState, Icon, SkeletonList } from '@fs/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const ERROR_KEYS: Partial<Record<ErrorCode, string>> = {
  UNAVAILABLE: 'owner:errors.network',
  FORBIDDEN: 'owner:errors.forbidden',
  NOT_FOUND: 'owner:errors.notFound',
  MONTH_LOCKED: 'owner:errors.monthLocked',
  ALREADY_DECIDED: 'owner:errors.alreadyDecided',
  CONFLICT: 'owner:errors.conflict',
  DUPLICATE: 'owner:errors.duplicate',
  RATE_LIMITED: 'owner:errors.rateLimited',
  NOT_IMPLEMENTED: 'owner:errors.notReady',
  INTERNAL: 'owner:errors.server',
};

/** Plain words for an error; never a raw code. */
export function errorKey(e: unknown): string {
  if (e instanceof ApiError) return ERROR_KEYS[e.code] ?? 'owner:errors.generic';
  if (e instanceof TypeError) return 'owner:errors.network';
  return 'owner:errors.generic';
}

/** The server's safe sentence for rule answers (e.g. the 15-staff cap), else our copy. */
export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) =>
    e instanceof ApiError && (e.code === 'RULE_VIOLATION' || e.code === 'VALIDATION')
      ? e.message
      : t(errorKey(e));
}

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  // "Try again" can't help with a part of the server that isn't switched on yet.
  const canRetry = onRetry && !(error instanceof ApiError && error.code === 'NOT_IMPLEMENTED');
  return (
    <div
      role="alert"
      className="grid gap-3 rounded-md border border-border bg-bg p-5"
      data-testid="owner-error"
    >
      <p className="flex items-start gap-2 font-bold text-text">
        <Icon name="warning-circle" className="mt-1 size-5 shrink-0 text-accent" />
        <span>{t('owner:errors.title')}</span>
      </p>
      <p className="text-text-body">{t(errorKey(error))}</p>
      {canRetry ? (
        <div>
          <Button variant="secondary" size="sm" icon="arrows-clockwise" onClick={onRetry}>
            {t('owner:common.retry')}
          </Button>
        </div>
      ) : null}
      {requestId ? (
        <details className="group text-sm text-text-muted">
          <summary className="-my-2 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
            {t('owner:common.details')}
            <Icon
              name="caret-down"
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <p className="mt-1 tabular-nums">{t('owner:common.requestId', { id: requestId })}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Render a query's states: skeleton while loading, error card with Try again, the empty sentence
 * when `isEmpty` says so, else the content. Cached data keeps showing while a refetch runs.
 */
export function QueryView<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) {
    if (isEmpty?.(query.data) && empty !== undefined) return <>{empty}</>;
    return <>{children(query.data)}</>;
  }
  if (query.isError) return <ErrorCard error={query.error} onRetry={() => void query.refetch()} />;
  return <>{skeleton}</>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <EmptyState action={action} data-testid="owner-empty">
      {children}
    </EmptyState>
  );
}

/** A list of skeleton rows (avatar, two lines, trailing chip) keeping the list's layout. */
export function RowsSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
  return <SkeletonList rows={rows} trailing label={label} />;
}
