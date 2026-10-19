/**
 * Install help for a browser tab (PRD 4.1.3 steps 2-5, 4.2, S-03): one Install button on Android
 * after `beforeinstallprompt`, the three Safari steps on iPhone, "open in Safari/Chrome" for other
 * and in-app browsers, a QR on computers. The join code is shown big with Copy wherever the person
 * will type it into the installed app.
 */
import { formatJoinCode } from '@fs/contracts';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { installContext } from '../lib/install-context';
import { promptInstall, useInstallPrompt } from '../lib/install-prompt';
import { qrPath } from '../lib/qr';
import { Button, SectionTitle } from './bits';
import { Icon, type IconName } from './icons';
import { AppMark } from './layout';

/** Clipboard with a fallback for older WebViews. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the old way
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Which thing was just copied, cleared after 2.5 s. */
export function useCopy(): { copied: string | null; copy: (text: string, tag: string) => void } {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    copy: (text, tag) => {
      void copyText(text).then((ok) => {
        if (ok) setCopied(tag);
      });
    },
  };
}

function CopyButton({
  text,
  tag,
  label,
  done,
  copy,
}: {
  text: string;
  tag: string;
  label: string;
  done: string;
  copy: ReturnType<typeof useCopy>;
}) {
  const isDone = copy.copied === tag;
  return (
    <>
      <Button icon={isDone ? 'check-circle' : 'copy'} onClick={() => copy.copy(text, tag)}>
        {isDone ? done : label}
      </Button>
      <span role="status" className="sr-only">
        {isDone ? done : ''}
      </span>
    </>
  );
}

export function CodeCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const copy = useCopy();
  const shown = formatJoinCode(code);
  return (
    <section
      aria-labelledby="join-code-title"
      className="mt-6 rounded-md border border-border bg-bg-soft p-5"
    >
      <p id="join-code-title" className="text-sm font-semibold text-text">
        {t('auth:install.codeTitle')}
      </p>
      <p
        data-testid="join-code"
        className="mt-2 text-2xl leading-[1.1] font-extrabold tracking-[0.06em] text-text tabular-nums"
      >
        {shown}
      </p>
      <div className="mt-4">
        <CopyButton
          text={shown}
          tag="code"
          label={t('auth:install.copyCode')}
          done={t('auth:common.copied')}
          copy={copy}
        />
      </div>
    </section>
  );
}

function QrImage({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className="size-48 text-text"
    >
      <path d={qr.d} fill="currentColor" />
    </svg>
  );
}

interface Step {
  icon: IconName | 'app';
  title: string;
  detail: string;
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-4 divide-y divide-border border-y border-border">
      {steps.map((s, i) => (
        <li key={s.title} className="flex items-center gap-4 py-4">
          {s.icon === 'app' ? (
            <AppMark size="lg" />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-bg-soft text-text"
            >
              <Icon name={s.icon} className="size-7" />
            </span>
          )}
          <div>
            <p className="text-base leading-[1.3] font-bold text-text">
              <span className="text-text-muted tabular-nums">{i + 1}. </span>
              {s.title}
            </p>
            <p className="mt-0.5 text-sm text-text-muted">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function OpenElsewhere({ title, detail, link }: { title: string; detail: string; link: string }) {
  const { t } = useTranslation();
  const copy = useCopy();
  return (
    <section aria-labelledby="install-title" className="mt-8 rounded-md border border-border p-5">
      <div className="flex items-start gap-3">
        <Icon name="link-simple" className="mt-0.5 size-6 text-text" />
        <div>
          <SectionTitle id="install-title">{title}</SectionTitle>
          <p className="mt-1 text-sm text-text-muted">{detail}</p>
        </div>
      </div>
      <div className="mt-5">
        <CopyButton
          text={link}
          tag="link"
          label={t('auth:install.copyLink')}
          done={t('auth:common.linkCopied')}
          copy={copy}
        />
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="install-title" className="mt-8">
      <SectionTitle id="install-title">{title}</SectionTitle>
      {children}
    </section>
  );
}

/**
 * The install help for this browser. `code` is shown when the person will type it in the app
 * (invite page); `link` is what the QR and Copy link carry.
 */
export function InstallGuide({ code, link }: { code: string | null; link: string }) {
  const { t } = useTranslation();
  const prompt = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [acceptedQuietly, setAcceptedQuietly] = useState(false);
  const copy = useCopy();

  // Some browsers accept the prompt but never fire `appinstalled`; don't leave "Installing…" up.
  useEffect(() => {
    if (!installing || prompt.installed) return;
    const timer = setTimeout(() => setAcceptedQuietly(true), 15_000);
    return () => clearTimeout(timer);
  }, [installing, prompt.installed]);

  const context = installContext({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: false,
    allowBrowser: false,
    canPrompt: (prompt.canPrompt || installing) && !dismissed,
  });
  const codeCard = code ? <CodeCard code={code} /> : null;

  if (prompt.installed || acceptedQuietly) {
    return (
      <>
        <div
          role="status"
          className="mt-8 flex items-start gap-3 rounded-md border border-border p-5 text-base font-semibold text-text"
        >
          <Icon name="check-circle" className="mt-0.5 size-6 text-[var(--status-present)]" />
          <p>{t('auth:install.done')}</p>
        </div>
        {codeCard}
      </>
    );
  }

  switch (context) {
    case 'installed':
      return null;

    case 'android-prompt':
      return (
        <>
          <Section title={t('auth:install.title')}>
            <p className="mt-2 text-base text-text-body">{t('auth:install.androidLead')}</p>
            <div className="mt-5">
              <Button
                variant="primary"
                icon="download-simple"
                disabled={installing}
                onClick={() => {
                  setInstalling(true);
                  void promptInstall().then((outcome) => {
                    if (outcome !== 'accepted') {
                      setDismissed(true);
                      setInstalling(false);
                    }
                  });
                }}
              >
                {installing ? t('auth:install.installing') : t('auth:install.button')}
              </Button>
            </div>
          </Section>
          {codeCard}
        </>
      );

    case 'android-manual':
      return (
        <>
          <Section title={t('auth:install.title')}>
            <Steps
              steps={[
                {
                  icon: 'device-mobile',
                  title: t('auth:install.android.menu'),
                  detail: t('auth:install.android.menuDetail'),
                },
                {
                  icon: 'plus-square',
                  title: t('auth:install.android.add'),
                  detail: t('auth:install.android.addDetail'),
                },
                {
                  icon: 'app',
                  title: t('auth:install.open'),
                  detail: t('auth:install.openDetail'),
                },
              ]}
            />
          </Section>
          {codeCard}
        </>
      );

    case 'ios-safari':
      return (
        <>
          <Section title={t('auth:install.title')}>
            <Steps
              steps={[
                {
                  icon: 'export',
                  title: t('auth:install.ios.share'),
                  detail: t('auth:install.ios.shareDetail'),
                },
                {
                  icon: 'plus-square',
                  title: t('auth:install.ios.add'),
                  detail: t('auth:install.ios.addDetail'),
                },
                {
                  icon: 'app',
                  title: t('auth:install.open'),
                  detail: t('auth:install.openDetail'),
                },
              ]}
            />
          </Section>
          {codeCard}
        </>
      );

    case 'ios-other':
      return (
        <OpenElsewhere
          title={t('auth:install.openInSafari')}
          detail={t('auth:install.openInSafariDetail')}
          link={link}
        />
      );

    case 'android-in-app':
      return (
        <OpenElsewhere
          title={t('auth:install.openInChrome')}
          detail={t('auth:install.openInChromeDetail')}
          link={link}
        />
      );

    case 'desktop':
      return (
        <Section title={t('auth:install.onPhone')}>
          <p className="mt-2 text-base text-text-body">{t('auth:install.onPhoneDetail')}</p>
          <div className="mt-5 inline-flex rounded-md border border-border bg-bg p-3">
            <QrImage text={link} label={t('auth:install.qrLabel')} />
          </div>
          <div className="mt-5 max-w-[16rem]">
            <CopyButton
              text={link}
              tag="link"
              label={t('auth:install.copyLink')}
              done={t('auth:common.linkCopied')}
              copy={copy}
            />
          </div>
        </Section>
      );
  }
}
