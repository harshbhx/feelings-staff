/**
 * Owner sign-in `/auth/owner` (PRD 4.1.7, 5.2, O-01, 17.1 F2): email, then the 6-digit code from
 * the email (the iPhone-safe path, since a link tapped in Mail opens Safari, not the installed
 * app), or the link itself (`?t=` signs in directly). After 60 s it offers Resend and the
 * password + owner PIN fallback. The answer to "send" never says whether the email exists.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApi } from '../../../api/provider';
import { describeAuthError, type ErrorCopy } from '../lib/errors';
import { useErrorText, useFinishSignIn, useOwnerNames } from '../lib/hooks';
import { digitsOnly, EMAIL_CODE_LENGTH, looksLikeEmail, OWNER_PIN } from '../lib/inputs';
import {
  Button,
  ErrorFromCopy,
  Field,
  inputClass,
  Lead,
  Skeleton,
  TextLink,
  Title,
} from '../ui/bits';
import { Icon } from '../ui/icons';
import { AuthScreen } from '../ui/layout';

type Mode = 'link' | 'email' | 'code' | 'password';

const RESEND_AFTER_MS = 60_000;
const PASSWORD_MIN = 10;

export function OwnerSignInScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const finishSignIn = useFinishSignIn();
  const names = useOwnerNames();
  const text = useErrorText(names);
  const [params, setParams] = useSearchParams();

  const [token] = useState(() => params.get('t'));
  const [mode, setMode] = useState<Mode>(token ? 'link' : 'email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ErrorCopy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [late, setLate] = useState(false);
  const linkStarted = useRef(false);

  // A link from the email: drop the token from the address bar first, then use it once.
  useEffect(() => {
    if (!token || linkStarted.current) return;
    linkStarted.current = true;
    const rest = new URLSearchParams(window.location.search);
    rest.delete('t');
    setParams(rest, { replace: true });
    api.ownerVerify({ body: { token } }).then(finishSignIn, (e: unknown) => {
      setMode('email');
      setFormError(describeAuthError(e, 'ownerVerify'));
    });
  }, [token, api, finishSignIn, setParams]);

  // Offer Resend and the password after 60 s without a code.
  useEffect(() => {
    if (mode !== 'code' || sentAt === 0) return;
    setLate(false);
    const timer = setTimeout(() => setLate(true), RESEND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [mode, sentAt]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setNotice(null);
    setCodeError(null);
    setPasswordError(null);
    setPinError(null);
  };

  // A new form is a new screen: start screen readers at its heading.
  const shownMode = useRef<Mode | null>(null);
  useEffect(() => {
    const before = shownMode.current;
    shownMode.current = mode;
    if (before !== null && before !== mode) document.querySelector<HTMLElement>('main h1')?.focus();
  }, [mode]);

  const checkEmail = (): string | null => {
    const value = email.trim();
    const ok = looksLikeEmail(value);
    setEmailError(ok ? null : t('auth:validation.email'));
    return ok ? value : null;
  };

  const send = async (resend: boolean) => {
    const value = checkEmail();
    if (!value || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.ownerMagic({ body: { email: value } });
      if (!resend) switchMode('code');
      setCode('');
      setSentAt(Date.now());
      setNotice(resend ? t('auth:owner.resent') : t('auth:owner.sent'));
    } catch (e) {
      setFormError(describeAuthError(e, 'ownerMagic'));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (value: string) => {
    if (busy) return;
    if (value.length !== EMAIL_CODE_LENGTH) {
      setCodeError(t('auth:validation.emailCode'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      finishSignIn(await api.ownerVerify({ body: { email: email.trim(), code: value } }));
    } catch (e) {
      setBusy(false);
      setCode('');
      const copy = describeAuthError(e, 'ownerVerify');
      setFormError(copy);
      if (copy.key === 'auth:errors.linkExpired') setLate(true);
    }
  };

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    const value = checkEmail();
    const pinOk = pin.length === OWNER_PIN.max;
    setPasswordError(password ? null : t('auth:validation.password'));
    setPinError(pinOk ? null : t('auth:validation.ownerPin'));
    setFormError(null);
    if (!value || !password || !pinOk || busy) return;
    if (password.length < PASSWORD_MIN) {
      // Too short to be anyone's password; same answer as a wrong one (no hints).
      setFormError({ key: 'auth:errors.ownerPasswordWrong' });
      return;
    }
    setBusy(true);
    try {
      finishSignIn(await api.ownerPassword({ body: { email: value, password, pin } }));
    } catch (err) {
      setBusy(false);
      setPin('');
      setFormError(describeAuthError(err, 'ownerPassword'));
    }
  };

  const footer = <TextLink to="/signin">{t('auth:common.staffSignIn')}</TextLink>;

  const emailField = (autoComplete: 'email' | 'username') => (
    <Field label={t('auth:fields.email')} error={emailError}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name="email"
          type="email"
          inputMode="email"
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          disabled={busy}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
      )}
    </Field>
  );

  if (mode === 'link') {
    return (
      <AuthScreen busy footer={footer}>
        <Title>{t('auth:owner.linkVerifying')}</Title>
        <Skeleton className="mt-6 h-5 w-3/5" />
        <Skeleton className="mt-3 h-5 w-2/5" />
      </AuthScreen>
    );
  }

  if (mode === 'code') {
    return (
      <AuthScreen footer={footer} busy={busy}>
        <form
          noValidate
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void verifyCode(code);
          }}
        >
          <Title>{t('auth:owner.codeTitle')}</Title>
          <Lead>{t('auth:owner.codeLead')}</Lead>
          {notice ? (
            <p
              role="status"
              className="mt-5 flex items-start gap-2 rounded-md border border-border bg-bg-soft p-4 text-sm text-text"
            >
              <Icon name="envelope" className="mt-px" />
              <span>{notice}</span>
            </p>
          ) : null}
          <div className="mt-6">
            <Field label={t('auth:fields.emailCode')} error={codeError}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={EMAIL_CODE_LENGTH}
                  value={code}
                  disabled={busy}
                  onChange={(e) => {
                    const v = digitsOnly(e.target.value, EMAIL_CODE_LENGTH);
                    setCode(v);
                    if (codeError) setCodeError(null);
                    if (v.length === EMAIL_CODE_LENGTH && v !== code) void verifyCode(v);
                  }}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  className={`${inputClass} text-2xl font-extrabold tracking-[0.3em] tabular-nums`}
                />
              )}
            </Field>
          </div>
          <div className="mt-6">
            <ErrorFromCopy copy={formError} text={text} />
          </div>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('auth:owner.verifying') : t('auth:owner.codeSubmit')}
            </Button>
            {late ? (
              <div className="mt-2 border-t border-border pt-5">
                <p className="text-sm font-semibold text-text">{t('auth:owner.notArrived')}</p>
                <div className="mt-3 flex flex-col gap-3">
                  <Button icon="envelope" disabled={busy} onClick={() => void send(true)}>
                    {t('auth:owner.resend')}
                  </Button>
                  <Button
                    variant="quiet"
                    full={false}
                    className="self-center"
                    onClick={() => switchMode('password')}
                  >
                    {t('auth:owner.usePassword')}
                  </Button>
                </div>
              </div>
            ) : null}
            <Button
              variant="quiet"
              full={false}
              className="self-center"
              onClick={() => switchMode('email')}
            >
              {t('auth:owner.otherEmail')}
            </Button>
          </div>
        </form>
      </AuthScreen>
    );
  }

  if (mode === 'password') {
    return (
      <AuthScreen footer={footer} busy={busy}>
        <form noValidate className="flex flex-1 flex-col" onSubmit={signInWithPassword}>
          <Title>{t('auth:owner.passwordTitle')}</Title>
          <Lead>{t('auth:owner.passwordLead')}</Lead>
          <div className="mt-8 space-y-6">
            {emailField('username')}
            <Field label={t('auth:fields.password')} error={passwordError}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  className={inputClass}
                />
              )}
            </Field>
            <Field
              label={t('auth:fields.ownerPin')}
              hint={t('auth:fields.ownerPinHint')}
              error={pinError}
            >
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  name="owner-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]*"
                  maxLength={OWNER_PIN.max}
                  value={pin}
                  disabled={busy}
                  onChange={(e) => {
                    setPin(digitsOnly(e.target.value, OWNER_PIN.max));
                    if (pinError) setPinError(null);
                  }}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  className={`${inputClass} tracking-[0.3em] tabular-nums`}
                />
              )}
            </Field>
          </div>
          <div className="mt-6">
            <ErrorFromCopy copy={formError} text={text} />
          </div>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('auth:owner.verifying') : t('auth:owner.passwordSubmit')}
            </Button>
            <Button
              variant="quiet"
              full={false}
              className="self-center"
              onClick={() => switchMode('email')}
            >
              {t('auth:owner.useEmail')}
            </Button>
          </div>
        </form>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen footer={footer} busy={busy}>
      <form
        noValidate
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void send(false);
        }}
      >
        <Title>{t('auth:owner.title')}</Title>
        <Lead>{t('auth:owner.lead')}</Lead>
        <div className="mt-8">{emailField('email')}</div>
        <div className="mt-6">
          <ErrorFromCopy copy={formError} text={text} />
        </div>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <Button type="submit" variant="primary" icon="envelope" disabled={busy}>
            {busy ? t('auth:owner.sending') : t('auth:owner.send')}
          </Button>
          <Button
            variant="quiet"
            full={false}
            className="self-center"
            onClick={() => switchMode('password')}
          >
            {t('auth:owner.usePassword')}
          </Button>
        </div>
      </form>
    </AuthScreen>
  );
}
