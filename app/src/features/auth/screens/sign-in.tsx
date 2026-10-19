/**
 * Staff sign-in `/signin` (PRD 4.1.4 "first launch", 4.1.6, 5.1 "Sign in", S-02):
 * - this phone has a registered key: phone + PIN, signed challenge, then home (or `?next=`);
 * - no key yet: "Join your team" with the join code, or "I have a new phone";
 * - "I have a new phone": phone + PIN with a fresh key, a pending device, then the waiting screen;
 * - "Forgot PIN?": ask the owner to reset it (never by SMS).
 */
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../../../api/provider';
import {
  checkDeviceKeySupport,
  clearDeviceKey,
  currentPlatform,
  DeviceKeyError,
  deviceLabel,
  getDeviceRecord,
  setDeviceServerState,
} from '../../../lib/device-key';
import { enrolDevice, staffSignIn } from '../lib/device';
import { describeAuthError, type ErrorCopy } from '../lib/errors';
import { withFlags } from '../lib/flags';
import { useErrorText, useFinishSignIn, useOwnerNames } from '../lib/hooks';
import { parsePhone, phoneForField, STAFF_PIN } from '../lib/inputs';
import { holdPendingSignIn } from '../lib/pending';
import { readLastPhone, saveLastPhone } from '../lib/storage';
import { Button, ButtonLink, ErrorFromCopy, Lead, Skeleton, TextLink, Title } from '../ui/bits';
import { StaffAppOnly } from '../ui/browser-tab';
import { PhoneField } from '../ui/fields';
import { Icon } from '../ui/icons';
import { AuthScreen } from '../ui/layout';
import { PinPad } from '../ui/pin-pad';

type Mode = 'loading' | 'signIn' | 'start' | 'newPhone';

function SignInFlow() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const finishSignIn = useFinishSignIn();
  const names = useOwnerNames();
  const text = useErrorText(names);

  const [mode, setMode] = useState<Mode>('loading');
  const [phoneRaw, setPhoneRaw] = useState(() => phoneForField(readLastPhone()));
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ErrorCopy | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getDeviceRecord().then((record) => {
      if (alive) setMode(record?.deviceId ? 'signIn' : 'start');
    });
    return () => {
      alive = false;
    };
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPin('');
    setPinError(null);
    setPhoneError(null);
    setFormError(null);
    setForgotOpen(false);
  };

  /** Shared checks for phone + PIN forms; returns the E.164 phone or null. */
  const validate = (): string | null => {
    const phone = parsePhone(phoneRaw);
    setPhoneError(phone ? null : t('auth:validation.phone'));
    setPinError(pin.length >= STAFF_PIN.min ? null : t('auth:validation.pinShort'));
    setFormError(null);
    return phone && pin.length >= STAFF_PIN.min ? phone : null;
  };

  const forget = async (copy: ErrorCopy) => {
    await clearDeviceKey();
    switchMode('start');
    setFormError(copy);
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    const phone = validate();
    if (!phone || busy) return;
    setBusy(true);
    try {
      const me = await staffSignIn(api, { phone, pin });
      saveLastPhone(phone);
      if (me.device)
        await setDeviceServerState(me.device.id, me.device.status === 'approved').catch(
          () => undefined,
        );
      finishSignIn(me);
    } catch (err) {
      const copy = describeAuthError(err, 'staffLogin');
      setBusy(false);
      setPin('');
      if (copy.action === 'waiting') {
        holdPendingSignIn({ phone, pin });
        navigate(withFlags('/waiting'), { replace: true });
      } else if (copy.action === 'rejected' || copy.action === 'unknownDevice') {
        await forget(copy);
      } else {
        setFormError(copy);
      }
    }
  };

  const newPhone = async (e: FormEvent) => {
    e.preventDefault();
    const phone = validate();
    if (!phone || busy) return;
    setBusy(true);
    try {
      const support = await checkDeviceKeySupport();
      if (!support.ok) throw new DeviceKeyError(support.reason);
      const label = await deviceLabel();
      const { result } = await enrolDevice(
        (deviceJwk) =>
          api.staffNewDevice({
            body: { phone, pin, deviceJwk, deviceLabel: label, platform: currentPlatform() },
          }),
        { reuseApproved: false },
      );
      await setDeviceServerState(result.deviceId, false).catch(() => undefined);
      saveLastPhone(phone);
      holdPendingSignIn({ phone, pin });
      navigate(withFlags('/waiting'), { replace: true });
    } catch (err) {
      setBusy(false);
      setPin('');
      setFormError(describeAuthError(err, 'newDevice'));
    }
  };

  const errorBlock = (
    <div className="mt-6 space-y-3">
      <ErrorFromCopy copy={formError} text={text} />
      {formError?.action === 'linkJoin' ? (
        <ButtonLink to={withFlags('/join')} icon="sign-in">
          {t('auth:signIn.useJoinCode')}
        </ButtonLink>
      ) : null}
    </div>
  );

  const ownerLink = <TextLink to="/auth/owner">{t('auth:common.ownerSignIn')}</TextLink>;

  if (mode === 'loading') {
    return (
      <AuthScreen busy footer={ownerLink}>
        <h1 className="sr-only">{t('auth:signIn.title')}</h1>
        <Skeleton className="h-8 w-3/5" />
        <Skeleton className="mt-3 h-5 w-4/5" />
        <Skeleton className="mt-8 h-[3.25rem] w-full" />
        <Skeleton className="mt-6 h-14 w-full" />
      </AuthScreen>
    );
  }

  if (mode === 'start') {
    return (
      <AuthScreen footer={ownerLink}>
        <Title>{t('auth:signIn.start.title')}</Title>
        <Lead>{t('auth:signIn.start.lead')}</Lead>
        {errorBlock}
        <div className="mt-auto flex flex-col gap-3 pt-10">
          <ButtonLink to={withFlags('/join')} variant="primary" icon="sign-in">
            {t('auth:signIn.start.join')}
          </ButtonLink>
          <Button icon="device-mobile" onClick={() => switchMode('newPhone')}>
            {t('auth:signIn.newPhone')}
          </Button>
        </div>
      </AuthScreen>
    );
  }

  const isNew = mode === 'newPhone';
  return (
    <AuthScreen footer={ownerLink} busy={busy}>
      <form noValidate onSubmit={isNew ? newPhone : signIn} className="flex flex-1 flex-col">
        <Title>{isNew ? t('auth:signIn.new.title') : t('auth:signIn.title')}</Title>
        <Lead>{isNew ? t('auth:signIn.new.lead', names) : t('auth:signIn.lead')}</Lead>
        <div className="mt-8 space-y-6">
          <PhoneField
            value={phoneRaw}
            onChange={(v) => {
              setPhoneRaw(v);
              if (phoneError) setPhoneError(null);
            }}
            error={phoneError}
            disabled={busy}
          />
          <PinPad
            label={t('auth:signIn.pinLabel')}
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (pinError) setPinError(null);
            }}
            length={STAFF_PIN}
            error={pinError}
            disabled={busy}
            autoComplete="current-password"
          />
        </div>
        {errorBlock}
        <div className="mt-auto flex flex-col gap-2 pt-8">
          <Button type="submit" variant="primary" disabled={busy}>
            {isNew
              ? busy
                ? t('auth:signIn.new.sending')
                : t('auth:signIn.new.submit', names)
              : busy
                ? t('auth:signIn.signingIn')
                : t('auth:signIn.submit')}
          </Button>
          {isNew ? (
            <Button
              variant="quiet"
              full={false}
              className="self-center"
              onClick={() => switchMode('signIn')}
            >
              {t('auth:signIn.new.back')}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-x-6">
              <Button variant="quiet" full={false} onClick={() => switchMode('newPhone')}>
                {t('auth:signIn.newPhone')}
              </Button>
              <Button
                variant="quiet"
                full={false}
                aria-expanded={forgotOpen}
                aria-controls="forgot-pin"
                onClick={() => setForgotOpen((v) => !v)}
              >
                {t('auth:signIn.forgot')}
              </Button>
            </div>
          )}
          {isNew ? null : (
            <p
              id="forgot-pin"
              hidden={!forgotOpen}
              className="flex items-start gap-2 rounded-md border border-border bg-bg-soft p-4 text-sm text-text [&[hidden]]:hidden"
            >
              <Icon name="lock" className="mt-px" />
              <span>{t('auth:signIn.forgotAnswer', names)}</span>
            </p>
          )}
        </div>
      </form>
    </AuthScreen>
  );
}

export function SignInScreen() {
  return (
    <StaffAppOnly>
      <SignInFlow />
    </StaffAppOnly>
  );
}
