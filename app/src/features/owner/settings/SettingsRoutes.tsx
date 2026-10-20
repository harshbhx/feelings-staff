/**
 * Settings (PRD 4.17, 5.2, O-16, O-18): `/o/settings` lists every section with one line on what it
 * holds; `/o/settings/<section>` opens a focused page. Rule sections are field lists (SettingsForm);
 * Salon, Location and door, Shifts, Holidays, People, Security and the Audit log have their own pages.
 */
import { Icon, List, ListRow } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link, Route, Routes, useParams } from 'react-router';
import { useSettings } from '../api/settings';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { useOwnerTitle } from '../shell/chrome';
import { AuditScreen } from './AuditScreen';
import { HolidaysSection } from './HolidaysSection';
import { LocationSection } from './LocationSection';
import { PeopleSection } from './PeopleSection';
import { PresenceSection } from './PresenceSection';
import { PrivacyNote, SalonSection } from './SalonSection';
import { SecurityScreen } from './SecurityScreen';
import { SettingsForm } from './SettingsForm';
import { ShiftsSection } from './ShiftsSection';
import { SECTIONS, sectionById } from './sections';

export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsIndex />} />
      <Route path=":section" element={<SectionPage />} />
    </Routes>
  );
}

function SettingsIndex() {
  const { t } = useTranslation();
  useOwnerTitle(null);
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-4">
      <List>
        {SECTIONS.map((s) => (
          <ListRow
            key={s.id}
            asChild
            leading={
              <span className="grid size-10 place-items-center rounded-full bg-bg-tint text-maroon-800">
                <Icon name={s.icon} className="size-5" />
              </span>
            }
            title={t(`owner:settings.sections.${s.id}.title`)}
            subtitle={t(`owner:settings.sections.${s.id}.hint`)}
          >
            <Link to={`/o/settings/${s.id}`} />
          </ListRow>
        ))}
      </List>
    </div>
  );
}

function SectionPage() {
  const { t } = useTranslation();
  const { section } = useParams();
  const def = sectionById(section);
  useOwnerTitle(def ? t(`owner:settings.sections.${def.id}.title`) : null, '/o/settings');
  if (!def) return <Empty>{t('owner:errors.notFound')}</Empty>;
  switch (def.id) {
    case 'security':
      return <SecurityScreen />;
    case 'audit':
      return <AuditScreen />;
    case 'location':
      return <LocationSection />;
    case 'shifts':
      return <ShiftsSection />;
    case 'holidays':
      return <HolidaysSection />;
    case 'people':
      return <PeopleSection />;
    case 'presence':
      return <PresenceSection />;
    default:
      return <WithSettings id={def.id} />;
  }
}

function WithSettings({ id }: { id: string }) {
  const settings = useSettings();
  const def = sectionById(id);
  return (
    <QueryView query={settings} skeleton={<RowsSkeleton rows={6} />}>
      {(view) =>
        id === 'salon' ? (
          <SalonSection view={view} />
        ) : (
          <div className="grid gap-8">
            {id === 'privacy' ? <PrivacyNote view={view} /> : null}
            {def?.fields ? <SettingsForm view={view} fields={def.fields} /> : null}
          </div>
        )
      }
    </QueryView>
  );
}
