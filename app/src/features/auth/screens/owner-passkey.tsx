/**
 * Owner sign-in on the owner host (docs/owner-access.md, ui-redesign-plan 5b): "Use your fingerprint"
 * (or "Use Face ID") runs a passkey assertion; "Email me a code" shows only while an owner of the
 * salon has no passkey yet (the first device); "Add this device" asks a phone that has a passkey to
 * approve this one; "Lost your phone?" explains the recovery code. The
 * email-code route is the old screen, and a successful code leads to the first-device enrolment.
 * Owner build only.
 */
import { isApiError, type Me, type OwnerPasskeyOptions } from '@fs/contracts';
import { Banner, Button } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { meQueryKey } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { useFinishSignIn } from '../lib/hooks';
import {
  getPasskey,
  type PasskeyProblem,
  passkeyProblem,
  passkeysSupported,
  platformOf,
} from '../lib/passkey';
import { readOrgContact, saveOrgContact } from '../lib/storage';
import { ErrorNote, Lead, Title } from '../ui/bits';
import { AuthScreen } from '../ui/layout';
import { OwnerSignInScreen } from './owner-sign-in';

/** Fetch a fresh challenge this long before the old one runs out. */
const CHALLENGE_MARGIN_MS = 15_000;

type Notice = { tone: 'quiet' | 'error'; key: string } | null;

/** `/auth/owner`: the link from the email (`?t=`) goes to the email screen, everything else to passkeys. */
export function OwnerAccessSignInScreen() {
  const [params] = useSearchParams();
  return params.get('t') ? <OwnerFirstDeviceEmailScreen /> : <OwnerPasskeySignInScreen />;
}

/** The email code for the first device; after it, "Make this phone your key". */
export function OwnerFirstDeviceEmailScreen() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const onSignedIn = useCallback(
    (me: Me) => {
      queryClient.setQueryData(meQueryKey, me);
      saveOrgContact({ ownerName: me.org.ownerDisplayName, ownerPhone: me.org.contactPhone });
      navigate('/auth/owner/enrol', { replace: true });
    },
    [queryClient, navigate],
  );
  return <OwnerSignInScreen onSignedIn={onSignedIn} />;
}

export function OwnerPasskeySignInScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const finishSignIn = useFinishSignIn();
  const supported = passkeysSupported();
  const [challenge, setChallenge] = useState<OwnerPasskeyOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const loading = useRef(false);

  const name = readOrgContact().ownerName;
  const faceId = platformOf() === 'ios';

  // Options are fetched before the tap: Safari only opens the passkey sheet right after a tap.
  const load = useCallback(async (): Promise<OwnerPasskeyOptions | null> => {
    if (loading.current) return null;
    loading.current = true;
    try {
      const next = await api.ownerPasskeyOptions({ body: { purpose: 'signin' } });
      setChallenge(next);
      return next;
    } catch {
      setNotice({ tone: 'error', key: 'owner:access.signIn.loadFailed' });
      return null;
    } finally {
      loading.current = false;
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const problemKey = (p: PasskeyProblem): Notice =>
    p === 'cancelled'
      ? { tone: 'quiet', key: 'owner:access.signIn.cancelled' }
      : p === 'unsupported'
        ? { tone: 'error', key: 'owner:access.unsupported' }
        : { tone: 'error', key: 'owner:access.signIn.failed' };

  const signIn = async () => {
    if (busy) return;
    setNotice(null);
    let current = challenge;
    if (!current || current.expiresAt - CHALLENGE_MARGIN_MS < Date.now()) current = await load();
    if (!current) return;
    setBusy(true);
    let credential: Awaited<ReturnType<typeof getPasskey>>;
    try {
      credential = await getPasskey(current.options);
    } catch (e) {
      setBusy(false);
      setNotice(problemKey(passkeyProblem(e)));
      void load();
      return;
    }
    try {
      const me = await api.ownerPasskeyVerify({
        body: { challengeId: current.challengeId, credential },
      });
      finishSignIn(me);
    } catch (e) {
      setBusy(false);
      setNotice(
        isApiError(e, 'NONCE_INVALID')
          ? { tone: 'quiet', key: 'owner:access.signIn.tooSlow' }
          : isApiError(e, 'SIGNATURE_INVALID')
            ? { tone: 'error', key: 'owner:access.signIn.failed' }
            : isApiError(e, 'RATE_LIMITED')
              ? { tone: 'error', key: 'owner:access.signIn.rateLimited' }
              : { tone: 'error', key: 'owner:access.signIn.generic' },
      );
      void load();
    }
  };

  const primary = faceId ? t('owner:access.signIn.faceId') : t('owner:access.signIn.fingerprint');

  return (
    <AuthScreen busy={busy}>
      <Title>
        {name ? t('owner:access.signIn.titleNamed', { name }) : t('owner:access.signIn.title')}
      </Title>
      <Lead>{t('owner:access.signIn.lead')}</Lead>
      {!supported ? (
        <div className="mt-6">
          <Banner icon="warning-circle" tone="plain">
            {t('owner:access.unsupported')}
          </Banner>
        </div>
      ) : null}
      <div className="mt-6 min-h-6">
        {notice?.tone === 'error' ? <ErrorNote>{t(notice.key)}</ErrorNote> : null}
        {/* A closed sheet is not an error: calm words, no red (ui-redesign-plan 5b). */}
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
          loadingLabel={t('owner:access.signIn.waiting')}
          onClick={() => void signIn()}
        >
          {primary}
        </Button>
        {challenge?.emailCode ? (
          <Button variant="ghost" block onClick={() => navigate('/auth/owner/email')}>
            {t('owner:access.signIn.emailCode')}
          </Button>
        ) : null}
        {/* A phone without a passkey yet asks one that has it (docs/owner-access.md flow 3). */}
        <Button variant="ghost" block onClick={() => navigate('/auth/owner/add')}>
          {t('owner:access.signIn.addDevice')}
        </Button>
        <div className="mt-2 text-center">
          <button
            type="button"
            aria-expanded={lostOpen}
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-text underline decoration-border-control underline-offset-4 hover:decoration-text"
            onClick={() => setLostOpen((v) => !v)}
          >
            {t('owner:access.signIn.lostPhone')}
          </button>
          {lostOpen ? (
            <p className="mt-2 text-sm text-pretty text-text-body">
              {t('owner:access.signIn.lostPhoneHelp')}
            </p>
          ) : null}
        </div>
      </div>
    </AuthScreen>
  );
}
