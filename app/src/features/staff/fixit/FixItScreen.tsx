/** Fix-it guide as a screen (`/fix/:topic`), e.g. from Me when notifications are blocked. */
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ScreenHeader } from '../shell/ScreenHeader';
import { FixItGuide, type FixItTopic } from './FixItGuide';

const TOPICS: readonly FixItTopic[] = ['location', 'precise', 'camera', 'notifications'];

export function FixItScreen() {
  const { t } = useTranslation();
  const { topic } = useParams();
  const valid = TOPICS.find((x) => x === topic) ?? 'location';
  return (
    <>
      <ScreenHeader
        as="quiet"
        title={t('staff:screens.fixit')}
        back={valid === 'notifications' ? '/me' : '/'}
      />
      <main id="main" className="staff-main">
        <FixItGuide topic={valid} headingLevel={1} />
      </main>
    </>
  );
}
