/**
 * The install gate (PRD 4.2, 4.1.3; AC S-03): in a browser tab every staff route shows how to add
 * the app to the home screen instead of the app. Android gets our Install button (only after
 * `beforeinstallprompt`), iOS Safari the 3-step sheet, other iOS browsers and in-app browsers
 * "Open in Safari/Chrome" with Copy link, desktop "Open on your phone" with a QR.
 *
 * Exported for WP-3's sign-in and invite pages: pass the URL to open and, optionally, extra
 * content (the join code with its Copy button) as children.
 */
import { Bindi, Button, Icon } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../../api/hooks';
import { InstallSteps } from '../../../lib/ux/InstallSteps';

import type { InstallContext } from './platform';
import { promptInstall, useInstallPrompt } from './prompt';
import { QrCode } from './QrCode';

export interface InstallGateProps {
  context: Exclude<InstallContext, 'standalone'> | InstallContext;
  /** The link to install from (the app's start URL, or the invite link). */
  url: string;
  children?: ReactNode;
}

export function InstallGate({ context, url, children }: InstallGateProps) {
  const { t } = useTranslation();
  const owner = useMe().data?.org.ownerDisplayName;
  return (
    <div className="staff-frame">
      <main className="staff-main flex flex-col gap-5 pt-8" data-install-context={context}>
        <p className="flex items-center gap-2 text-sm font-bold text-text">
          <Bindi size="marker" />
          {t('common:app.name')}
        </p>
        <div className="flex flex-col gap-3">
          <h1>{t('staff:install.title')}</h1>
          <p>{t('staff:install.lead')}</p>
          {owner ? (
            <p className="text-sm text-text-muted">{t('staff:install.why', { owner })}</p>
          ) : null}
        </div>
        {children}
        {context === 'android' ? <AndroidInstall /> : null}
        {context === 'ios-safari' ? <IosSteps /> : null}
        {context === 'ios-other' ? (
          <OpenElsewhere message={t('staff:install.iosOther')} url={url} />
        ) : null}
        {context === 'android-inapp' ? (
          <OpenElsewhere message={t('staff:install.androidInApp')} url={url} />
        ) : null}
        {context === 'desktop' ? <DesktopQr url={url} /> : null}
      </main>
    </div>
  );
}

function AndroidInstall() {
  const { t } = useTranslation();
  const prompt = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  if (prompt.installed) {
    return (
      <p className="staff-card flex items-start gap-3 font-semibold text-text" role="status">
        <Icon name="check-circle" className="mt-1 size-5 shrink-0 text-present" />
        {t('staff:install.androidDone')}
      </p>
    );
  }
  if (prompt.available && !prompt.snoozed) {
    return (
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
          }
        }}
      >
        {t('staff:install.androidButton')}
      </Button>
    );
  }
  return (
    <div className="staff-card staff-card--soft flex flex-col gap-3">
      <p>{prompt.snoozed ? t('staff:install.androidSnoozed') : t('staff:install.androidManual')}</p>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="staff-mock-row min-w-0 flex-1">
          <span>{t('staff:install.chromeLabel')}</span>
          <Icon name="dots-three-vertical" className="size-5 text-accent" />
        </span>
        <Icon name="arrow-right" className="size-5 shrink-0 text-text-muted" />
        <span className="staff-mock-row min-w-0 flex-1">
          <span className="staff-mock-row__value">{t('staff:install.androidButton')}</span>
        </span>
      </div>
    </div>
  );
}

function IosSteps() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="ios-steps" className="flex flex-col gap-3">
      <h2 id="ios-steps">{t('staff:install.iosStepsTitle')}</h2>
      <InstallSteps />
    </section>
  );
}

function OpenElsewhere({ message, url }: { message: string; url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold text-text">{message}</p>
      <p className="text-sm text-text-muted">{t('staff:install.iosOtherHint')}</p>
      <p className="staff-card break-all text-sm tabular">{url}</p>
      <Button
        variant="primary"
        block
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t('common:actions.copied') : t('common:actions.copyLink')}
      </Button>
      <p className="staff-live" role="status">
        {copied ? t('common:actions.copied') : ''}
      </p>
    </div>
  );
}

function DesktopQr({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold text-text">{t('staff:install.desktop')}</p>
      <p className="text-sm text-text-muted">{t('staff:install.desktopHint')}</p>
      <QrCode value={url} label={t('staff:install.qrLabel', { url })} className="staff-qr" />
      <p className="break-all text-sm text-text-muted">{url}</p>
    </div>
  );
}
