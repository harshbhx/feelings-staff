/**
 * Salon (PRD 4.17): name, address, phone, the name staff see for the owner, and the logo choice.
 * Also the read-only parts of Data and privacy and App (retention, notice version, app version).
 */
import type { SettingsView } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, PhoneField, Textarea, useToast } from '@fs/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { usePatchSettings } from '../api/settings';
import { Meta, Section } from '../components/layout';
import { useErrorText } from '../components/states';

const tenDigits = (e164: string | null) => (e164 ? e164.replace(/^\+91/, '') : '');

export function SalonSection({ view }: { view: SettingsView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const patch = usePatchSettings();
  const [name, setName] = useState(view.org.name);
  const [address, setAddress] = useState(view.org.address ?? '');
  const [phone, setPhone] = useState(tenDigits(view.org.phone));
  const [owner, setOwner] = useState(view.org.ownerDisplayName);
  const [logo, setLogo] = useState(view.org.logo);
  const [tried, setTried] = useState(false);
  const problems = {
    name: name.trim() ? undefined : t('owner:settings.salon.errors.name'),
    owner: owner.trim() ? undefined : t('owner:settings.salon.errors.owner'),
    phone:
      phone === '' || /^[6-9]\d{9}$/.test(phone) ? undefined : t('owner:staff.form.errors.phone'),
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problems.name || problems.owner || problems.phone) return;
    patch.mutate(
      {
        org: {
          name: name.trim(),
          address: address.trim() || null,
          phone: phone ? `+91${phone}` : null,
          ownerDisplayName: owner.trim(),
          logo,
        },
      },
      {
        onSuccess: () => toast({ title: t('owner:settings.saved') }),
        onError: (err) => {
          if (!isStepUpCancelled(err)) toast({ title: errorText(err), tone: 'error' });
        },
      },
    );
  }

  return (
    <form noValidate onSubmit={submit} className="grid max-w-(--container-narrow) gap-6">
      <Field label={t('owner:settings.salon.name')} error={tried ? problems.name : undefined}>
        <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('owner:settings.salon.address')} hint={t('owner:settings.salon.addressHint')}>
        <Textarea
          value={address}
          rows={3}
          maxLength={240}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>
      <Field label={t('owner:settings.salon.phone')} error={tried ? problems.phone : undefined}>
        <PhoneField value={phone} onValueChange={setPhone} />
      </Field>
      <Field
        label={t('owner:settings.salon.owner')}
        hint={t('owner:settings.salon.ownerHint', { name: owner || view.org.ownerDisplayName })}
        error={tried ? problems.owner : undefined}
      >
        <Input value={owner} maxLength={40} onChange={(e) => setOwner(e.target.value)} />
      </Field>
      <ChipGroup
        type="radio"
        legend={t('owner:settings.salon.logo')}
        hint={t('owner:settings.salon.logoHint')}
        value={logo}
        onValueChange={(v) => setLogo(v as 'bindi' | 'wordmark')}
        options={(['bindi', 'wordmark'] as const).map((l) => ({
          value: l,
          label: t(`owner:settings.salon.logos.${l}`),
        }))}
      />
      <Meta>{t('owner:settings.salon.timezone')}</Meta>
      <div className="border-border border-t pt-5">
        <Button type="submit" variant="primary" icon="check-circle" disabled={patch.isPending}>
          {patch.isPending ? t('owner:common.saving') : t('owner:common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Data and privacy, the read-only part: what is kept and for how long (PRD 8.3, 10.6). */
export function PrivacyNote({ view }: { view: SettingsView }) {
  const { t } = useTranslation();
  const p = view.settings.privacy;
  return (
    <Section
      title={t('owner:settings.privacy.kept')}
      className="grid max-w-(--container-narrow) gap-2"
    >
      <ul className="grid list-disc gap-1 pl-5 text-text-body">
        <li>{t('owner:settings.privacy.location', { days: p.locationRetentionDays })}</li>
        <li>{t('owner:settings.privacy.selfies', { days: p.selfieRetentionDays })}</li>
        <li>{t('owner:settings.privacy.payroll')}</li>
      </ul>
      <Meta>{t('owner:settings.privacy.notice', { version: p.noticeVersion })}</Meta>
    </Section>
  );
}
