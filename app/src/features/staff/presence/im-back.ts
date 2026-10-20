/**
 * I'm back (PRD 4.18.4): ends the open interval (stepped out or marked away) at the server's time.
 * Loaded when the button is tapped, so none of this sits in the staff shell chunk (PRD 11.10).
 */

import type { PresenceState } from '@fs/contracts';
import { isApiError } from '@fs/contracts';
import type { useToast } from '@fs/ui';
import type { QueryClient } from '@tanstack/react-query';
import type { i18n as I18n } from 'i18next';
import type { useApi } from '../../../api/provider';
import { presenceKey } from './api';
import { minutesOut } from './presence-model';

// One key per intent: a second tap while the first is on its way repeats the same request.
let key: string | null = null;

export async function imBack(d: {
  api: ReturnType<typeof useApi>;
  qc: QueryClient;
  toast: ReturnType<typeof useToast>;
  i18n: I18n;
  owner: string;
}): Promise<void> {
  const { api, qc, toast, i18n, owner } = d;
  await i18n.loadNamespaces('presence');
  const t = i18n.t.bind(i18n);
  key ??= crypto.randomUUID();
  const k = key;
  try {
    const away = await api.presenceBack({ body: { idempotencyKey: k } }, { idempotencyKey: k });
    key = null;
    qc.setQueryData<PresenceState>(presenceKey, (prev) => {
      if (!prev) return prev;
      const { openAway: _old, ...rest } = prev;
      return rest;
    });
    toast({ tone: 'success', title: t('presence:back.done', { count: minutesOut(away) }) });
  } catch (err) {
    // No answer (offline, dropped reply): keep the key so a retry cannot repeat the action.
    if (!isApiError(err, 'UNAVAILABLE')) key = null;
    toast({
      tone: 'error',
      title: isApiError(err, 'UNAVAILABLE')
        ? t('errors:network')
        : isApiError(err, 'CONFLICT')
          ? t('presence:errors.notOut', { owner })
          : t('errors:generic'),
    });
  }
}
