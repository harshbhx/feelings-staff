import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useState,
} from 'react';

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

// Radix Toast lives in its own chunk; it loads right after first paint, not with the entry.
const ToastLayer = lazy(() => import('./ToastLayer'));

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
  const [current, setCurrent] = useState<(ToastInput & { key: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback<ShowToast>((toast) => {
    setCurrent({ ...toast, key: Date.now() });
    setOpen(true);
  }, []);
  return (
    <>
      <ToastContext.Provider value={show}>{children}</ToastContext.Provider>
      <Suspense fallback={null}>
        <ToastLayer
          current={current}
          open={open}
          onOpenChange={setOpen}
          bottomOffset={bottomOffset}
          className={className}
        />
      </Suspense>
    </>
  );
}
