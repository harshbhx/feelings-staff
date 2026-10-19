/**
 * Waiting for approval `/waiting` (PRD 4.1.4 step 6, 4.1.6, 5.1, S-01.5). Two ways in:
 *
 * - After join there is a session: poll `me` every 15 s while the page is visible (TanStack pauses
 *   the interval in the background and refetches on visibilitychange). Approved: remember it and
 *   switch to Today without a reload. Rejected: the server revokes the session, so `me` turning
 *   signed-out (or a `rejected` device) means Urmi said no; forget the key.
 * - After "I have a new phone" there is no session: retry sign-in (challenge, signature, PIN) every
 *   15 s with the phone and PIN held in memory. `DEVICE_NOT_APPROVED` pending means keep waiting.
 *
 * Opened cold (reload, or later) with neither, it says to sign in once approved.
 */
import { isApiError, type Me } from '@fs/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { meQueryKey } from '../../../api/hooks';
import { useApi } from '../../../api/provider';
import { homeFor } from '../../../app/guards';
import { clearDeviceKey, deviceLabel, setDeviceServerState } from '../../../lib/device-key';
import { staffSignIn } from '../lib/device';
import { describeAuthError } from '../lib/errors';
import { withFlags } from '../lib/flags';
import { useOwnerNames } from '../lib/hooks';
import { dropPendingSignIn, pendingSignIn } from '../lib/pending';
import { readOrgContact, saveOrgContact } from '../lib/storage';
import { Button, ButtonLink, Card, ExternalButton, Lead, StatusChip, Title } from '../ui/bits';
import { StaffAppOnly } from '../ui/browser-tab';
import { Icon } from '../ui/icons';
import { AuthScreen } from '../ui/layout';
import type { WaitingState } from './join';

const POLL_MS = 15_000;

type View = 'waiting' | 'rejected' | 'signedOut';

function WaitingFlow() {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const replacing = (location.state as WaitingState | null)?.replacing === true;

  const [creds] = useState(pendingSignIn);
  const mode: 'session' | 'login' = creds ? 'login' : 'session';
  const [view, setView] = useState<View>('waiting');
  const [label, setLabel] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const hadSession = useRef(false);
  const stopped = useRef(false);

  const me = useQuery<Me | null>({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (isApiError(e, 'UNAUTHENTICATED')) return null;
        throw e;
      }
    },
    enabled: mode === 'session' && view === 'waiting',
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });

  const contact = me.data?.org ?? null;
  const names = useOwnerNames(contact?.ownerDisplayName ?? null);
  const ownerPhone = contact?.contactPhone ?? readOrgContact().ownerPhone;

  const approved = useCallback(
    async (next: Me) => {
      if (stopped.current) return;
      stopped.current = true;
      if (next.device) {
        try {
          await setDeviceServerState(next.device.id, true);
        } catch {
          // no local record (storage cleared): the server's answer still stands
        }
      }
      dropPendingSignIn();
      queryClient.setQueryData(meQueryKey, next);
      saveOrgContact({ ownerName: next.org.ownerDisplayName, ownerPhone: next.org.contactPhone });
      navigate(withFlags(homeFor(next.user.role)), { replace: true });
    },
    [navigate, queryClient],
  );

  const rejected = useCallback(async () => {
    if (stopped.current) return;
    stopped.current = true;
    dropPendingSignIn();
    await clearDeviceKey();
    setView('rejected');
  }, []);

  // The device label for the status card, from Me or this phone's record.
  useEffect(() => {
    if (me.data?.device?.label) setLabel(me.data.device.label);
  }, [me.data]);

  // Session mode: react to each `me`.
  useEffect(() => {
    if (mode !== 'session' || me.isPending || stopped.current) return;
    const data = me.data;
    if (data === undefined) return;
    if (data === null) {
      if (hadSession.current) void rejected();
      else setView('signedOut');
      return;
    }
    hadSession.current = true;
    const status = data.device?.status;
    if (status === 'approved') void approved(data);
    else if (status === 'rejected' || status === 'revoked') void rejected();
  }, [mode, me.data, me.isPending, approved, rejected]);

  // Login mode: retry sign-in while visible.
  const inFlight = useRef(false);
  const tryLogin = useCallback(async () => {
    if (!creds || inFlight.current || stopped.current) return;
    if (document.visibilityState !== 'visible') return;
    inFlight.current = true;
    setChecking(true);
    try {
      await approved(await staffSignIn(api, creds));
    } catch (e) {
      const copy = describeAuthError(e, 'staffLogin');
      if (copy.action === 'waiting' || copy.key === 'auth:errors.network') {
        // still pending, or offline for a moment: keep waiting
      } else if (copy.action === 'rejected' || copy.action === 'unknownDevice') {
        await rejected();
      } else {
        // PIN changed or locked, account off: stop retrying and ask for a fresh sign-in.
        stopped.current = true;
        dropPendingSignIn();
        setView('signedOut');
      }
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [api, creds, approved, rejected]);

  useEffect(() => {
    if (mode !== 'login') return;
    void deviceLabel().then(setLabel, () => undefined);
    const timer = setInterval(() => void tryLogin(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tryLogin();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, tryLogin]);

  const checkNow = () => {
    if (mode === 'login') void tryLogin();
    else void me.refetch();
  };

  if (view === 'rejected') {
    return (
      <AuthScreen>
        <Title>{t('auth:waiting.rejectedTitle')}</Title>
        <Card className="mt-6">
          <StatusChip tone="rejected">{t('auth:waiting.chipRejected')}</StatusChip>
          <p data-testid="waiting-rejected" className="mt-4 text-base text-text">
            {t('auth:errors.deviceRejected', names)}
          </p>
        </Card>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          {ownerPhone ? (
            <ExternalButton href={`tel:${ownerPhone}`} icon="phone">
              {t('auth:waiting.call', names)}
            </ExternalButton>
          ) : null}
          <ButtonLink
            to={withFlags('/signin')}
            variant="quiet"
            full={false}
            className="self-center"
          >
            {t('auth:waiting.backToSignIn')}
          </ButtonLink>
        </div>
      </AuthScreen>
    );
  }

  if (view === 'signedOut') {
    return (
      <AuthScreen>
        <Title>{t('auth:waiting.title')}</Title>
        <Lead>{t('auth:waiting.signInLater', names)}</Lead>
        <div className="mt-auto pt-8">
          <ButtonLink to={withFlags('/signin')} variant="primary" icon="sign-in">
            {t('auth:signIn.submit')}
          </ButtonLink>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen busy={me.isPending && mode === 'session'}>
      <Title>{t('auth:waiting.title')}</Title>
      <Lead>{t('auth:waiting.body', names)}</Lead>
      <Card className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Icon name="device-mobile" className="mt-0.5 size-6 text-text" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-muted">{t('auth:waiting.thisPhone')}</p>
              <p className="truncate text-base font-bold text-text">
                {label ?? t('auth:waiting.thisPhoneUnknown')}
              </p>
            </div>
          </div>
          <StatusChip tone="waiting">{t('auth:waiting.chip')}</StatusChip>
        </div>
        {replacing ? (
          <p className="mt-4 border-t border-border pt-4 text-sm text-text-body">
            {t('auth:waiting.replacing', names)}
          </p>
        ) : null}
      </Card>
      <p className="mt-4 text-sm text-text-muted" aria-live="polite">
        {checking ? t('auth:waiting.checking') : t('auth:waiting.auto')}
      </p>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        {ownerPhone ? (
          <ExternalButton href={`tel:${ownerPhone}`} icon="phone">
            {t('auth:waiting.call', names)}
          </ExternalButton>
        ) : null}
        <Button
          variant="quiet"
          full={false}
          className="self-center"
          icon="arrows-clockwise"
          onClick={checkNow}
          disabled={checking || me.isFetching}
        >
          {t('auth:waiting.checkNow')}
        </Button>
      </div>
    </AuthScreen>
  );
}

export function WaitingScreen() {
  return (
    <StaffAppOnly>
      <WaitingFlow />
    </StaffAppOnly>
  );
}
