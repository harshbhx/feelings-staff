/**
 * Show door code (PRD 4.5, 5.2, O-10.3): Urmi's phone becomes the door. A full-screen QR of the
 * current token for the salon, "New code in 12 s" as plain text (no looping animation), a new token
 * fetched as soon as the old one runs out, the screen kept awake, and **Done**. Offline it says why
 * there is no code. No step-up: anyone allowed to open it may show it.
 */
import { Button } from '@fs/ui';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { qrPath } from '../../door/lib/qr-path';
import { useDoorCode } from '../api/schedule';
import { useNow } from '../components/layout';
import { ErrorCard } from '../components/states';
import { useOnline } from '../shell/hooks';

export function DoorCodeScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const code = useDoorCode(online);
  const now = useNow(1_000);
  useWakeLock();

  const left = code.data ? Math.max(0, Math.ceil((code.data.expiresAt - now) / 1_000)) : 0;
  const done = () => navigate(-1);

  let body: ReactNode;
  if (!online) {
    body = (
      <p role="status" className="max-w-[24rem] text-center text-text-body">
        {t('owner:door.offline')}
      </p>
    );
  } else if (code.data) {
    body = (
      <>
        <QrCode
          value={code.data.url}
          label={t('owner:door.qrLabel', { name: code.data.siteName })}
        />
        <p className="font-semibold text-text tabular-nums" data-testid="door-countdown">
          {left > 0 ? t('owner:door.newIn', { count: left }) : t('owner:door.refreshing')}
        </p>
      </>
    );
  } else if (code.isError) {
    body = <ErrorCard error={code.error} onRetry={() => void code.refetch()} />;
  } else {
    body = (
      <div
        className="aspect-square w-full max-w-[min(80vw,60vh)] rounded-md bg-bg-tint"
        role="status"
        aria-label={t('owner:common.loading')}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-testid="door-code"
    >
      <div className="mx-auto flex w-full max-w-[40rem] items-center justify-between gap-3 px-(--gutter) py-3">
        <div className="min-w-0">
          <h2 className="truncate font-extrabold text-text text-xl tracking-display">
            {t('owner:door.title')}
          </h2>
          {code.data ? (
            <p className="truncate text-sm text-text-muted">{code.data.siteName}</p>
          ) : null}
        </div>
        <Button variant="primary" onClick={done}>
          {t('owner:door.done')}
        </Button>
      </div>
      <div className="mx-auto flex w-full max-w-[40rem] flex-1 flex-col items-center justify-center gap-5 px-(--gutter) pb-6">
        <p className="text-center text-text-body">{t('owner:door.lead')}</p>
        {body}
        <p className="max-w-[26rem] text-center text-sm text-text-muted">{t('owner:door.help')}</p>
      </div>
    </div>
  );
}

function QrCode({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full max-w-[min(80vw,60vh)] rounded-md bg-bg"
      data-testid="door-qr"
    >
      <path d={qr.d} className="fill-ink-900" />
    </svg>
  );
}

type WakeLockSentinelLike = { release(): Promise<void> };

/** Keep the screen on while the code is shown; take the lock again when the tab comes back. */
function useWakeLock() {
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null;
    let live = true;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    const acquire = async () => {
      if (!nav.wakeLock || document.visibilityState !== 'visible') return;
      try {
        const s = await nav.wakeLock.request('screen');
        if (live) sentinel = s;
        else await s.release();
      } catch {
        // Not allowed right now (low battery, background): try again on the next visibility change.
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
