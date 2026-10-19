/**
 * Off-site duty form (PRD 4.6 A, 5.2, O-11): who goes, the date and times (may start before 06:00
 * or end after midnight), the place, the location by current position, a pick on the map or a
 * pasted Google Maps link (short links are expanded by the server), the circle size, the check-in
 * rule and the overtime toggle. One summary line above **Save duty**, the one sindoor action.
 */
import { isApiError } from '@fs/contracts';
import {
  Banner,
  Button,
  ChipGroup,
  Field,
  Input,
  Stepper,
  Switch,
  Textarea,
  TimeField,
  useToast,
} from '@fs/ui';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { sampleLocation } from '../../../lib/geolocation';
import { isStepUpCancelled } from '../../auth/step-up';
import { useCreateDuty, useResolveMapsLink, useSites } from '../api/schedule';
import { useStaffList } from '../api/staff';
import { Meta, Section } from '../components/layout';
import { ErrorCard, useErrorText } from '../components/states';
import { clock, shortDate, todayIst } from '../lib/format';
import { EvidenceMap } from '../map/EvidenceMap';
import {
  type DutyField,
  type DutyFormValues,
  dutyWindow,
  emptyDutyForm,
  type LocationSource,
  looksLikeMapsLink,
  parseMapsLink,
  RADIUS_MAX,
  RADIUS_MIN,
  RADIUS_STEP,
  toDutyCreate,
  validateDuty,
} from './duty-form';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ['geofence', 'anywhere', 'approval'] as const;

export function DutyFormScreen() {
  const [params] = useSearchParams();
  const date = params.get('date') ?? '';
  const staffParam = params.get('staff');
  const initial = useMemo(
    () => emptyDutyForm(DATE_RE.test(date) ? date : todayIst(), staffParam ? [staffParam] : []),
    [date, staffParam],
  );
  return <DutyForm initial={initial} />;
}

function DutyForm({ initial }: { initial: DutyFormValues }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const errorText = useErrorText();
  const staff = useStaffList('active');
  const sites = useSites();
  const create = useCreateDuty();
  const [v, setV] = useState(initial);
  const [shown, setShown] = useState<Partial<Record<DutyField, string>>>({});
  const set = <K extends keyof DutyFormValues>(k: K, value: DutyFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  const span = dutyWindow(v);
  const night = v.start < '06:00' || v.end > '21:00' || span.crossesMidnight;
  const people = staff.data ?? [];
  const names = people
    .filter((p) => v.staffIds.includes(p.id))
    .map((p) => p.name.split(' ')[0])
    .join(', ');
  const salon = sites.data?.find((s) => s.kind === 'salon');

  function submit(e: FormEvent) {
    e.preventDefault();
    const problems = validateDuty(v);
    setShown(problems);
    if (Object.keys(problems).length > 0) return;
    create.mutate(toDutyCreate(v), {
      onSuccess: () => {
        toast({ title: t('owner:duty.saved', { names }) });
        navigate(`/o/roster`);
      },
      onError: (err) => {
        if (!isStepUpCancelled(err)) toast({ title: errorText(err), tone: 'error' });
      },
    });
  }

  const err = (k: DutyField) => (shown[k] ? t(shown[k]) : undefined);

  if (staff.isError) return <ErrorCard error={staff.error} onRetry={() => void staff.refetch()} />;

  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8"
    >
      <ChipGroup
        type="checkbox"
        legend={t('owner:duty.staff')}
        error={err('staffIds')}
        value={v.staffIds}
        onValueChange={(ids) => set('staffIds', ids)}
        options={people.map((p) => ({ value: p.id, label: p.name.split(' ')[0] ?? p.name }))}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('owner:duty.date')} error={err('workDate')}>
          <Input
            type="date"
            value={v.workDate}
            min={todayIst()}
            onChange={(e) => set('workDate', e.target.value)}
          />
        </Field>
        <Field label={t('owner:duty.start')} error={err('times')}>
          <TimeField value={v.start} onValueChange={(x) => set('start', x)} />
        </Field>
        <Field
          label={t('owner:duty.end')}
          hint={span.crossesMidnight ? t('owner:duty.nextDay') : undefined}
        >
          <TimeField value={v.end} onValueChange={(x) => set('end', x)} />
        </Field>
      </div>
      {night ? <Meta>{t('owner:duty.night')}</Meta> : null}

      <Field
        label={t('owner:duty.place')}
        hint={t('owner:duty.placeHint')}
        error={err('placeName')}
      >
        <Input
          value={v.placeName}
          maxLength={120}
          onChange={(e) => set('placeName', e.target.value)}
          autoComplete="off"
        />
      </Field>

      <LocationPicker
        value={v.location}
        radiusM={v.radiusM}
        fallbackCentre={salon ? { lat: salon.lat, lng: salon.lng } : null}
        error={err('location')}
        onChange={(loc) => set('location', loc)}
      />

      <Stepper
        label={t('owner:duty.radius')}
        value={v.radiusM}
        onValueChange={(m) => set('radiusM', m)}
        min={RADIUS_MIN}
        max={RADIUS_MAX}
        step={RADIUS_STEP}
        unit="m"
      />

      <ChipGroup
        type="radio"
        legend={t('owner:duty.mode')}
        layout="grid"
        value={v.mode}
        onValueChange={(m) => set('mode', m as DutyFormValues['mode'])}
        options={MODES.map((m) => ({
          value: m,
          label: t(`owner:duty.modes.${m}`),
          description: t(`owner:duty.modeHints.${m}`),
        }))}
      />

      <Switch
        label={t('owner:duty.overtime')}
        description={t('owner:duty.overtimeHint')}
        checked={v.otPreapproved}
        onCheckedChange={(on) => set('otPreapproved', on)}
      />

      <Field label={t('owner:duty.note')} optional>
        <Textarea
          value={v.note}
          maxLength={280}
          rows={3}
          onChange={(e) => set('note', e.target.value)}
        />
      </Field>

      <div className="grid gap-3 border-border border-t pt-5">
        {v.staffIds.length > 0 && v.placeName.trim() ? (
          <p className="font-semibold text-text" data-testid="duty-summary">
            {t('owner:duty.summary', {
              names,
              date: shortDate(v.workDate),
              times: `${clock(span.startTs)}–${clock(span.endTs)}`,
              place: v.placeName.trim(),
            })}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" icon="check-circle" disabled={create.isPending}>
            {create.isPending ? t('owner:duty.saving') : t('owner:duty.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

type Loc = DutyFormValues['location'];

function LocationPicker({
  value,
  radiusM,
  fallbackCentre,
  error,
  onChange,
}: {
  value: Loc;
  radiusM: number;
  fallbackCentre: { lat: number; lng: number } | null;
  error: string | undefined;
  onChange: (loc: Loc) => void;
}) {
  const { t } = useTranslation();
  const resolve = useResolveMapsLink();
  const [mode, setMode] = useState<LocationSource | null>(null);
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [locating, setLocating] = useState<number | null>(null);

  const locateHere = async () => {
    setMode('current');
    setProblem(null);
    setLocating(0);
    const res = await sampleLocation({
      onProgress: (p) => setLocating(p.bestAccuracyM ?? 0),
    });
    setLocating(null);
    if (res.ok)
      onChange({
        lat: res.fix.lat,
        lng: res.fix.lng,
        source: 'current',
        accuracyM: Math.round(res.fix.accuracy),
      });
    else setProblem(t('owner:duty.locateFailed'));
  };

  const readLink = () => {
    setProblem(null);
    const text = link.trim();
    if (!looksLikeMapsLink(text)) {
      setProblem(t('owner:duty.linkProblem'));
      return;
    }
    const direct = parseMapsLink(text);
    if (direct) {
      onChange({ ...direct, source: 'link' });
      return;
    }
    resolve.mutate(text, {
      onSuccess: (r) => onChange({ lat: r.lat, lng: r.lng, source: 'link' }),
      onError: (e) => {
        if (isStepUpCancelled(e)) return;
        setProblem(
          isApiError(e, 'UNAVAILABLE') ? t('owner:errors.network') : t('owner:duty.linkProblem'),
        );
      },
    });
  };

  const centre = value ?? fallbackCentre;

  return (
    <Section title={t('owner:duty.location')}>
      <div className="grid gap-4">
        {error ? (
          <p className="text-absent text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon="navigation"
            onClick={() => void locateHere()}
            disabled={locating !== null}
          >
            {locating !== null
              ? t('owner:duty.locating', { m: locating })
              : t('owner:duty.useCurrent')}
          </Button>
          <Button
            variant="secondary"
            icon="map-pin"
            aria-pressed={mode === 'map'}
            onClick={() => setMode('map')}
          >
            {t('owner:duty.pickOnMap')}
          </Button>
          <Button
            variant="secondary"
            icon="share-network"
            aria-pressed={mode === 'link'}
            onClick={() => setMode('link')}
          >
            {t('owner:duty.pasteLink')}
          </Button>
        </div>
        {mode === 'link' ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('owner:duty.linkLabel')} className="min-w-0 flex-1 basis-60">
              <Input
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                autoComplete="off"
              />
            </Field>
            <Button variant="secondary" onClick={readLink} disabled={resolve.isPending || !link}>
              {resolve.isPending ? t('owner:duty.reading') : t('owner:duty.readLink')}
            </Button>
          </div>
        ) : null}
        {problem ? <Banner icon="warning-circle">{problem}</Banner> : null}
        {value ? (
          <Meta>
            {t('owner:duty.locationSet', { source: t(`owner:duty.source.${value.source}`) })}
          </Meta>
        ) : null}
        {(mode === 'map' || value) && centre ? (
          <div className="grid gap-2">
            {mode === 'map' ? <Meta>{t('owner:duty.mapHint')}</Meta> : null}
            <EvidenceMap
              centre={centre}
              radiusM={value ? radiusM : undefined}
              label={t('owner:duty.location')}
              height="16rem"
              onPick={
                mode === 'map'
                  ? (p) => onChange({ lat: p.lat, lng: p.lng, source: 'map' })
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </Section>
  );
}
