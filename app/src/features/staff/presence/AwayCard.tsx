/**
 * The away card on Today (PRD 4.18.4, S-24.2 and S-24.3): "You're out since 15:30 · Lunch outside"
 * after Step out, or "Urmi marked you away since 15:00" after a roll-call Not here, with one note
 * for the owner. **I'm back** sits in the action bar as the one sindoor button while the person is
 * out (`useImBack`). Only times, minutes and the chosen reason; never credits or rupees.
 */
import { hapticTick, useToast } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../../api/provider';
import { useOwnerName } from '../api';

/** I'm back: the work is in `im-back.ts`, loaded on the first tap. */
export function useImBack() {
  const { i18n } = useTranslation();
  const owner = useOwnerName();
  const toast = useToast();
  const api = useApi();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = () => {
    hapticTick();
    setBusy(true);
    void import('./im-back')
      .then((m) => m.imBack({ api, qc, toast, i18n, owner }))
      .finally(() => setBusy(false));
  };
  return { run, busy };
}
