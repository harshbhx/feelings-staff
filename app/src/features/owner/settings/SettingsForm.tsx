/**
 * One rule section as a form (PRD 4.17, O-16.1): every field with its label and a one-line "what this
 * does" that follows the value as Urmi changes it ("Grace: 12 min. Late arrivals within 12 min aren't
 * counted."). **Save** (the one sindoor action) sends only what changed; the server asks for the PIN
 * when a field needs it, and says so beforehand.
 */
import type { OrgSettings, SettingsView } from '@fs/contracts';
import { Button, ChipGroup, Field as KitField, Input, Stepper, Switch, TimeField, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { usePatchSettings } from '../api/settings';
import { Meta } from '../components/layout';
import { useErrorText } from '../components/states';
import { rupeesToPaise } from '../staff/staff-form';
import {
  buildPatch,
  changedFields,
  type Field,
  keyOf,
  needsStepUp,
  OT_CHOICES,
  type OtChoice,
  otChoice,
  otRate,
  readField,
  type Values,
} from './fields';

export function SettingsForm({ view, fields }: { view: SettingsView; fields: readonly Field[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<Values>({});
  // Bumped on save and undo so typed-in fields start again from the saved value.
  const [round, setRound] = useState(0);
  const reset = () => {
    setDraft({});
    setRound((n) => n + 1);
  };
  const settings = view.settings;
  const value = (f: Field) => (keyOf(f) in draft ? draft[keyOf(f)] : readField(settings, f));
  const set = (f: Field, v: unknown) => setDraft((d) => ({ ...d, [keyOf(f)]: v }));
  const changed = changedFields(settings, fields, draft);
  const pin = needsStepUp(settings, fields, draft);

  const save = () =>
    patch.mutate(
      { settings: buildPatch(settings, fields, draft) },
      {
        onSuccess: () => {
          reset();
          toast({ title: t('owner:settings.saved') });
        },
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (changed.length > 0) save();
      }}
      className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-7"
    >
      {fields.map((f) => (
        <FieldRow key={`${keyOf(f)}-${round}`} field={f} value={value(f)} settings={settings} onChange={(v) => set(f, v)} />
      ))}
      <div className="grid gap-3 border-border border-t pt-5">
        {pin && changed.length > 0 ? <Meta>{t('owner:settings.needsPin')}</Meta> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            icon={pin ? 'lock' : 'check-circle'}
            disabled={changed.length === 0 || patch.isPending}
          >
            {patch.isPending ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          {changed.length > 0 ? (
            <Button onClick={reset}>{t('owner:settings.undo')}</Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function FieldRow({
  field: f,
  value,
  settings,
  onChange,
}: {
  field: Field;
  value: unknown;
  settings: OrgSettings;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const label = t(`owner:settings.f.${f.id}.label`);
  const shown =
    f.kind === 'otRate'
      ? t(`owner:settings.ot.${otChoice(value as OrgSettings['overtime']['rate'])}`)
      : f.kind === 'choice'
        ? t(`owner:settings.f.${f.id}.options.${String(value).replace('.', '_')}`)
        : f.kind === 'rupees'
          ? value === null
            ? '–'
            : String(Number(value) / 100)
          : String(value);
  const what = t(`owner:settings.f.${f.id}.what`, { value: shown });

  switch (f.kind) {
    case 'stepper':
      return (
        <Stepper
          label={label}
          hint={what}
          value={Number(value)}
          onValueChange={onChange}
          min={f.min}
          max={f.max}
          step={f.step}
          unit={f.unit ? t(`owner:settings.units.${f.unit}`) : undefined}
        />
      );
    case 'switch':
      return (
        <Switch label={label} description={what} checked={value === true} onCheckedChange={onChange} />
      );
    case 'choice':
      return (
        <ChipGroup
          type="radio"
          legend={label}
          hint={what}
          value={String(value)}
          onValueChange={(v) => onChange(typeof f.options[0] === 'number' ? Number(v) : v)}
          options={f.options.map((o) => ({
            value: String(o),
            label: t(`owner:settings.f.${f.id}.options.${String(o).replace('.', '_')}`),
          }))}
        />
      );
    case 'otRate':
      return (
        <ChipGroup
          type="radio"
          legend={label}
          hint={what}
          value={otChoice(value as OrgSettings['overtime']['rate'])}
          onValueChange={(v) => onChange(otRate(v as OtChoice, settings.overtime.rate))}
          options={OT_CHOICES.map((o) => ({ value: o, label: t(`owner:settings.ot.${o}`) }))}
        />
      );
    case 'time':
      return (
        <KitField label={label} hint={what} className="max-w-48">
          <TimeField value={String(value)} onValueChange={onChange} />
        </KitField>
      );
    case 'text':
      return (
        <KitField label={label} hint={what}>
          <Input
            value={String(value ?? '')}
            maxLength={f.maxLength}
            onChange={(e) => onChange(e.target.value)}
          />
        </KitField>
      );
    case 'rupees':
      return (
        <KitField label={label} hint={what} className="max-w-60">
          <Input
            inputMode="decimal"
            defaultValue={value === null ? '' : String(Number(value) / 100)}
            onChange={(e) =>
              onChange(
                e.target.value.trim() === '' && f.nullable ? null : rupeesToPaise(e.target.value),
              )
            }
          />
        </KitField>
      );
  }
}
