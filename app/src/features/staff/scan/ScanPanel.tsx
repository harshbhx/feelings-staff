/**
 * Door QR scanner UI (PRD 4.5, 5.1 Scan; S-06.5): rear-camera viewport with a square guide, torch
 * where supported, and "Type the code" as the manual fallback (10 characters). Decoding is WP-4's
 * `app/src/lib/qr/` (BarcodeDetector where the browser has it, else jsQR in a worker, so iPhones
 * scan too); the scanner module loads only when the camera view opens.
 */
import { Button, Field, Icon, Input } from '@fs/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QrRejectReason } from '../../../lib/punch';
import { normaliseDoorToken, parseDoorUrl } from '../../../lib/qr';
import type { QrScanner } from '../../../lib/qr/scanner';

/** What the panel says under the viewport; `network` and `failed` come from sending the code. */
export type ScanError = 'expired' | 'other_site' | 'not_ours' | 'network' | 'failed' | null;

/** The server's door-code rejections (WP-4 `qr_rejected`) in the panel's words. */
export const QR_SCAN_ERROR: Record<QrRejectReason, Exclude<ScanError, null>> = {
  qr_expired: 'expired',
  qr_reused: 'expired',
  qr_other_site: 'other_site',
  qr_invalid: 'not_ours',
};

export function ScanPanel({
  onToken,
  error,
  camera = true,
}: {
  onToken: (token: string) => void;
  error: ScanError;
  /** Off for frozen visual states: the viewport stays a still placeholder. */
  camera?: boolean;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [denied, setDenied] = useState(false);
  const [torch, setTorch] = useState<null | boolean>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [notOurs, setNotOurs] = useState(false);
  const scanner = useRef<QrScanner | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const hintId = useId();

  useEffect(() => {
    const el = video.current;
    if (!camera || manual || !el) return;
    let stopped = false;
    let found = false;
    void import('../../../lib/qr/scanner')
      .then(({ createScanner }) =>
        createScanner(el, {
          onDecode: (text) => {
            if (stopped || found) return;
            const parsed = parseDoorUrl(text);
            if (!parsed.ok) {
              setNotOurs(true);
              return;
            }
            // One code per scan; the parent remounts the panel (key) to scan again.
            found = true;
            scanner.current?.stop();
            onTokenRef.current(parsed.token);
          },
        }),
      )
      .then((s) => {
        if (stopped || found) {
          s.stop();
          return;
        }
        scanner.current = s;
        if (s.torchAvailable) setTorch(false);
      })
      .catch(() => {
        if (!stopped) setDenied(true);
      });
    return () => {
      stopped = true;
      scanner.current?.stop();
      scanner.current = null;
    };
  }, [camera, manual]);

  const toggleTorch = async () => {
    if (!scanner.current || torch === null) return;
    const next = !torch;
    if (await scanner.current.setTorch(next)) setTorch(next);
    else setTorch(null);
  };

  const message =
    error === 'expired'
      ? t('staff:scan.expired')
      : error === 'other_site'
        ? t('staff:scan.otherSite')
        : error === 'not_ours' || notOurs
          ? t('staff:scan.notOurs')
          : error === 'network'
            ? t('errors:network')
            : error === 'failed'
              ? t('errors:generic')
              : denied
                ? t('staff:scan.cameraOff')
                : null;

  if (manual) {
    const token = normaliseDoorToken(code);
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (token) onToken(token);
        }}
      >
        <Field
          label={t('staff:scan.codeLabel')}
          hint={t('staff:scan.codeHint')}
          error={message ?? undefined}
        >
          <Input
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, '')
                  .slice(0, 10),
              )
            }
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={10}
            className="tabular tracking-widest"
          />
        </Field>
        <Button type="submit" variant="secondary" block disabled={!token}>
          {t('staff:scan.submit')}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p id={hintId} className="text-sm">
        {t('staff:scan.hint')}
      </p>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-bg-deepest">
        {camera && !denied ? (
          <video
            ref={video}
            className="size-full object-cover"
            playsInline
            muted
            autoPlay
            aria-label={t('staff:scan.videoLabel')}
            aria-describedby={hintId}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[18%] rounded-md border-2 border-white/80"
        />
      </div>
      {message ? (
        <p className="font-semibold text-absent" role="alert">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {torch !== null ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void toggleTorch()}
            aria-pressed={torch}
          >
            <Icon name="flashlight" />
            {torch ? t('staff:scan.torchOff') : t('staff:scan.torchOn')}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setManual(true)}>
          <Icon name="keyboard" />
          {t('staff:scan.typeCode')}
        </Button>
      </div>
    </div>
  );
}
