/**
 * "Use a recovery code" on the owner host (docs/owner-access.md "Passkeys" flow 5, ui-redesign-plan 5b):
 * the owner lost every phone, an admin gave her a one-time code by phone, and she types it here. A good
 * code becomes an enrolment token (kept in memory, never shown) and the next step is the usual "Make
 * this phone your key". Every refusal reads the same: the screen never says whether a code or an owner
 * exists. Owner build only.
 */
import { isApiError, type OwnerRecoveryRedeemResult } from '@fs/contracts';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../../../api/provider';
import { Button, ErrorNote, Field, inputClass, Lead, Stepper, Title } from '../ui/bits';
import { AuthScreen } from '../ui/layout';
import { OwnerEnrolScreen } from './owner-enrol';

const CODE_CHARS = 16;

/** "k7qm 4t9x" typed in any way becomes "K7QM-4T9X": capitals, groups of four, at most 16 characters. */
export function formatRecoveryCode(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, CODE_CHARS);
  return chars.match(/.{1,4}/g)?.join('-') ?? '';
}

export function OwnerRecoveryScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const titleId = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<OwnerRecoveryRedeemResult | null>(null);

  if (redeemed) return <OwnerEnrolScreen enrolToken={redeemed.enrolToken} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code.replaceAll('-', '').length < CODE_CHARS) {
      setError('owner:access.recovery.short');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRedeemed(await api.ownerRecoveryRedeem({ body: { code } }));
    } catch (err) {
      setError(
        isApiError(err, 'RATE_LIMITED')
          ? 'owner:access.recovery.rateLimited'
          : isApiError(err, 'LINK_EXPIRED')
            ? 'owner:access.recovery.refused'
            : 'owner:access.recovery.failed',
      );
      setBusy(false);
    }
  };

  return (
    <AuthScreen busy={busy}>
      <Stepper step={1} total={3} />
      <Title id={titleId}>{t('owner:access.recovery.title')}</Title>
      <Lead>{t('owner:access.recovery.lead')}</Lead>
      <form noValidate className="flex flex-1 flex-col" onSubmit={(e) => void submit(e)}>
        <div className="mt-6">
          <Field label={t('owner:access.recovery.label')} hint={t('owner:access.recovery.hint')}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                name="recovery-code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={CODE_CHARS + 3}
                value={code}
                disabled={busy}
                onChange={(e) => {
                  setCode(formatRecoveryCode(e.target.value));
                  if (error) setError(null);
                }}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className={`${inputClass} text-xl font-extrabold uppercase tracking-[0.12em] tabular-nums`}
              />
            )}
          </Field>
        </div>
        <div className="mt-6 min-h-6">{error ? <ErrorNote>{t(error)}</ErrorNote> : null}</div>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('owner:access.recovery.checking') : t('owner:access.recovery.submit')}
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => navigate('/auth/owner', { replace: true })}
          >
            {t('owner:access.add.backToSignIn')}
          </Button>
        </div>
      </form>
    </AuthScreen>
  );
}
