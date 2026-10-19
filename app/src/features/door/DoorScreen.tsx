/**
 * The door screen `/door` (PRD 4.5, 5.2 "Door screen"): pair with the owner's 8-character code,
 * then show the rotating QR full screen with a quiet countdown and the last check-in.
 */
import { istTime } from '@fs/contracts';
import { Button, CodeField, Field } from '@fs/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { qrPath } from './lib/qr-path';
import { useDoor } from './lib/use-door';

export function DoorScreen() {
  const { t } = useTranslation('door');
  const door = useDoor();

  if (door.phase === 'loading') {
    return <main aria-busy="true" className="min-h-dvh bg-bg" />;
  }
  if (door.phase === 'unpaired') {
    return <PairForm busy={door.pairBusy} error={door.pairError} onPair={door.pair} />;
  }

  const { code } = door;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-6 py-8 text-center">
      <h1 className="text-xl font-extrabold text-text">{door.pairing?.siteName}</h1>
      {code ? (
        <>
          <QrCode value={code.url} label={t('qr.label')} />
          <p className="text-lg font-semibold text-text-body">{t('scanHint')}</p>
          <p className="text-sm text-text-muted" aria-live="off">
            {t('rotates', { count: code.secondsLeft })}
          </p>
        </>
      ) : (
        <p role="status" className="text-lg text-text-body">
          {t('clockNotSynced')}
        </p>
      )}
      <p className="text-sm text-text-muted">
        {door.lastCheckIn
          ? t('lastCheckIn', {
              name: door.lastCheckIn.firstName,
              time: istTime(door.lastCheckIn.at),
            })
          : t('noCheckInYet')}
      </p>
      {door.offline ? (
        <p role="status" className="text-sm text-text-muted">
          {t('offline')}
        </p>
      ) : null}
    </main>
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
      className="aspect-square w-full max-w-[min(80vw,70vh)] rounded-md border border-border bg-white"
    >
      <path d={qr.d} className="fill-ink-900" />
    </svg>
  );
}

function PairForm({
  busy,
  error,
  onPair,
}: {
  busy: boolean;
  error: 'format' | 'wrong' | 'network' | null;
  onPair: (code: string) => void;
}) {
  const { t } = useTranslation('door');
  const [code, setCode] = useState('');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center gap-6 bg-bg px-5 py-8">
      <h1 className="text-xl font-extrabold text-text">{t('pair.title')}</h1>
      <p className="text-base text-text-body">{t('pair.lead')}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onPair(code);
        }}
      >
        <Field label={t('pair.label')} error={error ? t(`pair.error.${error}`) : undefined}>
          <CodeField value={code} onValueChange={setCode} onComplete={onPair} />
        </Field>
        <Button
          type="submit"
          variant="primary"
          block
          loading={busy}
          loadingLabel={t('pair.pairing')}
        >
          {t('pair.submit')}
        </Button>
      </form>
    </main>
  );
}
