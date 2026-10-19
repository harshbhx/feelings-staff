/** Providers shared by every route (WP-1). */
import type { ReactNode } from 'react';
import { ApiProvider } from '../api/provider';
import { I18nProvider } from './i18n';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ApiProvider>
      <I18nProvider>{children}</I18nProvider>
    </ApiProvider>
  );
}
