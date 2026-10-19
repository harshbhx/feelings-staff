/**
 * Shifts (PRD 4.15.1 step 3, 4.17, 7.3): the shift templates with their times, unpaid break and
 * paid hours; edit, add (up to three parts for a split shift), and stop using one (it stays on old
 * days). The weekly-hours warning sits in Pay rules.
 */
import type { ShiftTemplateView } from '@fs/contracts';
import {
  Button,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Sheet,
  Stepper,
  TimeField,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { ownerKeys } from '../api/keys';
import { useOwnerMutation } from '../api/query';
import { useShiftTemplates } from '../api/schedule';
import { Meta, Tag } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { duration } from '../lib/format';

interface Draft {
  name: string;
  segments: { start: string; end: string }[];
  breakMin: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems in plain words, or null when the template can be saved. */
export function templateProblem(d: Draft): 'name' | 'times' | null {
  if (!d.name.trim()) return 'name';
  if (d.segments.length === 0) return 'times';
  for (const s of d.segments)
    if (!HHMM.test(s.start) || !HHMM.test(s.end) || s.start >= s.end) return 'times';
  for (let i = 1; i < d.segments.length; i++)
    if ((d.segments[i]?.start ?? '') < (d.segments[i - 1]?.end ?? '')) return 'times';
  return null;
}

function useTemplateMutations() {
  const invalidate = () => [ownerKeys.templates(), ownerKeys.rosterAll()];
  return {
    create: useOwnerMutation({
      run: (api, body: Draft, call) => api.ownerShiftTemplateCreate({ body }, call),
      invalidate,
    }),
    patch: useOwnerMutation({
      run: (api, v: { id: string; body: Partial<Draft> & { active?: boolean } }, call) =>
        api.ownerShiftTemplatePatch({ params: { id: v.id }, body: v.body }, call),
      invalidate,
    }),
  };
}

export function ShiftsSection() {
  const { t } = useTranslation();
  const templates = useShiftTemplates();
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-6">
      <Meta>{t('owner:settings.shifts.what')}</Meta>
      <QueryView query={templates} skeleton={<RowsSkeleton rows={5} />}>
        {(list) => (
          <List>
            {[...list]
              .sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort)
              .map((x) => (
                <TemplateRow key={x.id} template={x} />
              ))}
          </List>
        )}
      </QueryView>
      <div>
        <TemplateSheet />
      </div>
    </div>
  );
}

function TemplateRow({ template: x }: { template: ShiftTemplateView }) {
  const { t } = useTranslation();
  return (
    <ListRow
      title={x.name}
      subtitle={
        <span className="tabular-nums">
          {t('owner:settings.shifts.line', {
            times: x.segments.map((s) => `${s.start}–${s.end}`).join(' + '),
            brk: x.breakMin,
            paid: duration(x.scheduledMin),
          })}
        </span>
      }
      trailing={
        <span className="flex items-center gap-2">
          {x.active ? null : <Tag>{t('owner:settings.shifts.notUsed')}</Tag>}
          <TemplateSheet template={x} />
        </span>
      }
    />
  );
}

function TemplateSheet({ template }: { template?: ShiftTemplateView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const m = useTemplateMutations();
  const [open, setOpen] = useState(false);
  const blank: Draft = { name: '', segments: [{ start: '10:00', end: '20:00' }], breakMin: 60 };
  const [d, setD] = useState<Draft>(
    template
      ? { name: template.name, segments: template.segments, breakMin: template.breakMin }
      : blank,
  );
  const [tried, setTried] = useState(false);
  const problem = templateProblem(d);
  const busy = m.create.isPending || m.patch.isPending;
  const done = () => {
    setOpen(false);
    setTried(false);
    if (!template) setD(blank);
    toast({ title: t('owner:settings.saved') });
  };
  const fail = (e: unknown) => {
    if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
  };
  const save = () => {
    setTried(true);
    if (problem) return;
    const body = { name: d.name.trim(), segments: d.segments, breakMin: d.breakMin };
    if (template) m.patch.mutate({ id: template.id, body }, { onSuccess: done, onError: fail });
    else m.create.mutate(body, { onSuccess: done, onError: fail });
  };
  const setSeg = (i: number, k: 'start' | 'end', v: string) =>
    setD((x) => ({ ...x, segments: x.segments.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={template ? template.name : t('owner:settings.shifts.add')}
      trigger={
        template ? (
          <Button size="sm" variant="secondary">
            {t('owner:common.edit')}
          </Button>
        ) : (
          <Button variant="secondary" icon="plus">
            {t('owner:settings.shifts.add')}
          </Button>
        )
      }
      footer={
        <>
          <Button variant="primary" disabled={busy} onClick={save}>
            {busy ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          {template ? (
            <Button
              variant={template.active ? 'danger-secondary' : 'secondary'}
              disabled={busy}
              onClick={() =>
                m.patch.mutate(
                  { id: template.id, body: { active: !template.active } },
                  { onSuccess: done, onError: fail },
                )
              }
            >
              {template.active ? t('owner:settings.shifts.stop') : t('owner:settings.shifts.use')}
            </Button>
          ) : (
            <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <Field
          label={t('owner:settings.shifts.name')}
          error={tried && problem === 'name' ? t('owner:settings.shifts.errors.name') : undefined}
        >
          <Input
            value={d.name}
            maxLength={40}
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </Field>
        {d.segments.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are edited in place by position
          <div key={i} className="flex flex-wrap items-end gap-3">
            <Field label={t('owner:settings.shifts.from')} className="w-28">
              <TimeField value={s.start} onValueChange={(v) => setSeg(i, 'start', v)} />
            </Field>
            <Field label={t('owner:settings.shifts.to')} className="w-28">
              <TimeField value={s.end} onValueChange={(v) => setSeg(i, 'end', v)} />
            </Field>
            {d.segments.length > 1 ? (
              <IconButton
                icon="minus"
                label={t('owner:settings.shifts.removePart')}
                onClick={() => setD({ ...d, segments: d.segments.filter((_, j) => j !== i) })}
              />
            ) : null}
          </div>
        ))}
        {tried && problem === 'times' ? (
          <p className="text-absent text-sm" role="alert">
            {t('owner:settings.shifts.errors.times')}
          </p>
        ) : null}
        {d.segments.length < 3 ? (
          <div>
            <Button
              size="sm"
              icon="plus"
              onClick={() =>
                setD({ ...d, segments: [...d.segments, { start: '17:00', end: '21:00' }] })
              }
            >
              {t('owner:settings.shifts.addPart')}
            </Button>
          </div>
        ) : null}
        <Stepper
          label={t('owner:settings.shifts.break')}
          hint={t('owner:settings.shifts.breakWhat', { value: d.breakMin })}
          value={d.breakMin}
          onValueChange={(v) => setD({ ...d, breakMin: v })}
          min={0}
          max={180}
          step={15}
          unit="min"
        />
      </div>
    </Sheet>
  );
}
