/**
 * The full-screen install gate for phones and tablets in a browser tab (staff and owner). It has no
 * close button and no "later": the only way on is the installed app. iPhone Safari gets the three
 * steps; Android gets a real Install button once Chrome offers it, with the menu steps as the
 * fallback; other iPhone browsers and in-app browsers are told which browser to open.
 */
import { Button, Icon, Logo } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { installContext } from '../../features/auth/lib/install-context';
import { promptInstall, useInstallPrompt } from '../../features/staff/install/prompt';
import { LOGO_MASK } from '../brand';
import { InstallSteps } from './InstallSteps';
import { WithUx } from './ns';
import './ux.css';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function OpenElsewhere({ title, hint }: { title: string; hint: string }) {
  const { t } = useTranslation('ux');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}`;
  return (
    <div className="ux-gate__block">
      <h2 className="ux-gate__h2">{title}</h2>
      <p className="ux-perm__note">{hint}</p>
      <p className="ux-gate__link">{link}</p>
      <Button variant="primary" block icon="copy" onClick={async () => setCopied(await copy(link))}>
        {copied ? t('gate.copied') : t('gate.copyLink')}
      </Button>
      <p className="sr-only" role="status">
        {copied ? t('gate.copied') : ''}
      </p>
    </div>
  );
}

function AndroidSteps() {
  const { t } = useTranslation('ux');
  const steps = [
    { icon: 'dots-three-vertical', k: 'android1' },
    { icon: 'plus-square', k: 'android2' },
    { icon: 'check-circle', k: 'android3' },
  ] as const;
  return (
    <div className="ux-gate__block">
      <h2 className="ux-gate__h2">{t('gate.manualTitle')}</h2>
      <ol className="ux-steps">
        {steps.map((s, i) => (
          <li key={s.k} className="ux-steps__item">
            <span className="ux-steps__glyph" aria-hidden="true">
              <Icon name={s.icon} className="ux-steps__icon" />
            </span>
            <span className="ux-steps__text">
              <span className="ux-steps__title">
                <span className="ux-steps__num" aria-hidden="true">
                  {i + 1}
                </span>
                {t(`gate.${s.k}`)}
              </span>
              <span className="ux-steps__hint">{t(`gate.${s.k}Hint`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GateView() {
  const { t } = useTranslation('ux');
  const prompt = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const context = installContext({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: false,
    allowBrowser: false,
    canPrompt: prompt.available,
  });

  let body: ReactNode;
  if (prompt.installed) {
    body = (
      <p className="ux-gate__done" role="status">
        <Icon name="check-circle" />
        {t('gate.done')}
      </p>
    );
  } else if (context === 'android-prompt') {
    body = (
      <div className="ux-gate__block">
        <p className="ux-perm__note">{t('gate.androidLead')}</p>
        <Button
          variant="primary"
          size="lg"
          block
          icon="plus"
          loading={busy}
          loadingLabel={t('gate.installing')}
          onClick={async () => {
            setBusy(true);
            try {
              await promptInstall();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('gate.installButton')}
        </Button>
      </div>
    );
  } else if (context === 'android-manual') {
    body = <AndroidSteps />;
  } else if (context === 'ios-other') {
    body = <OpenElsewhere title={t('gate.openSafari')} hint={t('gate.openSafariHint')} />;
  } else if (context === 'android-in-app') {
    body = <OpenElsewhere title={t('gate.openChrome')} hint={t('gate.openChromeHint')} />;
  } else {
    body = <InstallSteps />;
  }

  return (
    <main className="ux-gate" data-install-context={context}>
      <div className="ux-gate__inner">
        <Logo name={t('common:app.shortName')} mask={LOGO_MASK} size="lg" />
        <h1 className="ux-perm__title">{t('gate.title')}</h1>
        <p className="ux-perm__lead">{t('gate.lead')}</p>
        {body}
        <p className="ux-perm__note">{t('gate.stays')}</p>
      </div>
    </main>
  );
}

export function InstallGate() {
  return (
    <WithUx>
      <GateView />
    </WithUx>
  );
}
