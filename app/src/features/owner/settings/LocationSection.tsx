/**
 * Location and door (PRD 4.5, 4.15.2, 4.17, O-09, O-10): the salon pin and circle on the map, the
 * circle size and the worst accuracy accepted (step-up), calibration at the counter (60 s per
 * session, the server proposes after two; "Use this" or "Keep current"), and the door devices with
 * Pair, Rotate and Remove. Strong mode and the earliest check-in live in Attendance rules.
 */
import type { CalibrationProposal, DoorDeviceView, SiteView } from '@fs/contracts';
import {
  Banner,
  Button,
  Field,
  Input,
  List,
  ListRow,
  Sheet,
  StatusChip,
  Stepper,
  useToast,
} from '@fs/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { ownerKeys } from '../api/keys';
import { useOwnerMutation } from '../api/query';
import { useSites } from '../api/schedule';
import {
  useCalibrationProposal,
  useDoorDevices,
  usePatchSite,
  useStoreCalibration,
} from '../api/settings';
import { Meta, Section } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { clock, shortDate, todayIst } from '../lib/format';
import { EvidenceMap } from '../map/EvidenceMap';
import { CALIBRATION_MS, collectFixes, platformOf } from './calibration';

function useFeedback() {
  const toast = useToast();
  const errorText = useErrorText();
  const { t } = useTranslation();
  return {
    ok: (title?: string) => toast({ title: title ?? t('owner:settings.saved') }),
    fail: (e: unknown) => {
      if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
    },
  };
}

export function LocationSection() {
  const sites = useSites();
  return (
    <QueryView query={sites} skeleton={<RowsSkeleton rows={4} />}>
      {(list) => {
        const salon = list.find((s) => s.kind === 'salon' && s.active) ?? list[0];
        return salon ? <Location site={salon} /> : null;
      }}
    </QueryView>
  );
}

function Location({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const patch = usePatchSite();
  const [radius, setRadius] = useState(site.radiusM);
  const [accuracy, setAccuracy] = useState(site.maxAccuracyM);
  const changed = radius !== site.radiusM || accuracy !== site.maxAccuracyM;
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-10">
      <Section title={t('owner:settings.location.title')}>
        <EvidenceMap
          centre={{ lat: site.lat, lng: site.lng }}
          radiusM={radius}
          label={t('owner:settings.location.map', { name: site.name })}
          height="16rem"
        />
        <Meta>
          {t('owner:settings.location.pin', { lat: site.lat.toFixed(6), lng: site.lng.toFixed(6) })}
        </Meta>
        <div className="grid gap-6 pt-2">
          <Stepper
            label={t('owner:settings.location.radius')}
            hint={t('owner:settings.location.radiusWhat', { value: radius })}
            value={radius}
            onValueChange={setRadius}
            min={50}
            max={300}
            step={25}
            unit="m"
          />
          <Stepper
            label={t('owner:settings.location.accuracy')}
            hint={t('owner:settings.location.accuracyWhat', { value: accuracy })}
            value={accuracy}
            onValueChange={setAccuracy}
            min={30}
            max={100}
            step={10}
            unit="m"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon="lock"
              disabled={!changed || patch.isPending}
              onClick={() =>
                patch.mutate(
                  { id: site.id, patch: { radiusM: radius, maxAccuracyM: accuracy } },
                  { onSuccess: () => fb.ok(), onError: fb.fail },
                )
              }
            >
              {patch.isPending ? t('owner:common.saving') : t('owner:common.save')}
            </Button>
            <Meta>{t('owner:settings.needsPin')}</Meta>
          </div>
        </div>
      </Section>
      <Calibrate site={site} />
      <DoorDevices />
      <Meta>
        {t('owner:settings.location.strongNote')}{' '}
        <Link
          to="/o/settings/attendance"
          className="font-semibold text-text underline underline-offset-4"
        >
          {t('owner:settings.sections.attendance.title')}
        </Link>
      </Meta>
    </div>
  );
}

/** Calibration at the counter (PRD 4.15.2); exported for the setup checklist. */
export function Calibrate({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const store = useStoreCalibration(site.id);
  const proposal = useCalibrationProposal(site.id);
  const patch = usePatchSite();
  const [live, setLive] = useState<{ best: number; count: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const run = useRef<ReturnType<typeof collectFixes> | null>(null);

  const start = async () => {
    setProblem(null);
    setLive({ best: 0, count: 0 });
    run.current = collectFixes((best, count) => setLive({ best: Math.round(best), count }));
    const { fixes, error } = await run.current.promise;
    run.current = null;
    setLive(null);
    if (error === 'denied') return setProblem(t('owner:settings.calibrate.denied'));
    if (fixes.length === 0) return setProblem(t('owner:settings.calibrate.noFix'));
    store.mutate(
      {
        sessionId: crypto.randomUUID(),
        platform: platformOf(navigator.userAgent),
        samples: fixes,
      },
      { onSuccess: () => fb.ok(t('owner:settings.calibrate.stored')), onError: fb.fail },
    );
  };

  const p: CalibrationProposal | undefined = proposal.data;
  const differs =
    p?.enoughData &&
    (p.radiusM !== site.radiusM ||
      Math.abs(p.centre.lat - site.lat) > 1e-6 ||
      Math.abs(p.centre.lng - site.lng) > 1e-6);

  return (
    <Section title={t('owner:settings.calibrate.title')}>
      <Meta>{t('owner:settings.calibrate.how')}</Meta>
      {live ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p className="font-semibold text-text tabular-nums">
            {live.count > 0
              ? t('owner:settings.calibrate.live', { m: live.best, count: live.count })
              : t('owner:settings.calibrate.waiting')}
          </p>
          <Button size="sm" onClick={() => run.current?.stop()}>
            {t('owner:settings.calibrate.stop')}
          </Button>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            icon="navigation"
            onClick={() => void start()}
            disabled={store.isPending}
          >
            {t('owner:settings.calibrate.start', { s: CALIBRATION_MS / 1000 })}
          </Button>
        </div>
      )}
      {problem ? <Banner icon="warning-circle">{problem}</Banner> : null}
      {p && !p.enoughData ? (
        <Meta>{t('owner:settings.calibrate.more', { count: p.stats.sessions })}</Meta>
      ) : null}
      {p?.enoughData && differs && !kept ? (
        <div
          className="grid gap-3 rounded-md border border-border p-4"
          data-testid="calibration-proposal"
        >
          <p className="font-semibold text-text">
            {t('owner:settings.calibrate.proposal', {
              radius: p.radiusM,
              sessions: p.stats.sessions,
              p95: Math.round(p.stats.p95DistanceM),
            })}
          </p>
          <EvidenceMap
            centre={p.centre}
            radiusM={p.radiusM}
            oldCircle={{ centre: { lat: site.lat, lng: site.lng }, radiusM: site.radiusM }}
            label={t('owner:settings.calibrate.compare')}
            height="14rem"
          />
          <Meta>{t('owner:settings.calibrate.legend')}</Meta>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon="lock"
              disabled={patch.isPending}
              onClick={() =>
                patch.mutate(
                  {
                    id: site.id,
                    patch: { lat: p.centre.lat, lng: p.centre.lng, radiusM: p.radiusM },
                  },
                  { onSuccess: () => fb.ok(), onError: fb.fail },
                )
              }
            >
              {t('owner:settings.calibrate.use')}
            </Button>
            <Button variant="ghost" onClick={() => setKept(true)}>
              {t('owner:settings.calibrate.keep')}
            </Button>
          </div>
        </div>
      ) : null}
      {p?.enoughData && !differs ? <Meta>{t('owner:settings.calibrate.same')}</Meta> : null}
    </Section>
  );
}

function DoorDevices() {
  const { t } = useTranslation();
  const devices = useDoorDevices();
  return (
    <Section title={t('owner:settings.door.title')}>
      <Meta>{t('owner:settings.door.what')}</Meta>
      <QueryView
        query={devices}
        skeleton={<RowsSkeleton rows={2} />}
        isEmpty={(list) => list.filter((d) => d.status !== 'revoked').length === 0}
        empty={<Meta>{t('owner:settings.door.none')}</Meta>}
      >
        {(list) => (
          <List>
            {list
              .filter((d) => d.status !== 'revoked')
              .map((d) => (
                <DeviceRow key={d.id} device={d} />
              ))}
          </List>
        )}
      </QueryView>
      <div>
        <PairSheet />
      </div>
    </Section>
  );
}

function useDoorMutations() {
  return {
    pair: useOwnerMutation({
      run: (api, label: string, call) => api.ownerDoorDeviceCreate({ body: { label } }, call),
      invalidate: () => [ownerKeys.doorDevices()],
    }),
    rotate: useOwnerMutation({
      run: (api, id: string, call) => api.ownerDoorDeviceRotate({ params: { id } }, call),
      invalidate: () => [ownerKeys.doorDevices()],
    }),
    remove: useOwnerMutation({
      run: (api, id: string, call) => api.ownerDoorDeviceDelete({ params: { id } }, call),
      invalidate: () => [ownerKeys.doorDevices()],
    }),
  };
}

function DeviceRow({ device: d }: { device: DoorDeviceView }) {
  const { t } = useTranslation();
  const fb = useFeedback();
  const m = useDoorMutations();
  return (
    <ListRow
      title={d.label}
      subtitle={
        d.lastSeenAt
          ? t('owner:settings.door.seen', {
              date: shortDate(todayIst(d.lastSeenAt)),
              time: clock(d.lastSeenAt),
            })
          : t(`owner:settings.door.status.${d.status}`)
      }
      trailing={
        <span className="flex flex-wrap justify-end gap-2">
          {d.status === 'pairing' ? (
            <StatusChip status="waiting" label={t('owner:settings.door.status.pairing')} />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={m.rotate.isPending}
              onClick={() =>
                m.rotate.mutate(d.id, {
                  onSuccess: () => fb.ok(t('owner:settings.door.rotated')),
                  onError: fb.fail,
                })
              }
            >
              {t('owner:settings.door.rotate')}
            </Button>
          )}
          <Button
            size="sm"
            variant="danger-secondary"
            disabled={m.remove.isPending}
            onClick={() => m.remove.mutate(d.id, { onError: fb.fail })}
          >
            {t('owner:settings.door.remove')}
          </Button>
        </span>
      }
    />
  );
}

function PairSheet() {
  const { t } = useTranslation();
  const fb = useFeedback();
  const { pair } = useDoorMutations();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const code = pair.data;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) pair.reset();
      }}
      title={t('owner:settings.door.pair')}
      description={code ? t('owner:settings.door.codeHow') : t('owner:settings.door.pairWhat')}
      trigger={
        <Button variant="secondary" icon="qr-code">
          {t('owner:settings.door.pair')}
        </Button>
      }
      footer={
        code ? (
          <Button onClick={() => setOpen(false)}>{t('owner:common.done')}</Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon="lock"
              disabled={!label.trim() || pair.isPending}
              onClick={() => pair.mutate(label.trim(), { onError: fb.fail })}
            >
              {pair.isPending ? t('owner:common.saving') : t('owner:settings.door.getCode')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
          </>
        )
      }
    >
      {code ? (
        <div className="grid gap-2">
          <p
            className="font-extrabold text-3xl text-text tabular-nums tracking-display"
            data-testid="pairing-code"
          >
            {code.pairingCode}
          </p>
          <Meta>{t('owner:settings.door.codeUntil', { time: clock(code.expiresAt) })}</Meta>
        </div>
      ) : (
        <Field label={t('owner:settings.door.label')} hint={t('owner:settings.door.labelHint')}>
          <Input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      )}
    </Sheet>
  );
}
