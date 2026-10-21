/**
 * More (PRD 5.2): on phones the fifth tab holds everything that is not a tab, grouped as Money,
 * People and days, Salon, each row with a one-line hint. Managers see only what they may open
 * (PRD 10.2). On desktop the rail already lists every item, so this page is just a fallback there.
 * On phones the logo lives here (Today's header has it too): it closes the page with who is signed
 * in, as the rail's foot does on desktop.
 */
import { Avatar, Icon, List, ListRow, Logo } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMe } from '../../../api/hooks';
import { Section } from '../components/layout';
import { allowed, MORE, type NavItem } from '../shell/nav';

const GROUPS = ['money', 'people', 'salon'] as const;

export function MoreScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const items = MORE.filter((i) => allowed(i, me.data));
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8">
      {GROUPS.map((group) => {
        const rows = items.filter((i) => i.group === group);
        if (rows.length === 0) return null;
        return (
          <Section key={group} title={t(`owner:more.groups.${group}`)}>
            <List>
              {rows.map((item) => (
                <MoreRow key={item.key} item={item} />
              ))}
            </List>
          </Section>
        );
      })}
      <div className="grid gap-4 rounded-md border border-border bg-bg p-4 xl:hidden">
        <Logo name={t('common:app.shortName')} />
        {me.data ? (
          <div className="flex items-center gap-3">
            <Avatar name={me.data.user.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-bold text-sm text-text">{me.data.user.name}</p>
              <p className="truncate text-sm text-text-body">{me.data.org.name}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MoreRow({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <ListRow
      asChild
      leading={
        <span className="grid size-10 place-items-center rounded-full bg-bg-tint text-maroon-800">
          <Icon name={item.icon} className="size-5" />
        </span>
      }
      title={t(item.labelKey)}
      subtitle={item.hintKey ? t(item.hintKey) : undefined}
    >
      <Link to={item.to} />
    </ListRow>
  );
}
