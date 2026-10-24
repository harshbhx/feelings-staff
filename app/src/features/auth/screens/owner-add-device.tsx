/**
 * "Add this device" on the owner host (docs/owner-access.md "Passkeys" flow 3, ui-redesign-plan 5b): a
 * new device asks to join, shows a large 6-digit code ("482 913") and a countdown in plain words, and
 * polls quietly until the owner approves it on a phone that already has a passkey. Then this device
 * creates its own passkey with the enrolment token it was given (kept in memory only, never shown).
 * Declined and expired requests say so in a live region and offer to ask again. Owner build only.
 */
import { isApiError, type OwnerDeviceRequestCreated, type Platform } from '@fs/contracts';
import { Button } from '@fs/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../../../api/provider';
import { groupCode, minutesLeft, spokenCode } from '../lib/device-code';
import { platformOf } from '../lib/passkey';
import { ErrorNote, Lead, Stepper, Title } from '../ui/bits';
import { AuthScreen } from '../ui/layout';
import { OwnerEnrolScreen } from './owner-enrol';

/** How often the new device asks whether it was approved. */
const POLL_MS = 3_000;
/** The request lives 15 minutes on the server; the countdown runs on this device's clock. */
const REQUEST_TTL_MS = 15 * 60_000;

/** How the request shows on the approval card (the owner names the phone after it is added). */
const DEVICE_LABEL: Record<Platform, string> = {
  ios: 'owner:access.add.label.ios',
  android: 'owner:access.add.label.android',
  desktop: 'owner:access.add.label.desktop',
  other: 'owner:access.add.label.other',
};

type Phase =
  | { kind: 'asking' }
  | { kind: 'waiting'; request: OwnerDeviceRequestCreated; deadline: number }
  | { kind: 'approved'; request: OwnerDeviceRequestCreated }
  | { kind: 'ended'; reason: 'declined' | 'expired' }
  | { kind: 'failed'; key: string };

export function OwnerAddDeviceScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'asking' });
  const [now, setNow] = useState(() => Date.now());
  const asking = useRef(false);

  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    setPhase({ kind: 'asking' });
    try {
      const platform = platformOf();
      const request = await api.ownerDeviceRequestCreate({
        body: { deviceName: t(DEVICE_LABEL[platform]), platform },
      });
      setNow(Date.now());
      setPhase({ kind: 'waiting', request, deadline: Date.now() + REQUEST_TTL_MS });
    } catch (e) {
      setPhase({
        kind: 'failed',
        key:
          isApiError(e, 'RULE_VIOLATION') && e.details?.reason === 'no_device'
            ? 'owner:access.add.noDevice'
            : isApiError(e, 'RATE_LIMITED')
              ? 'owner:access.add.rateLimited'
              : 'owner:access.add.failed',
      });
    } finally {
      asking.current = false;
    }
  }, [api, t]);

  // One request when the screen opens (not one per render); "Ask again" makes the next.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
  }, [ask]);

  // Quiet polling while the code is on screen; a dropped connection just waits for the next round.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const { request, deadline } = phase;
    let stopped = false;
    const tick = async () => {
      const at = Date.now();
      setNow(at);
      try {
        const state = await api.ownerDeviceRequestStatus({
          params: { id: request.id },
          body: { enrolToken: request.enrolToken },
        });
        if (stopped) return;
        if (state.status === 'approved') setPhase({ kind: 'approved', request });
        else if (state.status === 'declined' || state.status === 'expired')
          setPhase({ kind: 'ended', reason: state.status });
        else if (at >= deadline) setPhase({ kind: 'ended', reason: 'expired' });
      } catch (e) {
        if (stopped) return;
        if (isApiError(e, 'LINK_EXPIRED') || isApiError(e, 'NOT_FOUND') || at >= deadline)
          setPhase({ kind: 'ended', reason: 'expired' });
      }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [api, phase]);

  if (phase.kind === 'approved') return <OwnerEnrolScreen enrolToken={phase.request.enrolToken} />;

  const back = () => navigate('/auth/owner', { replace: true });
  const status =
    phase.kind === 'ended'
      ? t(phase.reason === 'declined' ? 'owner:access.add.declined' : 'owner:access.add.expired')
      : '';

  return (
    <AuthScreen>
      <Stepper step={1} total={3} />
      <Title>{t('owner:access.add.title')}</Title>
      <Lead>{t('owner:access.add.lead')}</Lead>

      {phase.kind === 'waiting' || phase.kind === 'asking' ? (
        <div
          className="mt-8 grid gap-2 rounded-md bg-bg p-6 text-center"
          data-testid="device-code"
        >
          <p className="font-semibold text-sm text-text-muted">{t('owner:access.add.codeLabel')}</p>
          {phase.kind === 'waiting' ? (
            <>
              <p className="font-extrabold text-4xl text-text tabular-nums tracking-[0.08em]">
                <span aria-hidden="true">{groupCode(phase.request.code)}</span>
                <span className="sr-only">{spokenCode(phase.request.code)}</span>
              </p>
              <p className="text-sm text-text-body">
                {minutesLeft(phase.deadline, now) > 1
                  ? t('owner:access.add.expiresIn', { count: minutesLeft(phase.deadline, now) })
                  : t('owner:access.add.expiresSoon')}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-body">{t('owner:access.add.asking')}</p>
          )}
        </div>
      ) : null}

      <div className="mt-6 min-h-6">
        {phase.kind === 'failed' ? <ErrorNote>{t(phase.key)}</ErrorNote> : null}
        <p role="status" className="font-semibold text-text">
          {status}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        {phase.kind === 'ended' || phase.kind === 'failed' ? (
          <Button variant="primary" block onClick={() => void ask()}>
            {t('owner:access.add.again')}
          </Button>
        ) : null}
        <Button variant={phase.kind === 'waiting' ? 'secondary' : 'ghost'} block onClick={back}>
          {phase.kind === 'waiting'
            ? t('owner:access.add.cancel')
            : t('owner:access.add.backToSignIn')}
        </Button>
      </div>
    </AuthScreen>
  );
}
