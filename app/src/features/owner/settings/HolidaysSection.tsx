/**
 * Holidays and blackout days (PRD 4.15.1 step 4, 4.17, 7.8): the year's holidays with paid or not
 * and what someone who works that day gets (comp-off, extra pay or both); add, change or remove.
 * Blackout days are busy days when leave requests get a warning.
 */
import type { HolidayView, WorkedOffDayComp } from '@fs/contracts';
import {
  Button,
  ChipGroup,
  Field,
  IconButton,
  Input,
  List,
  ListRow,
  Sheet,
  Switch,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { ownerKeys } from '../api/keys';
import { useOwnerMutation } from '../api/query';
import { useHolidays } from '../api/schedule';
import { useBlackouts } from '../api/settings';
import { Meta, Section } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { dayLabel, todayIst } from '../lib/format';

const COMPS: WorkedOffDayComp[] = ['comp_off', 'extra_pay', 'both'];

function useFail() {
  const toast = useToast();
  const errorText = useErrorText();
  return (e: unknown) => {
    if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
  };
}

export function HolidaysSection() {
  const { t } = useTranslation();
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const holidays = useHolidays(year);
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8">
      <div className="flex items-center gap-1">
        <IconButton
          icon="caret-left"
          label={t('owner:settings.holidays.prevYear')}
          onClick={() => setYear(year - 1)}
        />
        <h2
          className="min-w-20 text-center font-bold text-lg text-text tabular-nums"
          aria-live="polite"
        >
          {year}
        </h2>
        <IconButton
          icon="caret-right"
          label={t('owner:settings.holidays.nextYear')}
          onClick={() => setYear(year + 1)}
        />
      </div>
      <Section title={t('owner:settings.holidays.title')}>
        <QueryView
          query={holidays}
          skeleton={<RowsSkeleton rows={6} />}
          isEmpty={(list) => list.length === 0}
          empty={<Meta>{t('owner:settings.holidays.none')}</Meta>}
        >
          {(list) => (
            <List>
              {[...list]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((h) => (
                  <ListRow
                    key={h.id}
                    title={h.name}
                    subtitle={`${dayLabel(h.date)} · ${h.paid ? t('owner:settings.holidays.paid') : t('owner:settings.holidays.unpaid')} · ${t(`owner:settings.holidays.comp.${h.workedComp}`)}`}
                    trailing={<HolidaySheet year={year} holiday={h} />}
                  />
                ))}
            </List>
          )}
        </QueryView>
        <div>
          <HolidaySheet year={year} />
        </div>
      </Section>
      <Blackouts year={year} />
    </div>
  );
}

function HolidaySheet({ year, holiday }: { year: number; holiday?: HolidayView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fail = useFail();
  const invalidate = () => [ownerKeys.holidays(year), ownerKeys.rosterAll(), ownerKeys.today()];
  const create = useOwnerMutation({
    run: (api, body: Omit<HolidayView, 'id'>, call) => api.ownerHolidayCreate({ body }, call),
    invalidate,
  });
  const patch = useOwnerMutation({
    run: (api, v: { id: string; body: Omit<HolidayView, 'id'> }, call) =>
      api.ownerHolidayPatch({ params: { id: v.id }, body: v.body }, call),
    invalidate,
  });
  const remove = useOwnerMutation({
    run: (api, id: string, call) => api.ownerHolidayDelete({ params: { id } }, call),
    invalidate,
  });
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(holiday?.date ?? '');
  const [name, setName] = useState(holiday?.name ?? '');
  const [paid, setPaid] = useState(holiday?.paid ?? true);
  const [comp, setComp] = useState<WorkedOffDayComp>(holiday?.workedComp ?? 'comp_off');
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && name.trim().length > 0;
  const busy = create.isPending || patch.isPending || remove.isPending;
  const done = () => {
    setOpen(false);
    toast({ title: t('owner:settings.saved') });
  };
  const body = { date, name: name.trim(), paid, workedComp: comp };
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={holiday ? holiday.name : t('owner:settings.holidays.add')}
      trigger={
        holiday ? (
          <Button size="sm" variant="secondary">
            {t('owner:common.edit')}
          </Button>
        ) : (
          <Button variant="secondary" icon="plus">
            {t('owner:settings.holidays.add')}
          </Button>
        )
      }
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() =>
              holiday
                ? patch.mutate({ id: holiday.id, body }, { onSuccess: done, onError: fail })
                : create.mutate(body, { onSuccess: done, onError: fail })
            }
          >
            {busy ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          {holiday ? (
            <Button
              variant="danger-secondary"
              disabled={busy}
              onClick={() => remove.mutate(holiday.id, { onSuccess: done, onError: fail })}
            >
              {t('owner:common.remove')}
            </Button>
          ) : (
            <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('owner:settings.holidays.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('owner:settings.holidays.name')}>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Switch
          label={t('owner:settings.holidays.paidLabel')}
          description={t('owner:settings.holidays.paidWhat')}
          checked={paid}
          onCheckedChange={setPaid}
        />
        <ChipGroup
          type="radio"
          legend={t('owner:settings.holidays.ifWorked')}
          value={comp}
          onValueChange={(v) => setComp(v as WorkedOffDayComp)}
          options={COMPS.map((c) => ({ value: c, label: t(`owner:settings.holidays.comp.${c}`) }))}
        />
      </div>
    </Sheet>
  );
}

function Blackouts({ year }: { year: number }) {
  const { t } = useTranslation();
  const fail = useFail();
  const blackouts = useBlackouts(year);
  const invalidate = () => [ownerKeys.blackouts(year)];
  const add = useOwnerMutation({
    run: (api, body: { date: string; note?: string }, call) =>
      api.ownerBlackoutCreate({ body }, call),
    invalidate,
  });
  const remove = useOwnerMutation({
    run: (api, date: string, call) => api.ownerBlackoutDelete({ params: { date } }, call),
    invalidate,
  });
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  return (
    <Section title={t('owner:settings.blackouts.title')}>
      <Meta>{t('owner:settings.blackouts.what')}</Meta>
      <QueryView
        query={blackouts}
        skeleton={<RowsSkeleton rows={2} />}
        isEmpty={(list) => list.length === 0}
        empty={<Meta>{t('owner:settings.blackouts.none')}</Meta>}
      >
        {(list) => (
          <List>
            {list.map((b) => (
              <ListRow
                key={b.date}
                title={dayLabel(b.date)}
                subtitle={b.note ?? undefined}
                trailing={
                  <Button
                    size="sm"
                    variant="danger-secondary"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(b.date, { onError: fail })}
                  >
                    {t('owner:common.remove')}
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </QueryView>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('owner:settings.blackouts.date')} className="w-44">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label={t('owner:settings.blackouts.note')}
          optional
          className="min-w-0 flex-1 basis-48"
        >
          <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          icon="plus"
          disabled={!date || add.isPending}
          onClick={() =>
            add.mutate(note.trim() ? { date, note: note.trim() } : { date }, {
              onSuccess: () => {
                setDate('');
                setNote('');
              },
              onError: fail,
            })
          }
        >
          {t('owner:settings.blackouts.add')}
        </Button>
      </div>
    </Section>
  );
}
