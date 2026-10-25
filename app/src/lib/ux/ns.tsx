import type { ReactNode } from 'react';
import { WithNamespaces } from '../../app/i18n';

const UX = ['ux'] as const;

/** The guidance copy is its own catalog, loaded the first time something here renders. */
export function WithUx({ children }: { children: ReactNode }) {
  return <WithNamespaces ns={UX}>{children}</WithNamespaces>;
}
