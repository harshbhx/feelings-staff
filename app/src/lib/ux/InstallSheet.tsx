/**
 * The install guide as an iOS sheet. iPhone Safari gets the three steps; Android gets our Install
 * button once Chrome offers it, or the menu route. Dismissals are remembered (see use-install-nudge).
 */
import { Button, Sheet } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { promptInstall, useInstallPrompt } from '../../features/staff/install/prompt';
import { InstallSteps } from './InstallSteps';

export type InstallChoice = 'later' | 'never' | 'done';

export function InstallSheet({
  open,
  platform,
  onClose,
}: {
  open: boolean;
  platform: 'ios' | 'android';
  onClose: (choice: InstallChoice) => void;
}) {
  const { t } = useTranslation();
  const prompt = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose('later');
      }}
      title={t('common:ux.install.title')}
      titleHidden
      footer={
        <>
          {platform === 'android' && prompt.available ? (
            <Button
              variant="primary"
              block
              icon="plus"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await promptInstall();
                } finally {
                  setBusy(false);
                  onClose('done');
                }
              }}
            >
              {t('common:ux.install.androidButton')}
            </Button>
          ) : (
            <Button variant="primary" block onClick={() => onClose('done')}>
              {t('common:ux.install.gotIt')}
            </Button>
          )}
          <Button variant="ghost" block onClick={() => onClose('later')}>
            {t('common:ux.install.later')}
          </Button>
          <button type="button" className="ux-link" onClick={() => onClose('never')}>
            {t('common:ux.install.never')}
          </button>
        </>
      }
    >
      <div className="ux-perm">
        <h2 className="ux-perm__title">{t('common:ux.install.title')}</h2>
        <p className="ux-perm__lead">{t('common:ux.install.lead')}</p>
        {platform === 'ios' ? (
          <InstallSteps />
        ) : prompt.available ? null : (
          <p className="ux-perm__note">{t('common:ux.install.androidMenu')}</p>
        )}
      </div>
    </Sheet>
  );
}
