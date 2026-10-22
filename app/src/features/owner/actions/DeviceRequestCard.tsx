/**
 * The approval card for a new owner device (docs/owner-access.md "Passkeys" flow 3, ui-redesign-plan
 * 5b), in the Needs action card style: the device and when and from where it asked (city only), the
 * code to compare with the one on the new device, Approve (fingerprint on this device, then the owner
 * PIN) and Decline (not red: the owner can simply ask again). Owner build only.
 */
import { isApiError, type OwnerDeviceRequestView, type Platform } from '@fs/contracts';
import { Button, Card, Icon, type IconName, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { groupCode, minutesLeft, spokenCode } from '../../auth/lib/device-code';
import { passkeyProblem } from '../../auth/lib/passkey';
import { isStepUpCancelled } from '../../auth/step-up';
import { type DeviceDecision, useDecideDeviceRequest } from '../api/owner-access';
import { useErrorText } from '../components/states';
import { ago } from '../lib/format';
import { type ConfirmWithPasskey, usePasskeyConfirm } from '../lib/passkey-confirm';

export const PLATFORM_ICON: Record<Platform, IconName> = {
  ios: 'phone',
  android: 'phone',
  desktop: 'keyboard',
  other: 'fingerprint',
};

export function DeviceRequestsCard({
  requests,
  now,
}: {
  requests: readonly OwnerDeviceRequestView[];
  now: number;
}) {
  const { t } = useTranslation();
  const confirm = usePasskeyConfirm(requests.length > 0);
  return (
    <Card
      flush
      title={
        <>
          {t('owner:access.approve.group')}
          <span className="ml-2 font-semibold text-sm text-text-muted tabular-nums">
            {requests.length}
          </span>
        </>
      }
    >
      <ul className="grid">
        {requests.map((r) => (
          <DeviceRequestItem key={r.id} request={r} now={now} confirm={confirm} />
        ))}
      </ul>
    </Card>
  );
}

function DeviceRequestItem({
  request,
  now,
  confirm,
}: {
  request: OwnerDeviceRequestView;
  now: number;
  confirm: ConfirmWithPasskey;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const decide = useDecideDeviceRequest(confirm);
  const left = minutesLeft(request.expiresAt, now);

  const act = (decision: DeviceDecision) =>
    decide.mutate(
      { id: request.id, decision },
      {
        onSuccess: () =>
          toast({
            title:
              decision === 'approve'
                ? t('owner:access.approve.approved')
                : t('owner:access.approve.declined'),
            tone: 'success',
          }),
        onError: (e) => {
          if (isStepUpCancelled(e)) return;
          if (!isApiError(e) && passkeyProblem(e) === 'cancelled') {
            // A closed fingerprint sheet is not an error (ui-redesign-plan 5b).
            toast({ title: t('owner:access.approve.cancelled') });
            return;
          }
          toast({
            title: isApiError(e, 'LINK_EXPIRED')
              ? t('owner:access.approve.expired')
              : isApiError(e, 'SIGNATURE_INVALID')
                ? t('owner:access.approve.failed')
                : errorText(e),
            tone: 'error',
          });
        },
      },
    );

  return (
    <li
      className="grid gap-3 border-border border-t px-(--card-pad) py-4 first:border-t-0"
      data-testid="action-owner_device"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-bg-tint text-maroon-800"
        >
          <Icon name={PLATFORM_ICON[request.platform]} className="size-5" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="font-bold text-text">
            {t('owner:access.approve.title', { name: request.deviceName })}
          </p>
          <p className="text-sm text-text-muted">
            {ago(request.createdAt, now, t)}
            {request.city ? ` · ${t('owner:access.approve.from', { city: request.city })}` : ''}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:pl-13">
        <p className="text-text-body">{t('owner:access.approve.compare')}</p>
        <p className="font-extrabold text-2xl text-text tabular-nums tracking-[0.08em]">
          <span aria-hidden="true">{groupCode(request.code)}</span>
          <span className="sr-only">{spokenCode(request.code)}</span>
        </p>
        <p className="text-sm text-text-muted">
          {left > 1
            ? t('owner:access.approve.expiresIn', { count: left })
            : t('owner:access.approve.expiresSoon')}
        </p>
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Icon name="lock" className="size-5 shrink-0" />
          {t('owner:access.approve.hint')}
        </p>
        <div className="flex flex-wrap gap-2 max-sm:*:grow">
          <Button
            size="sm"
            variant="secondary"
            icon="fingerprint"
            disabled={decide.isPending}
            loading={decide.isPending && decide.variables?.decision === 'approve'}
            loadingLabel={t('owner:access.approve.waiting')}
            onClick={() => act('approve')}
          >
            {t('owner:access.approve.approve')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={decide.isPending}
            onClick={() => act('decline')}
          >
            {t('owner:access.approve.decline')}
          </Button>
        </div>
      </div>
    </li>
  );
}
