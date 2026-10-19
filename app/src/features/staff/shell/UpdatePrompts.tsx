/**
 * Update flow UI (PRD 11.7): the toast "A new version is ready." waits while the check-in sheet is
 * open or a punch is queued (register.ts decides `canPromptNow`); a 426 from the server shows the
 * full-screen "Please update" with Update now.
 */
import { Button, Toast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { applyUpdate, useUpdateState } from '../../../pwa/register';

export function UpdateToast() {
  const { t } = useTranslation();
  const update = useUpdateState();
  return (
    <Toast
      open={update.canPromptNow && !update.upgradeRequired}
      title={t('staff:shell.update')}
      duration={Number.POSITIVE_INFINITY}
      action={{
        label: t('staff:shell.updateAction'),
        altText: t('staff:shell.updateAction'),
        onClick: () => void applyUpdate(),
      }}
    />
  );
}

export function UpgradeOverlay() {
  const { t } = useTranslation();
  const update = useUpdateState();
  if (!update.upgradeRequired) return null;
  return (
    <div className="staff-overlay" role="alertdialog" aria-labelledby="fs-upgrade-title">
      <div className="staff-overlay__inner flex flex-col gap-4">
        <h1 id="fs-upgrade-title">{t('staff:shell.upgradeTitle')}</h1>
        <p>{t('staff:shell.upgradeBody')}</p>
        <Button
          variant="primary"
          block
          icon="arrows-clockwise"
          onClick={() => {
            if (update.needRefresh) void applyUpdate();
            else window.location.reload();
          }}
        >
          {t('staff:shell.upgradeAction')}
        </Button>
      </div>
    </div>
  );
}
