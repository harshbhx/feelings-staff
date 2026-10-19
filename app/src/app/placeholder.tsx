/** Placeholder screen used by route stubs until the owning package builds the real screen (WP-1). */
import { useTranslation } from 'react-i18next';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-[30rem] p-6">
      <h1>{t(titleKey)}</h1>
      <p>{t('common:states.comingSoon')}</p>
    </main>
  );
}
