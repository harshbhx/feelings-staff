/**
 * Security (PRD 4.1.7, 4.17, 10.3): the sign-in email, the password (with the owner PIN, as the
 * fallback when the email link can't arrive), the owner PIN that unlocks payroll, salary and device
 * changes for 10 minutes, the signed-in devices, and "Sign out other devices".
 */
import { isApiError } from '@fs/contracts';
import { Button, Field, Input, List, ListRow, Sheet, StatusChip, useToast } from '@fs/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { useSecurity, useSetPassword, useSetPin, useSignOutOthers } from '../api/settings';
import { Meta, Section } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { clock, shortDate, todayIst } from '../lib/format';

const PIN_RE = /^\d{6}$/;

function useFeedback() {
  const toast = useToast();
  const errorText = useErrorText();
  const { t } = useTranslation();
  return {
    ok: () => toast({ title: t('owner:settings.saved') }),
    fail: (e: unknown) => {
      if (isStepUpCancelled(e)) return;
      if (isApiError(e, 'PIN_WRONG')) toast({ title: t('owner:security.pinWrong'), tone: 'error' });
      else toast({ title: errorText(e), tone: 'error' });
    },
  };
}

export function SecurityScreen() {
  const { t } = useTranslation();
  const security = useSecurity();
  return (
    <QueryView query={security} skeleton={<RowsSkeleton rows={4} />}>
      {(s) => (
        <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-10">
          <Section title={t('owner:security.email')}>
            <p className="font-semibold text-text">{s.email}</p>
            <Meta>{t('owner:security.emailHint')}</Meta>
          </Section>
          <PinForm pinSet={s.pinSet} />
          <PasswordForm passwordSet={s.passwordSet} pinSet={s.pinSet} />
          <Section title={t('owner:security.sessions')}>
            <List>
              {s.sessions.map((x) => (
                <ListRow
                  key={x.id}
                  title={x.label}
                  subtitle={t('owner:security.sessionLine', {
                    since: shortDate(todayIst(x.createdAt)),
                    seen: `${shortDate(todayIst(x.lastSeenAt))} ${clock(x.lastSeenAt)}`,
                  })}
                  trailing={
                    x.current ? (
                      <StatusChip status="present" label={t('owner:security.thisDevice')} />
                    ) : null
                  }
                />
              ))}
            </List>
            {s.sessions.some((x) => !x.current) ? (
              <div className="pt-2">
                <SignOutOthers />
              </div>
            ) : null}
          </Section>
        </div>
      )}
    </QueryView>
  );
}

function PinForm({ pinSet }: { pinSet: boolean }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const setPin = useSetPin();
  const [current, setCurrent] = useState('');
  const [pin, setPinValue] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const problem = !PIN_RE.test(pin)
    ? t('owner:security.pinSix')
    : pin !== again
      ? t('owner:security.pinMismatch')
      : pinSet && !PIN_RE.test(current)
        ? t('owner:security.currentPinNeeded')
        : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    setPin.mutate(pinSet ? { pin, currentPin: current } : { pin }, {
      onSuccess: () => {
        setCurrent('');
        setPinValue('');
        setAgain('');
        setTried(false);
        fb.ok();
      },
      onError: fb.fail,
    });
  }

  return (
    <Section title={t('owner:security.pin')}>
      <form noValidate onSubmit={submit} className="grid gap-4">
        <Meta>{t('owner:security.pinWhat')}</Meta>
        {pinSet ? (
          <Field label={t('owner:security.currentPin')}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Button
            type="submit"
            variant={pinSet ? 'secondary' : 'primary'}
            icon="lock"
            disabled={setPin.isPending}
          >
            {setPin.isPending
              ? t('owner:common.saving')
              : pinSet
                ? t('owner:security.changePin')
                : t('owner:security.setPin')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PasswordForm({ passwordSet, pinSet }: { passwordSet: boolean; pinSet: boolean }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const setPassword = useSetPassword();
  const [password, setPasswordValue] = useState('');
  const [pin, setPinValue] = useState('');
  const [tried, setTried] = useState(false);
  const problem =
    password.length < 10
      ? t('owner:security.passwordLength')
      : !PIN_RE.test(pin)
        ? t('owner:security.pinSix')
        : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    setPassword.mutate(
      { password, pin },
      {
        onSuccess: () => {
          setPasswordValue('');
          setPinValue('');
          setTried(false);
          fb.ok();
        },
        onError: fb.fail,
      },
    );
  }

  return (
    <Section title={t('owner:security.password')}>
      <form noValidate onSubmit={submit} className="grid gap-4">
        <Meta>
          {passwordSet ? t('owner:security.passwordSet') : t('owner:security.passwordWhat')}
        </Meta>
        {pinSet ? null : <Meta>{t('owner:security.pinFirst')}</Meta>}
        <Field
          label={t('owner:security.newPassword')}
          hint={t('owner:security.passwordHint')}
          error={tried && problem ? problem : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
          />
        </Field>
        <Field label={t('owner:security.pinToConfirm')} className="max-w-60">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="secondary"
            icon="lock"
            disabled={setPassword.isPending || !pinSet}
          >
            {setPassword.isPending
              ? t('owner:common.saving')
              : passwordSet
                ? t('owner:security.changePassword')
                : t('owner:security.setPassword')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SignOutOthers() {
  const { t } = useTranslation();
  const fb = useFeedback();
  const out = useSignOutOthers();
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:security.signOutTitle')}
      description={t('owner:security.signOutBody')}
      trigger={
        <Button variant="danger-secondary" icon="sign-out">
          {t('owner:security.signOutOthers')}
        </Button>
      }
      footer={
        <>
          <Button
            variant="danger-secondary"
            icon="sign-out"
            disabled={out.isPending}
            onClick={() =>
              out.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  fb.ok();
                },
                onError: fb.fail,
              })
            }
          >
            {t('owner:security.signOutOthers')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    />
  );
}
