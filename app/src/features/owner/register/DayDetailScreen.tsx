/**
 * Day detail (PRD 5.2, O-05.3, O-06): the evidence for one person-day. Timeline of punches with
 * source tags, map with the fence circle (lazy), risk reasons in words, selfie with the joining
 * photo, how the day counts with the pay effect, "Edit day" (override with a reason) and the history.
 */
import type { LeaveCode, OverrideStatus, OwnerDayDetail, OwnerPunchView } from '@fs/contracts';
import { istDate } from '@fs/contracts';
import {
  Banner,
  Button,
  ChipGroup,
  Field,
  Input,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  Textarea,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useMe } from '../../../api/hooks';
import { isStepUpCancelled } from '../../auth/step-up';
import { useDayOverride, useOwnerDay } from '../api/attendance';
import { Meta, Section, Tag } from '../components/layout';
import { PunchFacts, PunchMap, RiskReasons, SelfieCompare } from '../components/PunchEvidence';
import { QueryView, useErrorText } from '../components/states';
import { clock, dayLabel, duration, longDate, money } from '../lib/format';
import { dayStatusMeta, leaveKey, punchStatusMeta } from '../lib/status';
import { useOwnerTitle } from '../shell/chrome';
import {
  auditChanges,
  draftFromDay,
  type OverrideDraft,
  overrideRequest,
  shiftTimes,
} from './day-model';

export function DayDetailScreen() {
  const { userId = '', date = '' } = useParams();
  const query = useOwnerDay(userId, date);
  const { t } = useTranslation();
  useOwnerTitle(
    query.data ? t('owner:day.title', { name: query.data.user.name, date: dayLabel(date) }) : null,
    `/o/register?month=${date.slice(0, 7)}`,
  );
  return (
    <QueryView query={query} skeleton={<DaySkeleton />}>
      {(day) => <Day day={day} />}
    </QueryView>
  );
}

function useOwnerName(): string {
  return useMe().data?.org.ownerDisplayName ?? 'Urmi';
}

function Day({ day }: { day: OwnerDayDetail }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const d = day.day;
  const meta = dayStatusMeta(d.status);
  const located = day.punches.find((p) => p.lat !== null && p.lng !== null) ?? null;
  const site = day.duty?.site ?? day.site;
  const selfies = day.punches.filter((p) => p.selfieUrl || p.selfieDeletedAt);

  const shift =
    day.schedule.holidayName !== null
      ? day.schedule.holidayName
      : day.schedule.leave
        ? day.schedule.leave.name
        : day.schedule.segments.length > 0
          ? t('owner:day.shiftLine', {
              name: day.schedule.templateName ?? t('owner:day.shift'),
              times: shiftTimes(day.schedule),
            })
          : t('owner:day.noShift');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start xl:gap-12">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
        {day.locked ? <Banner icon="lock">{t('owner:day.locked')}</Banner> : null}
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip status={meta.chip} label={t(meta.labelKey)} />
          {d.tags.includes('late') ? (
            <StatusChip status="late" label={t('owner:today.row.lateLabel', { min: d.lateMin })} />
          ) : null}
          {d.tags.includes('edited') ? (
            <Tag>{t('owner:status.edited', { name: owner })}</Tag>
          ) : null}
          <Meta className="flex-1">
            {t('owner:day.shift')}: {shift}
          </Meta>
        </div>
        {day.duty ? (
          <p className="text-text-body">{t('owner:day.venue', { place: day.duty.placeName })}</p>
        ) : null}

        <Section title={t('owner:day.timeline')}>
          {day.punches.length === 0 ? (
            <Meta>
              {d.status === 'A' ? t('owner:day.noPunchesAbsent') : t('owner:day.noPunches')}
            </Meta>
          ) : (
            <ol className="grid">
              {day.punches.map((p) => (
                <PunchRow key={p.id} punch={p} />
              ))}
            </ol>
          )}
        </Section>

        <Section title={t('owner:day.computed')}>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 tabular-nums">
            <Line label={t('owner:day.worked')} value={duration(d.workedMin)} />
            <Line label={t('owner:day.scheduled')} value={duration(d.scheduledMin)} />
            {d.lateMin > 0 ? (
              <Line label={t('owner:day.late')} value={`${d.lateMin} m (${d.lateBillableMin} m)`} />
            ) : null}
            {d.earlyMin > 0 ? (
              <Line
                label={t('owner:day.early')}
                value={`${d.earlyMin} m (${d.earlyBillableMin} m)`}
              />
            ) : null}
            {d.otApprovedMin > 0 || d.otCandidateMin > 0 ? (
              <Line
                label={t('owner:day.overtime')}
                value={
                  d.otStatus === 'pending'
                    ? t('owner:day.overtimePending', { duration: duration(d.otCandidateMin) })
                    : duration(d.otApprovedMin)
                }
              />
            ) : null}
            <Line label={t('owner:day.statusLine')} value={t(meta.labelKey)} />
          </dl>
          {day.lines.length > 0 ? (
            <div className="grid gap-1 border-border border-t pt-3">
              <h3 className="font-semibold text-sm text-text-muted">{t('owner:day.payEffect')}</h3>
              <ul className="grid gap-2">
                {day.lines.map((l) => (
                  <li
                    key={`${l.code}-${l.label}`}
                    className="flex items-start justify-between gap-4"
                  >
                    <span className="grid">
                      <span className="text-text">{l.label}</span>
                      <span className="text-sm text-text-muted">{l.formula}</span>
                    </span>
                    {l.amountPaise !== null ? (
                      <span className="font-semibold text-text tabular-nums">
                        {money(l.amountPaise)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <div>
          <OverrideSheet day={day} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
        <Section title={t('owner:day.map')}>
          {located ? (
            <>
              <PunchMap punch={located} site={site} height="16rem" />
              <RiskReasons punch={located} />
              <PunchFacts punch={located} />
            </>
          ) : (
            <Meta>{t('owner:day.mapNone')}</Meta>
          )}
        </Section>
        <Section title={t('owner:day.selfie')}>
          {selfies.length === 0 ? (
            <Meta>{t('owner:day.noSelfie')}</Meta>
          ) : (
            <div className="flex flex-wrap gap-3">
              {selfies.map((p) =>
                p.selfieUrl ? (
                  <SelfieCompare
                    key={p.id}
                    selfieUrl={p.selfieUrl}
                    userId={day.user.id}
                    name={day.user.name}
                    enrolledUrl={day.enrolledPhotoUrl}
                  />
                ) : (
                  <Meta key={p.id}>{t('owner:day.selfieDeleted')}</Meta>
                ),
              )}
            </div>
          )}
        </Section>
        <Section title={t('owner:day.audit')}>
          {day.audit.length === 0 ? (
            <Meta>{t('owner:day.noAudit')}</Meta>
          ) : (
            <List>
              {day.audit.map((a) => {
                const changes = auditChanges(a)
                  .map((c) => `${c.field} ${c.before} → ${c.after}`)
                  .join(', ');
                return (
                  <ListRow
                    key={a.id}
                    title={t('owner:day.auditLine', {
                      who: a.actorName ?? a.actorType,
                      date: longDate(istDate(a.createdAt)),
                      what: changes || a.action,
                    })}
                    subtitle={
                      a.reason ? t('owner:day.auditReason', { reason: a.reason }) : undefined
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-semibold text-text">{value}</dd>
    </>
  );
}

function PunchRow({ punch }: { punch: OwnerPunchView }) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const status = punchStatusMeta(punch.status);
  const place = punch.placeName ?? punch.siteName;
  return (
    <li className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 gap-y-1 border-border border-t py-3 first:border-t-0">
      <span className="font-extrabold text-lg text-text tabular-nums">
        {clock(punch.effectiveTs)}
      </span>
      <span className="grid gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-text">{t(`owner:punch.${punch.kind}`)}</span>
          <Tag>{t(`owner:punch.source.${punch.source}`)}</Tag>
          {punch.edited ? <Tag>{t('owner:status.edited', { name: owner })}</Tag> : null}
          {status ? <StatusChip status={status.chip} label={t(status.labelKey)} /> : null}
        </span>
        {place ? <span className="text-sm text-text-body">{place}</span> : null}
        <RiskReasons punch={punch} />
        {punch.note ? <span className="text-sm text-text-body italic">“{punch.note}”</span> : null}
        {punch.reviewNote ? (
          <span className="text-sm text-text-muted">{punch.reviewNote}</span>
        ) : null}
      </span>
    </li>
  );
}

const STATUS_OPTIONS: OverrideStatus[] = ['P', 'H', 'A', 'L', 'LOP', 'WO', 'HO'];
const LEAVE_OPTIONS: LeaveCode[] = ['CL', 'SL', 'EL', 'CO'];

function OverrideSheet({ day }: { day: OwnerDayDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const save = useDayOverride(day.user.id, day.day.workDate);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OverrideDraft>(() => draftFromDay(day.punches));
  const [problem, setProblem] = useState<string | null>(null);
  const first = day.user.name.split(' ')[0] ?? day.user.name;

  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(draftFromDay(day.punches));
      setProblem(null);
    }
  };

  const submit = () => {
    const res = overrideRequest(draft, day.day.workDate);
    if (!res.request) {
      setProblem(
        res.problem === 'reason'
          ? t('owner:day.override.reasonMissing')
          : t('owner:day.override.nothingChanged'),
      );
      return;
    }
    save.mutate(res.request, {
      onSuccess: () => {
        setOpen(false);
        toast({ title: t('owner:day.override.saved'), tone: 'success' });
      },
      onError: (e) => {
        if (!isStepUpCancelled(e)) setProblem(errorText(e));
      },
    });
  };

  const update = (i: number, patch: Partial<OverrideDraft['punches'][number]>) =>
    setDraft((d) => ({
      ...d,
      punches: d.punches.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));

  return (
    <Sheet
      open={open}
      onOpenChange={reset}
      title={t('owner:day.override.title', { name: first })}
      description={dayLabel(day.day.workDate)}
      trigger={
        <Button variant="secondary" icon="pencil-simple" disabled={day.locked}>
          {t('owner:day.edit')}
        </Button>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ChipGroup
          type="radio"
          legend={t('owner:day.override.status')}
          value={draft.status ?? 'auto'}
          onValueChange={(v) =>
            setDraft((d) => ({ ...d, status: v === 'auto' ? null : (v as OverrideStatus) }))
          }
          options={[
            { value: 'auto', label: t('owner:day.override.keepStatus') },
            ...STATUS_OPTIONS.map((s) => ({ value: s, label: t(`owner:status.${s}`) })),
          ]}
        />
        {draft.status === 'L' ? (
          <ChipGroup
            type="radio"
            legend={t('owner:day.override.leaveType')}
            value={draft.leaveCode ?? ''}
            onValueChange={(v) => setDraft((d) => ({ ...d, leaveCode: v as LeaveCode }))}
            options={LEAVE_OPTIONS.map((c) => ({ value: c, label: t(leaveKey(c)) }))}
          />
        ) : null}
        <fieldset className="grid gap-3">
          <legend className="mb-1 font-semibold text-sm text-text">
            {t('owner:day.override.punches')}
          </legend>
          {draft.punches.map((p, i) => (
            <div key={p.id ?? `new-${i}`} className="flex flex-wrap items-end gap-3">
              <Field label={t(`owner:punch.${p.kind}`)} className="w-36">
                <Input
                  type="time"
                  value={p.time}
                  disabled={p.removed}
                  onChange={(e) => update(i, { time: e.target.value })}
                />
              </Field>
              <Button
                size="sm"
                variant={p.removed ? 'secondary' : 'danger-secondary'}
                icon={p.removed ? 'arrows-clockwise' : 'trash'}
                onClick={() => update(i, { removed: !p.removed })}
              >
                {p.removed
                  ? t('owner:day.override.restorePunch')
                  : t('owner:day.override.deletePunch')}
              </Button>
              {p.removed ? <Meta>{t('owner:day.override.removed')}</Meta> : null}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {(['in', 'out'] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="ghost"
                icon="plus"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    punches: [
                      ...d.punches,
                      {
                        id: null,
                        kind,
                        time: kind === 'in' ? '10:00' : '20:00',
                        original: null,
                        removed: false,
                      },
                    ],
                  }))
                }
              >
                {kind === 'in' ? t('owner:day.override.addIn') : t('owner:day.override.addOut')}
              </Button>
            ))}
          </div>
        </fieldset>
        <Field
          label={t('owner:day.override.reasonLabel')}
          hint={t('owner:day.override.reasonHint', { name: first })}
          error={problem ?? undefined}
          required
        >
          <Textarea
            rows={3}
            maxLength={300}
            value={draft.reason}
            onChange={(e) => {
              const reason = e.target.value;
              setDraft((d) => ({ ...d, reason }));
              setProblem(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            loadingLabel={t('owner:common.saving')}
          >
            {t('owner:day.override.save')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function DaySkeleton() {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-12">
      <SkeletonGroup className="grid gap-4">
        <Skeleton shape="pill" width="8rem" height="2rem" />
        <Skeleton width="60%" />
        <Skeleton shape="block" height="9rem" />
        <Skeleton shape="block" height="7rem" />
      </SkeletonGroup>
      <SkeletonGroup className="grid gap-4">
        <Skeleton shape="block" height="16rem" />
      </SkeletonGroup>
    </div>
  );
}
