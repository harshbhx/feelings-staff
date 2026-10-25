/**
 * Pre-permission guidance (iOS style): say what a permission is for before the browser asks, then
 * ask on the tap; when it has been refused, say how to turn it back on. Nothing here asks on first
 * paint: the browser prompt only ever follows the "Allow" tap in `onAllow`.
 */
import { Button, Icon, type IconName, Sheet } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentPlatform } from '../../pwa/push';
import './ux.css';

export type PermissionKind = 'location' | 'notifications';
export type PermissionView = 'ask' | 'denied' | 'needs-install' | 'unsupported';

export interface PermissionCardProps {
  kind: PermissionKind;
  view: PermissionView;
  /** The tap that triggers the browser prompt. */
  onAllow: () => void | Promise<unknown>;
  /** "Not now". Omit to hide it. */
  onLater?: (() => void) | undefined;
  /** After the person fixed it in settings ("I turned it on"). Defaults to `onAllow`. */
  onRetry?: (() => void | Promise<unknown>) | undefined;
  /** For `needs-install`: open the install guide. */
  onShowInstall?: (() => void) | undefined;
  busy?: boolean | undefined;
  /** Screens with their own wording (the punch sheet) pass it; the shared copy is the default. */
  title?: ReactNode;
  lead?: ReactNode;
  allowLabel?: ReactNode;
}

const ICON: Record<PermissionKind, IconName> = { location: 'map-pin', notifications: 'bell' };

export function PermissionCard({
  kind,
  view,
  onAllow,
  onLater,
  onRetry,
  onShowInstall,
  busy,
  title,
  lead,
  allowLabel,
}: PermissionCardProps) {
  const { t } = useTranslation();
  const [retried, setRetried] = useState(false);
  const base = `common:ux.permission.${kind}`;
  const platform = currentPlatform();
  const steps = platform === 'ios' ? 'iosSteps' : platform === 'android' ? 'androidSteps' : 'otherSteps';

  if (view === 'ask') {
    return (
      <div className="ux-perm">
        <span className="ux-perm__disc" aria-hidden="true">
          <Icon name={ICON[kind]} />
        </span>
        <h2 className="ux-perm__title">{title ?? t(`${base}.title`)}</h2>
        <p className="ux-perm__lead">{lead ?? t(`${base}.lead`)}</p>
        <ul className="ux-reasons">
          {(['r1', 'r2', 'r3'] as const).map((r) => (
            <li key={r}>
              <Icon name="check-circle" />
              <span>{t(`${base}.${r}`)}</span>
            </li>
          ))}
        </ul>
        <div className="ux-perm__actions">
          <Button variant="primary" block icon={ICON[kind]} loading={busy} onClick={() => void onAllow()}>
            {allowLabel ?? t(`${base}.allow`)}
          </Button>
          {onLater ? (
            <Button variant="ghost" block onClick={onLater}>
              {t('common:ux.permission.later')}
            </Button>
          ) : null}
        </div>
        <p className="ux-perm__note">{t('common:ux.permission.next')}</p>
      </div>
    );
  }

  if (view === 'denied') {
    return (
      <div className="ux-perm">
        <span className="ux-perm__disc" data-tone="warn" aria-hidden="true">
          <Icon name="lock" />
        </span>
        <h2 className="ux-perm__title">{t(`${base}.deniedTitle`)}</h2>
        <p className="ux-perm__lead">{t(`${base}.deniedLead`)}</p>
        <ol className="ux-steps ux-steps--plain">
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n}>
              <span className="ux-steps__num" aria-hidden="true">
                {n}
              </span>
              <span>{t(`${base}.${steps}.${n}`)}</span>
            </li>
          ))}
        </ol>
        {retried ? (
          <p className="ux-perm__note" role="status">
            {t('common:ux.permission.stillOff')}
          </p>
        ) : null}
        <div className="ux-perm__actions">
          <Button
            variant="primary"
            block
            loading={busy}
            onClick={async () => {
              setRetried(true);
              await (onRetry ?? onAllow)();
            }}
          >
            {t('common:ux.permission.tryAgain')}
          </Button>
          {onLater ? (
            <Button variant="ghost" block onClick={onLater}>
              {t('common:actions.close')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (view === 'needs-install') {
    return (
      <div className="ux-perm">
        <span className="ux-perm__disc" data-tone="warn" aria-hidden="true">
          <Icon name="plus-square" />
        </span>
        <h2 className="ux-perm__title">{t('common:ux.permission.notifications.installTitle')}</h2>
        <p className="ux-perm__lead">{t('common:ux.permission.notifications.installLead')}</p>
        <div className="ux-perm__actions">
          {onShowInstall ? (
            <Button variant="primary" block onClick={onShowInstall}>
              {t('common:ux.permission.notifications.installAction')}
            </Button>
          ) : null}
          {onLater ? (
            <Button variant="ghost" block onClick={onLater}>
              {t('common:actions.close')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ux-perm">
      <span className="ux-perm__disc" data-tone="warn" aria-hidden="true">
        <Icon name="warning-circle" />
      </span>
      <h2 className="ux-perm__title">{t('common:ux.permission.notifications.unsupportedTitle')}</h2>
      <p className="ux-perm__lead">{t('common:ux.permission.notifications.unsupportedLead')}</p>
      {onLater ? (
        <div className="ux-perm__actions">
          <Button variant="ghost" block onClick={onLater}>
            {t('common:actions.close')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface PermissionSheetProps extends Omit<PermissionCardProps, 'onLater'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The card in an iOS sheet, for the places that ask from a button (Me, owner setup). */
export function PermissionSheet({ open, onOpenChange, ...card }: PermissionSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(`common:ux.permission.${card.kind}.title`)}
      titleHidden
    >
      <PermissionCard {...card} onLater={() => onOpenChange(false)} />
    </Sheet>
  );
}
