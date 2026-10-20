/**
 * Fix a day (`/requests/fix?date=`, PRD 4.11, 5.1; AC S-13): what happened (forgot to check in or
 * out, wrong time, worked at a venue), the day (last 7 days), the times in 24 h, a short reason.
 * One idempotency key per opening. The day's own punches are loaded for "wrong time".
 */
import { istDate, type RegularisationKind } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, RadioGroup, Textarea, TimeField, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useDay, useOwnerName, useRegularisationCreate } from '../api';
import { useFmt } from '../lib/format';
import { useOnline } from '../lib/online';
import { ActionBar } from '../shell/ActionBar';
import { ScreenHeader } from '../shell/ScreenHeader';
import { type FixDraft, type FixIssue, fixBody, fixDateBounds, fixIssues } from './form-models';
import { submitError } from './submit-error';

const KINDS: RegularisationKind[] = ['missed_in', 'missed_out', 'wrong_time', 'offsite_unplanned'];

export function FixFormScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useRegularisationCreate();
  const [key] = useState(() => crypto.randomUUID());
  const today = istDate(Date.now());
  const bounds = fixDateBounds(today);
  const asked = params.get('date') ?? today;
  const [draft, setDraft] = useState<FixDraft>({
    kind: 'missed_in',
    workDate: asked >= bounds.min && asked <= bounds.max ? asked : today,
    targetPunchId: '',
    targetKind: '',
    arrived: '',
    left: '',
    rightTime: '',
    place: '',
    reason: '',
  });
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<FixDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailure(null);
  };

  const inRange = draft.workDate >= bounds.min && draft.workDate <= bounds.max;
  const day = useDay(draft.workDate, inRange);
  const punches = (day.data?.punches ?? []).filter(
    (p) =>
      p.status !== 'superseded' && p.status !== 'rejected' && (p.kind === 'in' || p.kind === 'out'),
  );
  const closed = day.data ? !day.data.canRegularise : false;
  const alreadyOpen = day.data?.openRegularisation ?? null;

  const issues = fixIssues(draft, today);
  const text: Record<FixIssue, string> = {
    needTime: t('staff:fix.needTime'),
    timeRange: t('staff:fix.timeRange'),
    needPunch: t('staff:fix.needPunch'),
    needPlace: t('staff:fix.needPlace'),
    needReason: t('staff:fix.needReason'),
    order: t('staff:fix.order'),
    dateRange: t('staff:fix.dateHint'),
  };
  const err = (...i: FixIssue[]) => {
    if (!tried) return undefined;
    const hit = i.find((x) => issues.includes(x));
    return hit ? text[hit] : undefined;
  };
  const offline = !useOnline();

  const send = () => {
    setTried(true);
    if (issues.length || closed || alreadyOpen || create.isPending) return;
    create.mutate(
      { body: fixBody(draft), idempotencyKey: key },
      {
        onSuccess: () => {
          toast({ title: t('staff:fix.sent', { owner }) });
          navigate('/requests?tab=fixes', { replace: true });
        },
        onError: (e) => setFailure(submitError(t, e, owner)),
      },
    );
  };

  const showArrived = draft.kind === 'missed_in' || draft.kind === 'offsite_unplanned';
  const showLeft = draft.kind === 'missed_out' || draft.kind === 'offsite_unplanned';

  return (
    <>
      <ScreenHeader title={t('staff:screens.fixForm')} back="/requests?tab=fixes" />
      <main id="main" className="staff-main flex flex-col gap-5">
        <form
          id="fix-form"
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <ChipGroup
            legend={t('staff:fix.kind')}
            value={draft.kind}
            onValueChange={(v) => set({ kind: v as RegularisationKind })}
            options={KINDS.map((k) => ({ value: k, label: t(`staff:requests.fixKind.${k}`) }))}
          />

          <Field
            label={t('staff:fix.date')}
            hint={t('staff:fix.dateHint')}
            error={err('dateRange')}
          >
            <Input
              type="date"
              value={draft.workDate}
              min={bounds.min}
              max={bounds.max}
              onChange={(e) => set({ workDate: e.target.value, targetPunchId: '', targetKind: '' })}
            />
          </Field>

          {closed ? (
            <p className="staff-card text-sm" role="status">
              {t('staff:day.cantFix', { owner })}
            </p>
          ) : null}
          {alreadyOpen ? (
            <p className="staff-card text-sm" role="status">
              {t('staff:day.openFix', { date: fmt.date(alreadyOpen.createdAt), owner })}
            </p>
          ) : null}

          {draft.kind === 'offsite_unplanned' ? (
            <Field
              label={t('staff:fix.place')}
              hint={t('staff:fix.placeHint')}
              error={err('needPlace')}
            >
              <Input
                value={draft.place}
                maxLength={120}
                onChange={(e) => set({ place: e.target.value })}
              />
            </Field>
          ) : null}

          {showArrived ? (
            <Field label={t('staff:fix.arrived')} error={err('needTime', 'timeRange')}>
              <TimeField value={draft.arrived} onValueChange={(v) => set({ arrived: v })} />
            </Field>
          ) : null}
          {showLeft ? (
            <Field label={t('staff:fix.left')} error={err('needTime', 'timeRange', 'order')}>
              <TimeField value={draft.left} onValueChange={(v) => set({ left: v })} />
            </Field>
          ) : null}

          {draft.kind === 'wrong_time' ? (
            <>
              {punches.length ? (
                <RadioGroup
                  legend={t('staff:fix.whichPunch')}
                  value={draft.targetPunchId}
                  error={err('needPunch')}
                  onValueChange={(v) =>
                    set({
                      targetPunchId: v,
                      targetKind: punches.find((p) => p.id === v)?.kind === 'out' ? 'out' : 'in',
                    })
                  }
                  options={punches.map((p) => ({
                    value: p.id,
                    label: t('staff:fix.punchOption', {
                      kind: t(`staff:myData.kind.${p.kind}`),
                      time: fmt.clock(p.effectiveTs),
                    }),
                  }))}
                />
              ) : (
                <p className="text-sm text-text-muted">{t('staff:fix.noPunches')}</p>
              )}
              <Field label={t('staff:fix.rightTime')} error={err('needTime', 'timeRange')}>
                <TimeField value={draft.rightTime} onValueChange={(v) => set({ rightTime: v })} />
              </Field>
            </>
          ) : null}

          <Field
            label={t('staff:fix.reason', { owner })}
            hint={t('staff:fix.reasonHint')}
            error={err('needReason')}
          >
            <Textarea
              value={draft.reason}
              onChange={(e) => set({ reason: e.target.value })}
              maxLength={300}
              rows={3}
            />
          </Field>

          {offline ? (
            <p className="text-sm text-text-muted" role="status">
              {t('common:states.needsInternet')}
            </p>
          ) : null}
          {failure ? (
            <p className="staff-card text-sm" role="alert">
              {failure}
            </p>
          ) : null}
        </form>
      </main>
      <ActionBar>
        <Button
          type="submit"
          form="fix-form"
          variant="primary"
          block
          loading={create.isPending}
          loadingLabel={t('staff:fix.sending')}
          disabled={offline || closed || alreadyOpen !== null}
        >
          {t('staff:fix.send')}
        </Button>
      </ActionBar>
    </>
  );
}
