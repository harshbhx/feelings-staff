/**
 * The Radix half of the toast (provider, root, viewport). A lazy chunk: Radix Toast and its
 * collection, dismissable-layer and presence helpers stay out of the staff initial bundle (PRD 11.10).
 */
import { Toast as RToast } from 'radix-ui';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { Button, IconButton } from './Button';
import type { ToastInput, ToastTone } from './Toast';

interface ToastProps extends ToastInput {
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  className?: string | undefined;
}

const TONE_ICON = { success: 'check-circle', error: 'warning-circle' } as const satisfies Record<
  Exclude<ToastTone, 'neutral'>,
  string
>;

/** One toast: ink text on white with a hairline, at the bottom above the action bar, fading in 140 ms. */
function Toast({
  title,
  description,
  tone = 'neutral',
  action,
  duration,
  open,
  onOpenChange,
  className,
}: ToastProps) {
  const { t } = useTranslation();
  return (
    <RToast.Root
      className={cx('fs-toast', className)}
      data-tone={tone}
      open={open}
      onOpenChange={onOpenChange}
      duration={duration ?? (action ? 8000 : 5000)}
    >
      {tone !== 'neutral' ? <Icon name={TONE_ICON[tone]} className="fs-toast__icon" /> : null}
      <div className="fs-toast__text">
        <RToast.Title className="fs-toast__title">{title}</RToast.Title>
        {description ? (
          <RToast.Description className="fs-toast__desc">{description}</RToast.Description>
        ) : null}
      </div>
      {action ? (
        <RToast.Action altText={action.altText} asChild>
          <Button size="sm" variant="secondary" onClick={action.onClick}>
            {action.label}
          </Button>
        </RToast.Action>
      ) : null}
      <RToast.Close asChild>
        <IconButton icon="x" label={t('ui:toast.close')} className="fs-toast__close" />
      </RToast.Close>
    </RToast.Root>
  );
}

export interface ToastLayerProps {
  current: (ToastInput & { key: number }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bottomOffset?: string | undefined;
  className?: string | undefined;
}

export default function ToastLayer({
  current,
  open,
  onOpenChange,
  bottomOffset,
  className,
}: ToastLayerProps) {
  const { t } = useTranslation();
  const style = bottomOffset ? ({ '--fs-toast-offset': bottomOffset } as CSSProperties) : undefined;
  return (
    <RToast.Provider swipeDirection="down" label={t('ui:toast.region')}>
      {current ? (
        <Toast
          key={current.key}
          title={current.title}
          description={current.description}
          tone={current.tone}
          action={current.action}
          duration={current.duration}
          open={open}
          onOpenChange={onOpenChange}
        />
      ) : null}
      <RToast.Viewport className={cx('fs-toast-viewport', className)} style={style} />
    </RToast.Provider>
  );
}
