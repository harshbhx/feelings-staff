import { Toast as RToast } from 'radix-ui';
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons/Icon';
import { cx } from '../lib/cx';
import { Button, IconButton } from './Button';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastAction {
  label: string;
  /** What the action does, for screen readers that cannot reach the toast in time. */
  altText: string;
  onClick: () => void;
}

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone | undefined;
  action?: ToastAction | undefined;
  /** Milliseconds before it closes; default 5000, longer with an action. */
  duration?: number | undefined;
}

export interface ToastProps extends ToastInput {
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  className?: string | undefined;
}

const TONE_ICON = { success: 'check-circle', error: 'warning-circle' } as const;

/**
 * One toast: ink text on white with a hairline, at the bottom above the action bar, fading in
 * 140 ms. Use `useToast()` inside a `ToastProvider` rather than rendering this directly.
 */
export function Toast({
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

type ShowToast = (toast: ToastInput) => void;

const ToastContext = createContext<ShowToast | null>(null);

/** Show a toast. One at a time: a new one replaces the current one (PRD 12.6). */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast needs a <ToastProvider> above it');
  return show;
}

export interface ToastProviderProps {
  children: ReactNode;
  /**
   * Extra distance from the bottom edge, as a CSS length, so toasts sit above the action bar and
   * tab bar (`"calc(var(--app-bar-h) + var(--tabbar-h))"`). The safe area is added for you.
   */
  bottomOffset?: string | undefined;
  className?: string | undefined;
}

export function ToastProvider({ children, bottomOffset, className }: ToastProviderProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<(ToastInput & { key: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback<ShowToast>((toast) => {
    setCurrent({ ...toast, key: Date.now() });
    setOpen(true);
  }, []);
  const style = useMemo(
    () => (bottomOffset ? ({ '--fs-toast-offset': bottomOffset } as CSSProperties) : undefined),
    [bottomOffset],
  );
  return (
    <RToast.Provider swipeDirection="down" label={t('ui:toast.region')}>
      <ToastContext.Provider value={show}>{children}</ToastContext.Provider>
      {current ? (
        <Toast
          key={current.key}
          title={current.title}
          description={current.description}
          tone={current.tone}
          action={current.action}
          duration={current.duration}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
      <RToast.Viewport className={cx('fs-toast-viewport', className)} style={style} />
    </RToast.Provider>
  );
}
