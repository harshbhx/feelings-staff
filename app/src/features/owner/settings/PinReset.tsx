/**
 * Forgotten owner PIN (docs/owner-access.md, Passkeys flow 6; PRD 4.1.7): "Forgot your PIN?" sends
 * the owner through the email-code sign-in and back to Security. The new-PIN form (no current PIN)
 * shows only while the server says the window is open (`SecurityView.pinResetUntil`); the server
 * decides from the session, so this screen never opens the window itself.
 */
import { Button, Field, Input, Sheet, useToast } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { ownerKeys } from '../api/keys';
import { useSetPin } from '../api/settings';
import { Meta, Section } from '../components/layout';
import { useErrorText } from '../components/states';
import { clock } from '../lib/format';

const PIN_RE = /^\d{6}$/;
const BACK_TO = '/o/settings/security';

/** "Forgot your PIN?": explain, then the email-code sign-in, back to Security. */
export function ForgotPin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const signInAgain = () => {
    // Security is fetched fresh after the sign-in, so the form follows the server's answer.
    qc.removeQueries({ queryKey: ownerKeys.security() });
    navigate(`/auth/owner?next=${encodeURIComponent(BACK_TO)}`);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:security.forgotTitle')}
      description={t('owner:security.forgotBody')}
      trigger={<Button variant="ghost">{t('owner:security.forgotPin')}</Button>}
      footer={
        <>
          <Button variant="primary" icon="sign-in" onClick={signInAgain}>
            {t('owner:security.forgotSignIn')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    />
  );
}

/** New PIN without the old one, while the server's window is open. */
export function PinResetForm({ until }: { until: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const setPin = useSetPin();
  const [pin, setPinValue] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const problem = !PIN_RE.test(pin)
    ? t('owner:security.pinSix')
    : pin !== again
      ? t('owner:security.pinMismatch')
      : null;

  // mutateAsync, not mutate callbacks: on success the new SecurityView closes the window, so this
  // form unmounts before a mutate() callback could run.
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    try {
      await setPin.mutateAsync({ pin });
      toast({ title: t('owner:security.pinResetDone') });
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      toast({ title: errorText(err), tone: 'error' });
      // The window may have closed (15 minutes, or used): show what the server says now.
      void qc.invalidateQueries({ queryKey: ownerKeys.security() });
    }
  }

  return (
    <Section title={t('owner:security.pin')}>
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Meta>{t('owner:security.pinResetWhat', { time: clock(until) })}</Meta>
        <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
          <Field label={t('owner:security.newPin')} error={tried && problem ? problem : undefined}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label={t('owner:security.pinAgain')}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={again}
              onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary" icon="lock" disabled={setPin.isPending}>
            {setPin.isPending ? t('owner:common.saving') : t('owner:security.pinResetSave')}
          </Button>
        </div>
      </form>
    </Section>
  );
}
