/**
 * Add staff (PRD 4.1.1, O-07): the form, then the invite share sheet. Duplicate phone offers "Edit
 * Priya instead", an exited person offers "Rehire", the 15-staff cap is the server's sentence, and a
 * network error keeps every value.
 */
import { type InviteView, istDate } from '@fs/contracts';
import { Banner, Button, ChipGroup, Field, Input, Skeleton, SkeletonGroup, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useShiftTemplates } from '../api/schedule';
import { useSettings } from '../api/settings';
import { useCreateStaff, useRehire } from '../api/staff';
import { ErrorCard } from '../components/states';
import { money, shortDate } from '../lib/format';
import { InviteSheet } from './InviteSheet';
import {
  belowMinimumWage,
  type CreateProblem,
  createProblem,
  DESIGNATIONS,
  emptyStaffForm,
  rupeesToPaise,
  type StaffField,
  type StaffFormValues,
  toStaffCreate,
  validateStaff,
} from './staff-form';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DOW_DATE = [
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
];

function weekdayName(dow: number): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(
    Date.parse(`${DOW_DATE[dow]}T12:00:00+05:30`),
  );
}

export function AddStaffScreen() {
  const templates = useShiftTemplates();
  if (templates.isError)
    return <ErrorCard error={templates.error} onRetry={() => void templates.refetch()} />;
  if (!templates.data)
    return (
      <SkeletonGroup className="grid max-w-(--container-narrow) gap-5">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder fields
          <Skeleton key={i} shape="block" height="4.5rem" />
        ))}
      </SkeletonGroup>
    );
  const active = templates.data.filter((x) => x.active).sort((a, b) => a.sort - b.sort);
  const fullDay = active.find((x) => x.name === 'Full day') ?? active[0];
  return <AddStaffForm templates={active} defaultTemplateId={fullDay?.id ?? ''} />;
}

function AddStaffForm({
  templates,
  defaultTemplateId,
}: {
  templates: { id: string; name: string }[];
  defaultTemplateId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useSettings();
  const create = useCreateStaff();
  const rehire = useRehire();
  const [v, setV] = useState<StaffFormValues>(() =>
    emptyStaffForm(istDate(Date.now()), defaultTemplateId),
  );
  const [errors, setErrors] = useState<Partial<Record<StaffField, string>>>({});
  const [problem, setProblem] = useState<CreateProblem | null>(null);
  const [invite, setInvite] = useState<{
    invite: InviteView;
    staffId: string;
    name: string;
  } | null>(null);

  const set = <K extends keyof StaffFormValues>(k: K, value: StaffFormValues[K]) => {
    setV((old) => ({ ...old, [k]: value }));
    if (k in errors)
      setErrors((e) => {
        const next = { ...e };
        delete next[k as StaffField];
        return next;
      });
    if (k === 'phone') setProblem(null);
  };

  const mw = settings.data?.settings.pay.minimumWage;
  const salaryPaise = rupeesToPaise(v.salary);
  const lowWage = mw ? belowMinimumWage(salaryPaise, v.salaryType, mw) : false;
  const orgSelfie = settings.data?.settings.attendance.selfieOnCheckIn ?? false;

  const submit = () => {
    const errs = validateStaff(v);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    create.mutate(toStaffCreate(v), {
      onSuccess: (res) =>
        setInvite({ invite: res.invite, staffId: res.staff.id, name: res.staff.name }),
      onError: (e) => {
        if (isStepUpCancelled(e)) return;
        const p = createProblem(e);
        setProblem(p);
        if (p.kind === 'network') toast({ title: t('owner:errors.saveFailed'), tone: 'error' });
      },
    });
  };

  const doRehire = (id: string) =>
    rehire.mutate(
      { id, joinDate: v.joinDate },
      {
        onSuccess: (res) =>
          setInvite({ invite: res.invite, staffId: res.staff.id, name: res.staff.name }),
        onError: () => toast({ title: t('owner:errors.saveFailed'), tone: 'error' }),
      },
    );

  const err = (k: StaffField) => (errors[k] ? t(errors[k] as string) : undefined);
  const first = v.name.trim().split(' ')[0] || t('owner:common.everyone');

  const phoneProblem =
    problem?.kind === 'duplicate' ? (
      <span>
        {t('owner:staff.form.duplicate', { name: problem.name ?? '' })}{' '}
        {problem.staffId ? (
          <Link className="font-bold text-text underline" to={`/o/staff/${problem.staffId}`}>
            {t('owner:staff.form.duplicateAction', { name: problem.name?.split(' ')[0] ?? '' })}
          </Link>
        ) : null}
      </span>
    ) : undefined;

  return (
    <form
      noValidate
      className="grid max-w-(--container-narrow) gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {problem?.kind === 'cap' || problem?.kind === 'validation' ? (
        <Banner icon="warning-circle" tone="plain" live>
          {problem.message}
        </Banner>
      ) : null}
      {problem?.kind === 'rehire' ? (
        <Banner
          icon="users"
          live
          action={
            problem.staffId ? (
              <Button
                size="sm"
                variant="secondary"
                loading={rehire.isPending}
                onClick={() => doRehire(problem.staffId as string)}
              >
                {t('owner:staff.form.rehireAction', { name: problem.name?.split(' ')[0] ?? '' })}
              </Button>
            ) : undefined
          }
        >
          {problem.exitDate
            ? t('owner:staff.form.rehire', {
                name: problem.name ?? '',
                date: shortDate(problem.exitDate),
              })
            : t('owner:staff.form.rehireUnknownDate', { name: problem.name ?? '' })}
        </Banner>
      ) : null}

      <Field label={t('owner:staff.form.name')} error={err('name')} required>
        <Input
          value={v.name}
          onChange={(e) => set('name', e.target.value)}
          autoComplete="off"
          maxLength={80}
        />
      </Field>
      <Field
        label={t('owner:staff.form.phone')}
        hint={t('owner:staff.form.phoneHint')}
        error={err('phone') ?? phoneProblem}
        required
      >
        <Input
          type="tel"
          inputMode="tel"
          start="+91"
          value={v.phone}
          onChange={(e) => set('phone', e.target.value)}
          autoComplete="off"
        />
      </Field>
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.designation')}
        error={err('designation')}
        value={v.designation}
        onValueChange={(d) => set('designation', d as StaffFormValues['designation'])}
        options={DESIGNATIONS.map((d) => ({ value: d, label: d }))}
      />
      {v.designation === 'Other' ? (
        <Field label={t('owner:staff.form.designationOther')}>
          <Input
            value={v.designationOther}
            onChange={(e) => set('designationOther', e.target.value)}
            maxLength={40}
          />
        </Field>
      ) : null}
      <Field label={t('owner:staff.form.joinDate')}>
        <Input type="date" value={v.joinDate} onChange={(e) => set('joinDate', e.target.value)} />
      </Field>
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.salaryType')}
        value={v.salaryType}
        onValueChange={(x) => set('salaryType', x as 'monthly' | 'daily')}
        options={[
          { value: 'monthly', label: t('owner:staff.form.monthly') },
          { value: 'daily', label: t('owner:staff.form.daily') },
        ]}
      />
      <Field
        label={t('owner:staff.form.salary')}
        hint={
          v.salaryType === 'monthly'
            ? t('owner:staff.form.salaryHintMonthly')
            : t('owner:staff.form.salaryHintDaily')
        }
        error={err('salary')}
        required
      >
        <Input
          inputMode="decimal"
          start="₹"
          value={v.salary}
          onChange={(e) => set('salary', e.target.value)}
          autoComplete="off"
        />
      </Field>
      {lowWage && mw?.amountPaise != null && salaryPaise !== null ? (
        <p className="-mt-3 flex items-start gap-2 text-late text-sm" role="status">
          {t('owner:staff.form.belowMinimum', {
            amount: money(salaryPaise),
            minimum: money(mw.amountPaise),
            basis: mw.basis === 'monthly' ? 'month' : 'day',
          })}
        </p>
      ) : null}
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.template')}
        error={err('templateId')}
        value={v.templateId}
        onValueChange={(id) => set('templateId', id)}
        options={templates.map((x) => ({ value: x.id, label: x.name }))}
      />
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.weekOff')}
        layout="wrap"
        value={v.weekOffDow === null ? 'none' : String(v.weekOffDow)}
        onValueChange={(d) => set('weekOffDow', d === 'none' ? null : Number(d))}
        options={[
          ...WEEKDAYS.map((d) => ({ value: String(d), label: weekdayName(d).slice(0, 3) })),
          { value: 'none', label: t('owner:staff.form.noWeekOff') },
        ]}
      />
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.lang')}
        value={v.lang}
        onValueChange={(l) => set('lang', l as 'en' | 'gu')}
        options={[
          { value: 'en', label: t('common:language.en') },
          { value: 'gu', label: t('common:language.gu') },
        ]}
      />
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.selfie')}
        value={v.selfie === null ? 'inherit' : v.selfie ? 'on' : 'off'}
        onValueChange={(s) => set('selfie', s === 'inherit' ? null : s === 'on')}
        options={[
          {
            value: 'inherit',
            label: t('owner:staff.form.selfieInherit', {
              value: orgSelfie ? t('owner:staff.form.on') : t('owner:staff.form.off'),
            }),
          },
          { value: 'on', label: t('owner:staff.form.on') },
          { value: 'off', label: t('owner:staff.form.off') },
        ]}
      />
      <ChipGroup
        type="checkbox"
        legend={t('owner:staff.form.adultHint')}
        error={err('adult')}
        value={v.adult ? ['adult'] : []}
        onValueChange={(vals) => set('adult', vals.includes('adult'))}
        options={[{ value: 'adult', label: t('owner:staff.form.adult', { name: first }) }]}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          icon="whatsapp-logo"
          loading={create.isPending}
          loadingLabel={t('owner:staff.form.submitting')}
        >
          {t('owner:staff.form.submit')}
        </Button>
      </div>
      <InviteSheet
        invite={invite?.invite ?? null}
        name={invite?.name ?? ''}
        open={invite !== null}
        onOpenChange={(open) => {
          if (!open && invite) navigate(`/o/staff/${invite.staffId}`);
        }}
      />
    </form>
  );
}
