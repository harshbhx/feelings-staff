/**
 * Scan (`/scan`, PRD 4.5, 5.1): attach the door code to a check-in that is waiting for proof. The
 * punch keeps its first server time (PRD 4.3.3). A new check-in with a door code goes through the
 * check-in sheet instead (it needs the PIN).
 */
import { canonicalJson, isApiError } from '@fs/contracts';
import { Button, EmptyState } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { mockChoice, useApi } from '../../../api/provider';
import { sign } from '../../../lib/device-key';
import { staffKeys, useToday } from '../api';
import { useFmt } from '../lib/format';
import { ScreenFallback } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { type ScanError, ScanPanel } from './ScanPanel';

const PROOF_REASONS = new Set(['needs_proof', 'outside_fence', 'strong_mode']);

export function ScanScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const api = useApi();
  const qc = useQueryClient();
  const today = useToday();
  const [error, setError] = useState<ScanError>(null);
  const [busy, setBusy] = useState(false);
  const [doneAt, setDoneAt] = useState<number | null>(null);

  if (!today.data) return <ScreenFallback />;
  const pending = [...today.data.punches]
    .reverse()
    .find((p) => p.status === 'pending' && PROOF_REASONS.has(p.pendingReason ?? ''));

  const submit = async (qrToken: string) => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      let signature = 'mock';
      try {
        signature = await sign(canonicalJson({ punchId: pending.id, qrToken }));
      } catch (e) {
        if (!mockChoice()) throw e;
      }
      const result = await api.punchProof({
        params: { id: pending.id },
        body: { qrToken, signature },
      });
      setDoneAt(result.punch.effectiveTs);
      void qc.invalidateQueries({ queryKey: staffKeys.today });
    } catch (e) {
      const reason = isApiError(e) ? e.details?.reason : null;
      setError(
        reason === 'other_site' ? 'other_site' : reason === 'not_ours' ? 'not_ours' : 'expired',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHeader title={t('staff:scan.title')} back="/" />
      <main id="main" className="staff-main flex flex-col gap-4">
        {doneAt !== null ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg font-bold text-text" role="status">
              {t('staff:scan.accepted', { time: fmt.clock(doneAt) })}
            </p>
            <Button variant="secondary" asChild>
              <Link to="/">{t('staff:nav.today')}</Link>
            </Button>
          </div>
        ) : pending ? (
          <ScanPanel error={error} onToken={(token) => void submit(token)} />
        ) : (
          <EmptyState
            action={
              <Button variant="secondary" asChild>
                <Link to="/">{t('staff:nav.today')}</Link>
              </Button>
            }
          >
            {t('staff:scan.noPending')}
          </EmptyState>
        )}
      </main>
    </>
  );
}
