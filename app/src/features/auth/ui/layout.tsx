/**
 * Page frame for the auth screens: phone-first single column (max 30rem), the app mark at the top,
 * content, then a hairline footer for the small links. From 48rem the column sits in a hairline
 * card with more air above it (owner sign-in at 1280 px).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The app icon as on the home screen: the bindi on white (PRD 11.2, 12.9). Decorative. */
export function AppMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16 rounded-[22%]' : 'size-12 rounded-[22%]';
  const dot = size === 'lg' ? 'size-[38px]' : 'size-[28px]';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-white shadow-sm ${box}`}
    >
      <span className={`rounded-full bg-sindoor ${dot}`} />
    </span>
  );
}

export function AuthScreen({
  children,
  footer,
  busy = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-page text-text-body">
      <main
        aria-busy={busy || undefined}
        className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:min-h-0 md:pt-16"
      >
        <div className="flex flex-1 flex-col md:flex-none md:rounded-lg md:bg-bg md:px-8 md:pt-8 md:pb-6">
          <header className="mb-8 flex items-center gap-3">
            <AppMark />
            <span className="font-semibold text-text">{t('common:app.name')}</span>
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
          {footer ? (
            <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-4 border-t border-border pt-4">
              {footer}
            </footer>
          ) : null}
        </div>
      </main>
    </div>
  );
}
