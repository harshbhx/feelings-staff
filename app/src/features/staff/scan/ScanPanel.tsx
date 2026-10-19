/**
 * Door QR scanner UI (PRD 4.5, 5.1 Scan): rear-camera viewport with a square guide, torch where
 * supported, and "Type the code" as the manual fallback (10 characters). Decoding uses the
 * browser's BarcodeDetector where it exists (Chrome on Android); WP-4's `app/src/lib/qr/` adds the
 * jsQR worker for iPhones and replaces `detectOnce` when it lands.
 */
import { Button, Field, Icon, Input } from '@fs/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ScanError = 'expired' | 'other_site' | 'not_ours' | null;

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Pull the 10-character token from a door URL `.../q/<siteId>/<token>` or a bare token. */
export function tokenFromScan(raw: string): string | null {
  const text = raw.trim();
  const m = /\/q\/[^/]+\/([0-9A-Za-z]{10})\/?$/.exec(text);
  if (m?.[1]) return m[1].toUpperCase();
  if (/^[0-9A-Za-z]{10}$/.test(text)) return text.toUpperCase();
  return null;
}

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
  const track = useRef<MediaStreamTrack | null>(null);
  const hintId = useId();

  useEffect(() => {
    if (!camera || manual || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;

    const loop = async () => {
      if (stopped || !detector || !video.current) return;
      try {
        if (video.current.readyState >= 2) {
          const found = await detector.detect(video.current);
          const raw = found[0]?.rawValue;
          if (raw) {
            const token = tokenFromScan(raw);
            if (token) {
              onToken(token);
              return;
            }
            setNotOurs(true);
          }
        }
      } catch {
        // a frame that could not be read; keep going
      }
      timer = setTimeout(() => void loop(), 300);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: false })
      .then((s) => {
        if (stopped) {
          for (const tr of s.getTracks()) tr.stop();
          return;
        }
        stream = s;
        const tr = s.getVideoTracks()[0] ?? null;
        track.current = tr;
        const caps = tr?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        if (caps?.torch) setTorch(false);
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        void loop();
      })
      .catch(() => setDenied(true));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const tr of stream?.getTracks() ?? []) tr.stop();
      track.current = null;
    };
  }, [camera, manual, onToken]);

  const toggleTorch = async () => {
    if (!track.current || torch === null) return;
    const next = !torch;
    try {
      await track.current.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setTorch(next);
    } catch {
      setTorch(null);
    }
  };

  const message =
    error === 'expired'
      ? t('staff:scan.expired')
      : error === 'other_site'
        ? t('staff:scan.otherSite')
        : error === 'not_ours' || notOurs
          ? t('staff:scan.notOurs')
          : denied
            ? t('staff:scan.cameraOff')
            : null;

  if (manual) {
    const token = tokenFromScan(code);
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
