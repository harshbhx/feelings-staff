/** Plain words for a request that did not go through (PRD 5 states, errors catalog). */
import { isApiError } from '@fs/contracts';
import type { TFunction } from 'i18next';

export function submitError(t: TFunction, e: unknown, owner: string): string {
  if (isApiError(e)) return t(`errors:code.${e.code}`, { owner });
  return t('errors:generic');
}
