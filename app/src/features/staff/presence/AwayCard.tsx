/**
 * The away card on Today (PRD 4.18.4, S-24.2 and S-24.3): "You're out since 15:30 · Lunch outside"
 * after Step out, or "Urmi marked you away since 15:00" after a roll-call Not here, with one note
 * for the owner. **I'm back** sits in the action bar as the one sindoor button while the person is
 * out (`useImBack`). Only times, minutes and the chosen reason; never credits or rupees.
 */
import { isApiError } from '@fs/contracts';
import { hapticTick, useToast } from '@fs/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnerName } from '../api';
import { newPresenceKey, useBack } from './api';
import { minutesOut } from './presence-model';

/** I'm back: ends the open interval (stepped out or marked away) at the server's time. */
export function useImBack() {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const toast = useToast();
  const back = useBack();
  // One key per intent: a second tap while the first is on its way repeats the same request.
  const key = useRef<string | null>(null);
  const run = () => {
    hapticTick();
    key.current ??= newPresenceKey();
    back.mutate(key.current, {
      onSuccess: (away) => {
        key.current = null;
        toast({
          tone: 'success',
          title: t('staff:presence.back.done', { count: minutesOut(away) }),
        });
      },
      onError: (err) => {
        // No answer (offline, dropped reply): keep the key so a retry cannot repeat the action.
        if (!isApiError(err, 'UNAVAILABLE')) key.current = null;
        toast({
          tone: 'error',
          title: isApiError(err, 'UNAVAILABLE')
            ? t('errors:network')
            : isApiError(err, 'CONFLICT')
              ? t('staff:presence.errors.notOut', { owner })
              : t('errors:generic'),
        });
      },
    });
  };
  return { run, busy: back.isPending };
}
