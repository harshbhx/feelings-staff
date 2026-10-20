/**
 * The presence copy (sheets, away card, notice, history) is its own i18n catalog, loaded with the
 * screen that needs it so the staff app shell stays under its JS budget (PRD 11.10).
 */
import type { ComponentType } from 'react';
import { WithNamespaces } from '../../../app/i18n';

const PRESENCE_NS = ['presence'] as const;

export function withPresenceCopy<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  const Wrapped = (props: P) => (
    <WithNamespaces ns={PRESENCE_NS}>
      <Component {...props} />
    </WithNamespaces>
  );
  Wrapped.displayName = `WithPresenceCopy(${Component.displayName ?? Component.name})`;
  return Wrapped;
}
