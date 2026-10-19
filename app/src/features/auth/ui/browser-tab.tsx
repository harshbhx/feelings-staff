/**
 * Staff join and sign-in happen only inside the installed app (PRD 4.1.3, 4.2): the device key and
 * the session must live in the Home Screen app's storage, which iOS keeps apart from Safari. In a
 * browser tab these routes teach the install instead; `?allowBrowser=1` (tests, non-production
 * hosts only) lets a tab through.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { actsInstalled } from '../lib/flags';
import { Lead, TextLink, Title } from './bits';
import { InstallGuide } from './install-guide';
import { AuthScreen } from './layout';

export function StaffAppOnly({
  children,
  code = null,
}: {
  children: ReactNode;
  /** A join code to carry into the app (shown big with Copy). */
  code?: string | null;
}) {
  const { t } = useTranslation();
  if (actsInstalled()) return <>{children}</>;
  const link = code
    ? `${window.location.origin}/join/${code}`
    : `${window.location.origin}${window.location.pathname}`;
  return (
    <AuthScreen footer={<TextLink to="/auth/owner">{t('auth:common.ownerSignIn')}</TextLink>}>
      <Title>{t('auth:browserTab.title')}</Title>
      <Lead>{t('auth:browserTab.lead')}</Lead>
      <InstallGuide code={code} link={link} />
    </AuthScreen>
  );
}
