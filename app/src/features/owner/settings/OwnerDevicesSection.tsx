/**
 * Settings, Security, Devices on the owner host (docs/owner-access.md "Passkeys" flow 4,
 * ui-redesign-plan 5b): every approved device (one passkey each) with its platform, name, "This
 * device", added and last used. Rename it; Remove it behind the fingerprint on this device plus the
 * owner PIN, which signs that device out. The last device cannot be removed: its Remove is disabled
 * and says why. Owner build only (Security shows this section only there).
 */
import { isApiError, type Me, type OwnerDeviceView } from '@fs/contracts';
import { Button, Field, Icon, Input, List, ListRow, Sheet, StatusChip, useToast } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { meQueryKey } from '../../../api/hooks';
import { passkeyProblem } from '../../auth/lib/passkey';
import { isStepUpCancelled } from '../../auth/step-up';
import { PLATFORM_ICON } from '../actions/DeviceRequestCard';
import { useOwnerDevices, useRemoveDevice, useRenameDevice } from '../api/owner-access';
import { Meta, Section } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { clock, shortDate, todayIst } from '../lib/format';
import { type ConfirmWithPasskey, usePasskeyConfirm } from '../lib/passkey-confirm';

const NAME_MAX = 80;

export function OwnerDevicesSection() {
  const { t } = useTranslation();
  const devices = useOwnerDevices();
  const count = devices.data?.devices.length ?? 0;
  // The fingerprint challenge is fetched ahead only when there is something to remove.
  const confirm = usePasskeyConfirm(count > 1);
  return (
    <Section title={t('owner:access.devices.title')}>
      <Meta>{t('owner:access.devices.what')}</Meta>
      <QueryView query={devices} skeleton={<RowsSkeleton rows={2} />}>
        {(v) => (
          <List>
            {v.devices.map((d) => (
              <DeviceRow key={d.id} device={d} last={v.devices.length <= 1} confirm={confirm} />
            ))}
          </List>
        )}
      </QueryView>
    </Section>
  );
}

function when(ts: number): string {
  return `${shortDate(todayIst(ts))} ${clock(ts)}`;
}

function DeviceRow({
  device,
  last,
  confirm,
}: {
  device: OwnerDeviceView;
  last: boolean;
  confirm: ConfirmWithPasskey;
}) {
  const { t } = useTranslation();
  const whyId = useId();
  return (
    <ListRow
      leading={
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-bg-tint text-on-tint"
        >
          <Icon name={PLATFORM_ICON[device.platform]} className="size-5" />
        </span>
      }
      title={device.deviceName}
      subtitle={t('owner:access.devices.line', {
        platform: t(`owner:access.devices.platform.${device.platform}`),
        added: shortDate(todayIst(device.createdAt)),
        used: device.lastUsedAt ? when(device.lastUsedAt) : t('owner:access.devices.notUsed'),
      })}
      meta={
        device.current ? (
          <StatusChip status="present" label={t('owner:access.devices.thisDevice')} />
        ) : null
      }
      trailing={
        <span className="flex flex-col items-end gap-1">
          <span className="flex flex-wrap justify-end gap-2">
            <RenameSheet device={device} />
            <RemoveSheet
              device={device}
              disabled={last}
              describedBy={last ? whyId : undefined}
              confirm={confirm}
            />
          </span>
          {last ? (
            <span id={whyId} className="max-w-44 text-right text-sm text-text-muted">
              {t('owner:access.devices.lastWhy')}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

function RenameSheet({ device }: { device: OwnerDeviceView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const rename = useRenameDevice();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(device.deviceName);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value || value.length > NAME_MAX) {
      setProblem(t('owner:access.devices.nameInvalid'));
      return;
    }
    rename.mutate(
      { id: device.id, deviceName: value },
      {
        onSuccess: () => {
          setOpen(false);
          toast({ title: t('owner:settings.saved') });
        },
        onError: (err) => toast({ title: errorText(err), tone: 'error' }),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setName(device.deviceName);
          setProblem(null);
        }
      }}
      title={t('owner:access.devices.renameTitle')}
      trigger={
        <Button size="sm" variant="ghost" icon="pencil-simple">
          {t('owner:access.devices.rename')}
          <span className="sr-only"> {device.deviceName}</span>
        </Button>
      }
    >
      <form noValidate onSubmit={submit} className="grid gap-4">
        <Field label={t('owner:access.devices.nameLabel')} error={problem}>
          <Input
            name="device-name"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (problem) setProblem(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={rename.isPending}
            loadingLabel={t('owner:common.saving')}
          >
            {t('owner:access.devices.save')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </div>
      </form>
    </Sheet>
  );
}

function RemoveSheet({
  device,
  disabled,
  describedBy,
  confirm,
}: {
  device: OwnerDeviceView;
  disabled: boolean;
  describedBy: string | undefined;
  confirm: ConfirmWithPasskey;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const remove = useRemoveDevice(confirm);
  const [open, setOpen] = useState(false);

  if (disabled)
    return (
      <Button
        size="sm"
        variant="danger-secondary"
        icon="trash"
        disabled
        aria-describedby={describedBy}
      >
        {t('owner:access.devices.remove')}
        <span className="sr-only"> {device.deviceName}</span>
      </Button>
    );

  // The sheet closes first, so the fingerprint and then the PIN sheet are the only things on screen.
  const go = () => {
    setOpen(false);
    remove.mutate(
      { id: device.id },
      {
        onSuccess: () => {
          if (device.current) {
            // This browser's session ended with its passkey: back to the sign-in page.
            toast({ title: t('owner:access.devices.removedThis'), tone: 'success' });
            qc.removeQueries();
            qc.setQueryData<Me | null>(meQueryKey, null);
            navigate('/auth/owner', { replace: true });
            return;
          }
          toast({ title: t('owner:access.devices.removed'), tone: 'success' });
        },
        onError: (e) => {
          if (isStepUpCancelled(e)) return;
          if (!isApiError(e) && passkeyProblem(e) === 'cancelled') {
            toast({ title: t('owner:access.approve.cancelled') });
            return;
          }
          toast({
            title: isApiError(e, 'SIGNATURE_INVALID')
              ? t('owner:access.approve.failed')
              : errorText(e),
            tone: 'error',
          });
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:access.devices.removeTitle', { name: device.deviceName })}
      description={
        device.current
          ? t('owner:access.devices.removeThisBody')
          : t('owner:access.devices.removeBody')
      }
      trigger={
        <Button
          size="sm"
          variant="danger-secondary"
          icon="trash"
          loading={remove.isPending}
          loadingLabel={t('owner:access.devices.removing')}
        >
          {t('owner:access.devices.remove')}
          <span className="sr-only"> {device.deviceName}</span>
        </Button>
      }
      footer={
        <>
          <Button variant="danger-secondary" icon="fingerprint" onClick={go}>
            {t('owner:access.devices.removeConfirm')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    />
  );
}
