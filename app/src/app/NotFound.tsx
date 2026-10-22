/**
 * Unknown client route: a warm, short page with one way back (staff Today, owner Today, or Sign in
 * when nobody is signed in). It is its own chunk (the staff entry has no room for it) and loads its
 * copy from the lazy `pages` catalog. The home target follows the build (staff / owner / combined)
 * and the signed-in role.
 */
import { Bindi, Button } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useMe } from '../api/hooks';
import { OWNER_ONLY, STAFF_ONLY } from '../lib/surface';
import { homeFor } from './guards';
import { WithNamespaces } from './i18n';

/** Where "back" goes: the role's Today when signed in, otherwise the build's sign-in. */
export function notFoundTarget(
  role: Parameters<typeof homeFor>[0] | null,
  pathname: string,
): { to: string; signedIn: boolean } {
  if (role) return { to: OWNER_ONLY ? '/o/today' : homeFor(role), signedIn: true };
  if (OWNER_ONLY) return { to: '/auth/owner', signedIn: false };
  if (STAFF_ONLY) return { to: '/signin', signedIn: false };
  const owner = pathname === '/o' || pathname.startsWith('/o/');
  return { to: owner ? '/auth/owner' : '/signin', signedIn: false };
}

function NotFoundScreen() {
  const { t } = useTranslation('pages');
  const me = useMe();
  const { pathname } = useLocation();
  const target = notFoundTarget(me.data?.user.role ?? null, pathname);
  return (
    <main
      className="mx-auto grid min-h-dvh max-w-sm content-center gap-3 p-6 sm:justify-items-center sm:text-center"
      data-testid="not-found"
    >
      <h1 className="text-2xl font-extrabold text-text">
        {t('notFound.title')}
        <Bindi size="heading" />
      </h1>
      <p className="text-text-body">{t('notFound.body')}</p>
      <div>
        {me.isPending ? null : (
          <Button variant="primary" asChild data-testid="not-found-home">
            <Link to={target.to} replace>
              {target.signedIn ? t('notFound.home') : t('notFound.signIn')}
            </Link>
          </Button>
        )}
      </div>
    </main>
  );
}

export function Component() {
  return (
    <WithNamespaces ns={['pages']}>
      <NotFoundScreen />
    </WithNamespaces>
  );
}
