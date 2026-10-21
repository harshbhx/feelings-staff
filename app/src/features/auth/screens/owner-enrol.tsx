/**
 * First-device enrolment on the owner host (docs/owner-access.md, ui-redesign-plan 5b): after the
 * email code, "Make this phone your key" creates the passkey; the success step shows the name of the
 * phone, prefilled ("Urmi's iPhone"), which the owner may change before going on. Owner build only.
 */
import {
  isApiError,
  type OwnerDeviceView,
  type OwnerEnrolOptions,
  type Platform,
} from '@fs/contracts';
import { Banner, Bindi, Button, Field, Input } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { meQueryKey, useMe } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { homeFor } from '../../../app/guards';
import { createPasskey, passkeyProblem, passkeysSupported, platformOf } from '../lib/passkey';
import { ErrorNote, Lead, Stepper, Title } from '../ui/bits';
import { AuthScreen } from '../ui/layout';

const CHALLENGE_MARGIN_MS = 15_000;
const NAME_MAX = 80;

type Notice = { tone: 'quiet' | 'error'; key: string } | null;

/** "Urmi's iPhone": the default name of this phone in the device list. */
const DEVICE_NAME: Record<Platform, string> = {
  ios: 'owner:access.deviceName.ios',
  android: 'owner:access.deviceName.android',
  desktop: 'owner:access.deviceName.desktop',
  other: 'owner:access.deviceName.other',
};

/** A first name for the default device name. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function OwnerEnrolScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const supported = passkeysSupported();
  const platform: Platform = platformOf();
  const [challenge, setChallenge] = useState<OwnerEnrolOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [done, setDone] = useState<OwnerDeviceView | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const loading = useRef(false);

  const owner = me.data?.user.name ?? '';
  const defaultName = t(DEVICE_NAME[platform], { name: firstName(owner) });

  const load = useCallback(async (): Promise<OwnerEnrolOptions | null> => {
    if (loading.current) return null;
    loading.current = true;
    try {
      const next = await api.ownerEnrolOptions({ body: {} });
      setChallenge(next);
      return next;
    } catch (e) {
      // An owner who already has a passkey adds devices another way: go to the panel.
      if (isApiError(e, 'RULE_VIOLATION') && e.details?.reason === 'already_enrolled')
        setEnrolled(true);
      else setNotice({ tone: 'error', key: 'owner:access.enrol.loadFailed' });
      return null;
    } finally {
      loading.current = false;
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new step is a new screen: start screen readers at its heading.
  const doneTitle = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);

  if (enrolled && !done) return <Navigate to={homeFor('owner')} replace />;

  const start = async () => {
    if (busy) return;
    setNotice(null);
    let current = challenge;
    if (!current || current.expiresAt - CHALLENGE_MARGIN_MS < Date.now()) current = await load();
    if (!current) return;
    setBusy(true);
    let credential: Awaited<ReturnType<typeof createPasskey>>;
    try {
      credential = await createPasskey(current.options);
    } catch (e) {
      setBusy(false);
      const p = passkeyProblem(e);
      setNotice(
        p === 'cancelled'
          ? { tone: 'quiet', key: 'owner:access.enrol.cancelled' }
          : p === 'exists'
            ? { tone: 'error', key: 'owner:access.enrol.exists' }
            : p === 'unsupported'
              ? { tone: 'error', key: 'owner:access.unsupported' }
              : { tone: 'error', key: 'owner:access.enrol.failed' },
      );
      void load();
      return;
    }
    try {
      const result = await api.ownerEnrolVerify({
        body: { challengeId: current.challengeId, credential, deviceName: defaultName, platform },
      });
      queryClient.setQueryData(meQueryKey, result.me);
      setName(result.device.deviceName);
      setDone(result.device);
      setBusy(false);
      // A short buzz on phones that have one (Android); nothing elsewhere.
      if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
    } catch (e) {
      setBusy(false);
      setNotice(
        isApiError(e, 'NONCE_INVALID')
          ? { tone: 'quiet', key: 'owner:access.enrol.tooSlow' }
          : { tone: 'error', key: 'owner:access.enrol.failed' },
      );
      void load();
    }
  };

  const finish = async () => {
    if (!done || busy) return;
    const value = name.trim();
    if (!value || value.length > NAME_MAX) {
      setNameError(t('owner:access.enrol.nameInvalid'));
      return;
    }
    setBusy(true);
    try {
      if (value !== done.deviceName)
        await api.ownerDeviceRename({ params: { id: done.id }, body: { deviceName: value } });
    } catch {
      // The passkey is saved either way; the name can be changed later in Settings, Security.
    }
    navigate(homeFor('owner'), { replace: true });
  };

  if (done) {
    return (
      <AuthScreen busy={busy}>
        <Stepper step={3} total={3} />
        <p className="mb-4">
          <Bindi size="success" land />
        </p>
        <h1
          ref={doneTitle}
          tabIndex={-1}
          className="text-xl leading-[1.15] font-extrabold tracking-[-0.025em] text-balance text-text focus:outline-none"
        >
          {t('owner:access.enrol.doneTitle')}
        </h1>
        <Lead>{t('owner:access.enrol.doneLead')}</Lead>
        <form
          noValidate
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void finish();
          }}
        >
          <div className="mt-8">
            <Field
              label={t('owner:access.enrol.nameLabel')}
              hint={t('owner:access.enrol.nameHint')}
              error={nameError}
            >
              <Input
                name="device-name"
                autoComplete="off"
                maxLength={NAME_MAX}
                value={name}
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            </Field>
          </div>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Button
              type="submit"
              variant="primary"
              block
              loading={busy}
              loadingLabel={t('owner:access.enrol.saving')}
            >
              {t('owner:access.enrol.continue')}
            </Button>
          </div>
        </form>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen busy={busy}>
      <Stepper step={2} total={3} />
      <Title>{t('owner:access.enrol.title')}</Title>
      <Lead>{t('owner:access.enrol.lead')}</Lead>
      {!supported ? (
        <div className="mt-6">
          <Banner icon="warning-circle" tone="plain">
            {t('owner:access.unsupported')}
          </Banner>
        </div>
      ) : null}
      <div className="mt-6 min-h-6">
        {notice?.tone === 'error' ? <ErrorNote>{t(notice.key)}</ErrorNote> : null}
        <p role="status" className="text-sm text-text-body">
          {notice?.tone === 'quiet' ? t(notice.key) : null}
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        <Button
          variant="primary"
          icon="fingerprint"
          block
          disabled={!supported}
          loading={busy}
          loadingLabel={t('owner:access.enrol.waiting')}
          onClick={() => void start()}
        >
          {t('owner:access.enrol.start')}
        </Button>
      </div>
    </AuthScreen>
  );
}
