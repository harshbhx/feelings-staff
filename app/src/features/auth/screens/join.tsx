/**
 * Join inside the installed app `/join` (PRD 4.1.4, 5.1 "Join", S-01): phone and code, privacy
 * notice (and a separate selfie consent when the salon needs it), PIN twice, this phone's device
 * key, notifications, then the waiting screen. The code comes from `?code=` or from the invite
 * page via localStorage (Android).
 */
import type { ConsentGiven, JoinVerifyResult } from '@fs/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { meQueryKey } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { saveLang } from '../../../app/i18n';
import {
  checkDeviceKeySupport,
  currentPlatform,
  DeviceKeyError,
  deviceLabel,
  getDeviceRecord,
  requestPersistentStorage,
  setDeviceServerState,
} from '../../../lib/device-key';
import { STAFF_ONLY } from '../../../lib/surface';
import { enrolDevice } from '../lib/device';
import { describeAuthError, type ErrorCopy } from '../lib/errors';
import { withFlags } from '../lib/flags';
import { useErrorText, useLang, useOwnerNames } from '../lib/hooks';
import {
  checkNewPin,
  formatCodeInput,
  parseJoinCode,
  parsePhone,
  phoneForField,
  STAFF_PIN,
} from '../lib/inputs';
import { askForNotifications, canAskForNotifications } from '../lib/notifications';
import {
  clearJoinCode,
  readJoinCode,
  readLastPhone,
  saveLastPhone,
  saveOrgContact,
} from '../lib/storage';
import {
  BackButton,
  Button,
  Card,
  ErrorFromCopy,
  Lead,
  SectionTitle,
  Stepper,
  TextLink,
  Title,
} from '../ui/bits';
import { StaffAppOnly } from '../ui/browser-tab';
import { CodeField, PhoneField } from '../ui/fields';
import { Icon, type IconName } from '../ui/icons';
import { AuthScreen } from '../ui/layout';
import { PinPad } from '../ui/pin-pad';

type Step = 'details' | 'notice' | 'selfie' | 'pin' | 'confirm' | 'notifications' | 'unsupported';

const STEP_NUMBER: Record<Step, number> = {
  details: 1,
  notice: 2,
  selfie: 2,
  pin: 3,
  confirm: 3,
  notifications: 4,
  unsupported: 4,
};

/** Navigation state the waiting screen reads. */
export interface WaitingState {
  replacing?: boolean;
}

function NoticePoint({ icon, children }: { icon: IconName; children: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon name={icon} className="mt-0.5 size-6 text-text" />
      <span className="text-base text-text-body">{children}</span>
    </li>
  );
}

function FullNotice({ org, owner }: { org: string; owner: string }) {
  const { t } = useTranslation();
  const sections = [
    ['collect', 'collectBody'],
    ['why', 'whyBody'],
    ['keep', 'keepBody'],
    ['who', 'whoBody'],
    ['rights', 'rightsBody'],
    ['contact', 'contactBody'],
  ] as const;
  const keys: Record<(typeof sections)[number][number], string> = {
    collect: t('auth:notice.full.collect'),
    collectBody: t('auth:notice.full.collectBody'),
    why: t('auth:notice.full.why'),
    whyBody: t('auth:notice.full.whyBody'),
    keep: t('auth:notice.full.keep'),
    keepBody: t('auth:notice.full.keepBody'),
    who: t('auth:notice.full.who'),
    whoBody: t('auth:notice.full.whoBody', { owner }),
    rights: t('auth:notice.full.rights'),
    rightsBody: t('auth:notice.full.rightsBody', { owner }),
    contact: t('auth:notice.full.contact'),
    contactBody: t('auth:notice.full.contactBody', { owner, org }),
  };
  return (
    <details className="group mt-4 rounded-md border border-border">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-md px-4 text-base font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent">
        {t('auth:notice.readFull')}
        <Icon
          name="caret-left"
          className="-rotate-90 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        {sections.map(([h, b]) => (
          <div key={h}>
            <h3 className="text-sm font-bold text-text">{keys[h]}</h3>
            <p className="mt-1 text-sm text-text-body">{keys[b]}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function JoinFlow() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const lang = useLang();

  const [step, setStep] = useState<Step>('details');
  const [phoneRaw, setPhoneRaw] = useState(() => phoneForField(readLastPhone()));
  const [codeRaw, setCodeRaw] = useState(() =>
    formatCodeInput(params.get('code') ?? readJoinCode() ?? ''),
  );
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ErrorCopy | null>(null);
  const [busy, setBusy] = useState(false);

  const [verified, setVerified] = useState<{
    phone: string;
    code: string;
    result: JoinVerifyResult;
  } | null>(null);
  const [selfieAgreed, setSelfieAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [replacing, setReplacing] = useState(false);

  const names = useOwnerNames(verified?.result.ownerDisplayName ?? null);
  const text = useErrorText(names);

  // Each step is a new screen: move focus to its heading so screen readers start there.
  useEffect(() => {
    if (step === 'details') return;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [step]);

  const go = (next: Step) => {
    setFormError(null);
    setStep(next);
    window.scrollTo?.({ top: 0 });
  };

  /** Route an error to the step that can fix it. */
  const fail = (e: unknown) => {
    const copy = describeAuthError(e, 'join');
    setBusy(false);
    switch (copy.action) {
      case 'unsupported':
        go('unsupported');
        return;
      case 'toDetails':
        go('details');
        setFormError(copy);
        return;
      case 'toPin':
        setPin('');
        setConfirm('');
        go('pin');
        setPinError(text(copy));
        return;
      case 'toNotice':
        go('notice');
        setFormError(copy);
        return;
      default:
        setFormError(copy);
    }
  };

  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    const phone = parsePhone(phoneRaw);
    const code = parseJoinCode(codeRaw);
    setPhoneError(phone ? null : t('auth:validation.phone'));
    setCodeError(code ? null : t('auth:validation.code'));
    setFormError(null);
    if (!phone || !code) return;
    setBusy(true);
    try {
      const result = await api.joinVerify({ body: { phone, code } });
      setVerified({ phone, code, result });
      saveOrgContact({ ownerName: result.ownerDisplayName });
      if (result.lang !== lang) {
        // The owner chose this person's language; the rest of the app follows it.
        saveLang(result.lang);
        void i18n.changeLanguage(result.lang);
      }
      setBusy(false);
      go('notice');
    } catch (err) {
      fail(err);
    }
  };

  const consentsGiven = (result: JoinVerifyResult): ConsentGiven[] =>
    result.consentsRequired
      .filter((kind) => kind === 'privacy_notice' || (kind === 'selfie' && selfieAgreed))
      .map((kind) => ({ kind, version: result.privacyNoticeVersion, lang }));

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    const check = checkNewPin(pin, verified?.phone ?? null);
    if (!check.ok) {
      setPinError(
        check.reason === 'short' ? t('auth:validation.pinShort') : t('auth:join.pin.tooWeak'),
      );
      return;
    }
    setPinError(null);
    setConfirm('');
    go('confirm');
  };

  const toWaiting = (isReplacing: boolean) => {
    const state: WaitingState = { replacing: isReplacing };
    navigate(withFlags('/waiting'), { replace: true, state });
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    if (!verified || busy) return;
    if (confirm !== pin) {
      setPin('');
      setConfirm('');
      go('pin');
      setPinError(t('auth:join.confirm.mismatch'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const support = await checkDeviceKeySupport();
      if (!support.ok) throw new DeviceKeyError(support.reason);
      const before = await getDeviceRecord();
      const [storagePersisted, label] = await Promise.all([
        requestPersistentStorage(),
        deviceLabel(),
      ]);
      const { phone, code, result } = verified;
      const { result: me } = await enrolDevice(
        (deviceJwk) =>
          api.joinComplete({
            body: {
              phone,
              code,
              pin,
              deviceJwk,
              deviceLabel: label,
              platform: currentPlatform(),
              consents: consentsGiven(result),
              storagePersisted,
            },
          }),
        { reuseApproved: true },
      );
      if (me.device) {
        // The join already succeeded; a storage hiccup here must not undo it on screen.
        await setDeviceServerState(me.device.id, me.device.status === 'approved').catch(
          () => undefined,
        );
      }
      queryClient.setQueryData(meQueryKey, me);
      clearJoinCode();
      saveLastPhone(phone);
      saveOrgContact({ ownerName: me.org.ownerDisplayName, ownerPhone: me.org.contactPhone });
      // An approved key on this phone that the server didn't keep: the new one replaces it.
      const isReplacing = Boolean(before?.approved) && me.device?.status !== 'approved';
      setReplacing(isReplacing);
      setPin('');
      setConfirm('');
      setBusy(false);
      if (canAskForNotifications()) go('notifications');
      else toWaiting(isReplacing);
    } catch (err) {
      fail(err);
    }
  };

  const back: Partial<Record<Step, Step>> = {
    notice: 'details',
    selfie: 'notice',
    pin: verified?.result.consentsRequired.includes('selfie') ? 'selfie' : 'notice',
    confirm: 'pin',
  };
  const backTo = back[step];

  const header =
    backTo && !busy ? (
      <div className="-mt-2 mb-2 flex min-h-11 items-center">
        <BackButton onClick={() => go(backTo)} />
      </div>
    ) : null;

  const footer = STAFF_ONLY ? undefined : step === 'details' ? (
    <TextLink to="/auth/owner">{t('auth:common.ownerSignIn')}</TextLink>
  ) : undefined;

  return (
    <AuthScreen footer={footer} busy={busy}>
      {header}
      {step !== 'unsupported' ? <Stepper step={STEP_NUMBER[step]} total={4} /> : null}

      {step === 'details' ? (
        <form noValidate onSubmit={submitDetails} className="flex flex-1 flex-col">
          <Title>{t('auth:join.details.title')}</Title>
          <Lead>{t('auth:join.details.lead')}</Lead>
          <div className="mt-8 space-y-6">
            <PhoneField
              value={phoneRaw}
              onChange={(v) => {
                setPhoneRaw(v);
                if (phoneError) setPhoneError(null);
              }}
              error={phoneError}
              hint={t('auth:fields.phoneHint')}
              disabled={busy}
            />
            <CodeField
              value={codeRaw}
              onChange={(v) => {
                setCodeRaw(v);
                if (codeError) setCodeError(null);
              }}
              error={codeError}
              hint={t('auth:fields.codeHint')}
              disabled={busy}
            />
          </div>
          <div className="mt-6">
            <ErrorFromCopy copy={formError} text={text} />
          </div>
          <div className="mt-auto pt-8">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('auth:join.details.checking') : t('auth:join.details.submit')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'notice' && verified ? (
        <div className="flex flex-1 flex-col">
          <Title>{t('auth:join.notice.title', { name: verified.result.staffFirstName })}</Title>
          <section aria-labelledby="notice-title" className="mt-6">
            <SectionTitle id="notice-title">{t('auth:notice.heading')}</SectionTitle>
            <ul className="mt-2 divide-y divide-border">
              <NoticePoint icon="map-pin">{t('auth:notice.location')}</NoticePoint>
              <NoticePoint icon="shield-check">{t('auth:notice.noTracking')}</NoticePoint>
              <NoticePoint icon="clock">{t('auth:notice.keep')}</NoticePoint>
            </ul>
            <FullNotice org={verified.result.orgName} owner={names.owner} />
          </section>
          <div className="mt-6">
            <ErrorFromCopy copy={formError} text={text} />
          </div>
          <div className="mt-auto pt-8">
            <Button
              variant="primary"
              onClick={() =>
                go(verified.result.consentsRequired.includes('selfie') ? 'selfie' : 'pin')
              }
            >
              {t('auth:join.notice.accept')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'selfie' && verified ? (
        <div className="flex flex-1 flex-col">
          <Title>{t('auth:join.selfie.title')}</Title>
          <Card className="mt-6">
            <div className="flex items-start gap-3">
              <Icon name="camera" className="mt-0.5 size-6 text-text" />
              <div className="space-y-3 text-base text-text-body">
                <p>{t('auth:join.selfie.body', { org: verified.result.orgName, ...names })}</p>
                <p>{t('auth:join.selfie.withdraw', names)}</p>
              </div>
            </div>
          </Card>
          <p className="mt-4 text-sm text-text-muted">{t('auth:join.selfie.required', names)}</p>
          <div className="mt-auto pt-8">
            <Button
              variant="primary"
              onClick={() => {
                setSelfieAgreed(true);
                go('pin');
              }}
            >
              {t('auth:join.selfie.accept')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'pin' ? (
        <form noValidate onSubmit={submitPin} className="flex flex-1 flex-col">
          <Title>{t('auth:join.pin.title')}</Title>
          <Lead>{t('auth:join.pin.lead')}</Lead>
          <div className="mt-6">
            <PinPad
              label={t('auth:join.pin.label')}
              hint={t('auth:join.pin.hint')}
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (pinError) setPinError(null);
              }}
              length={STAFF_PIN}
              error={pinError}
              autoComplete="new-password"
            />
          </div>
          <div className="mt-auto pt-8">
            <Button type="submit" variant="primary" disabled={pin.length < STAFF_PIN.min}>
              {t('auth:join.pin.next')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'confirm' ? (
        <form noValidate onSubmit={finish} className="flex flex-1 flex-col">
          <Title>{t('auth:join.confirm.title')}</Title>
          <Lead>{t('auth:join.confirm.lead')}</Lead>
          <div className="mt-6">
            <PinPad
              label={t('auth:join.confirm.label')}
              value={confirm}
              onChange={setConfirm}
              length={{ min: pin.length, max: pin.length }}
              disabled={busy}
              autoComplete="new-password"
            />
          </div>
          <div className="mt-6">
            <ErrorFromCopy copy={formError} text={text} />
          </div>
          <div className="mt-auto pt-8">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || confirm.length !== pin.length}
            >
              {busy ? t('auth:join.confirm.working') : t('auth:join.confirm.submit')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'notifications' ? (
        <div className="flex flex-1 flex-col">
          <Title>{t('auth:join.notifications.title')}</Title>
          <Lead>{t('auth:join.notifications.lead', names)}</Lead>
          <div className="mt-8 flex justify-center" aria-hidden="true">
            <span className="inline-flex size-20 items-center justify-center rounded-full border border-border bg-bg-soft text-text">
              <Icon name="bell" className="size-9" />
            </span>
          </div>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Button
              variant="primary"
              icon="bell"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void askForNotifications().finally(() => toWaiting(replacing));
              }}
            >
              {t('auth:join.notifications.turnOn')}
            </Button>
            <Button onClick={() => toWaiting(replacing)}>
              {t('auth:join.notifications.later')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'unsupported' ? (
        <div className="flex flex-1 flex-col">
          <Title>{t('auth:join.unsupported.title')}</Title>
          <Card className="mt-6">
            <div className="flex items-start gap-3">
              <Icon name="warning-circle" className="mt-0.5 size-6 text-[var(--status-absent)]" />
              <p className="text-base text-text">{t('auth:errors.unsupported')}</p>
            </div>
          </Card>
        </div>
      ) : null}
    </AuthScreen>
  );
}

export function JoinScreen() {
  const [params] = useSearchParams();
  return (
    <StaffAppOnly code={parseJoinCode(params.get('code') ?? '')}>
      <JoinFlow />
    </StaffAppOnly>
  );
}
