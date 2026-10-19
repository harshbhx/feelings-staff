/**
 * Evidence for one punch (PRD 4.12 flagged/pending, 5.2 day detail): the reasons in words, distance
 * and accuracy, checks passed, the map with the fence circle (lazy), and the selfie with "compare
 * with the joining photo".
 */
import type { OwnerPunchView, SiteView } from '@fs/contracts';
import { Button, Icon, Sheet } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../../api/provider';
import { POSITIVE_SIGNALS, riskKey } from '../lib/status';
import { EvidenceMap } from '../map/EvidenceMap';

export function RiskReasons({ punch }: { punch: OwnerPunchView }) {
  const { t } = useTranslation();
  const worries = punch.riskReasons.filter((r) => !POSITIVE_SIGNALS.includes(r));
  const good = punch.riskReasons.filter((r) => POSITIVE_SIGNALS.includes(r));
  if (worries.length === 0 && good.length === 0) return null;
  return (
    <ul className="grid gap-1 text-sm">
      {worries.map((r) => (
        <li key={r} className="flex items-start gap-2 text-text-body">
          <Icon name="warning-circle" className="mt-0.5 shrink-0 text-accent" />
          <span>{t(riskKey(r))}</span>
        </li>
      ))}
      {good.map((r) => (
        <li key={r} className="flex items-start gap-2 text-text-muted">
          <Icon name="check-circle" className="mt-0.5 shrink-0 text-present" />
          <span>{t(riskKey(r))}</span>
        </li>
      ))}
    </ul>
  );
}

/** "94 m from the centre · Accuracy 38 m · Phone: Realme 11x". */
export function PunchFacts({ punch }: { punch: OwnerPunchView }) {
  const { t } = useTranslation();
  const parts = [
    punch.fenceResult ? t(`owner:punch.fence.${punch.fenceResult}`) : null,
    punch.distanceM !== null ? t('owner:punch.distance', { m: punch.distanceM }) : null,
    punch.accuracyM !== null ? t('owner:punch.accuracy', { m: Math.round(punch.accuracyM) }) : null,
    punch.deviceLabel ? t('owner:punch.device', { label: punch.deviceLabel }) : null,
    punch.qrVerified ? t('owner:punch.qr') : null,
  ].filter(Boolean);
  return <p className="text-sm text-text-muted">{parts.join(' · ')}</p>;
}

export function PunchMap({
  punch,
  site,
  height,
}: {
  punch: Pick<OwnerPunchView, 'lat' | 'lng' | 'accuracyM'>;
  site: Pick<SiteView, 'lat' | 'lng' | 'radiusM'> | null;
  height?: string;
}) {
  const { t } = useTranslation();
  const centre = site
    ? { lat: site.lat, lng: site.lng }
    : punch.lat !== null && punch.lng !== null
      ? { lat: punch.lat, lng: punch.lng }
      : null;
  if (!centre) return <p className="text-sm text-text-muted">{t('owner:day.mapNone')}</p>;
  return (
    <EvidenceMap
      label={t('owner:actions.map.label')}
      centre={centre}
      radiusM={site?.radiusM}
      pin={
        punch.lat !== null && punch.lng !== null
          ? { lat: punch.lat, lng: punch.lng, accuracyM: punch.accuracyM }
          : undefined
      }
      height={height}
    />
  );
}

/** A map behind a "Show on map" button, so a long queue does not load a map per item. */
export function MapToggle(props: Parameters<typeof PunchMap>[0]) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  if (shown) return <PunchMap {...props} />;
  return (
    <div>
      <Button size="sm" variant="ghost" icon="map-pin" onClick={() => setShown(true)}>
        {t('owner:actions.map.open')}
      </Button>
    </div>
  );
}

function Photo({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <span className="grid aspect-square w-full place-items-center rounded-md bg-bg-tint p-3 text-center text-sm text-text-muted">
        {t('owner:common.photoMissing')}
      </span>
    );
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="aspect-square w-full rounded-md border border-border object-cover"
    />
  );
}

/** Selfie thumbnail; tapping opens the comparison with the enrolled (joining) photo. */
export function SelfieCompare({
  selfieUrl,
  userId,
  name,
  enrolledUrl,
}: {
  selfieUrl: string;
  userId: string;
  name: string;
  enrolledUrl?: string | null;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const enrolled = enrolledUrl ?? api.url('ownerStaffPhoto', { params: { id: userId } });
  return (
    <Sheet
      title={t('owner:actions.map.compare')}
      trigger={
        <button
          type="button"
          className="w-24 rounded-md text-left"
          aria-label={`${t('owner:actions.map.selfie')}. ${t('owner:actions.map.compare')}`}
        >
          <Photo src={selfieUrl} alt={t('owner:actions.map.selfie')} />
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <figure className="grid gap-1">
          <Photo src={selfieUrl} alt={`${t('owner:actions.map.selfie')}: ${name}`} />
          <figcaption className="text-sm text-text-muted">
            {t('owner:actions.map.selfie')}
          </figcaption>
        </figure>
        <figure className="grid gap-1">
          <Photo src={enrolled} alt={`${t('owner:actions.map.enrolled')}: ${name}`} />
          <figcaption className="text-sm text-text-muted">
            {t('owner:actions.map.enrolled')}
          </figcaption>
        </figure>
      </div>
    </Sheet>
  );
}
