/**
 * "Away now" on Today (PRD 4.18.5): who is away right now, since when and why, from a roll-call Not
 * here or a step-out, with Edit times. Owner only (the list is owner-only in 9.4); it hides when
 * nobody is away or the presence API is not there yet.
 */
import { Avatar, List, ListRow } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { useAwayNow, useIsOwner } from '../api/presence';
import { NoBreakParts, Section, WRAP_ROW } from '../components/layout';
import { clock } from '../lib/format';
import { EditAwaySheet } from './EditAwaySheet';

export function AwayNowSection() {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const query = useAwayNow(isOwner);
  const list = query.data ?? [];
  if (!isOwner || list.length === 0) return null;
  return (
    <Section title={t('owner:presence.awayNow.title')} count={list.length}>
      <List data-testid="today-away-now">
        {list.map((a) => {
          const time = clock(a.startTs);
          const line =
            a.source === 'roll_call'
              ? t('owner:presence.awayNow.marked', {
                  time,
                  name: a.openedBy.name.split(' ')[0],
                })
              : t('owner:presence.awayNow.since', { time });
          return (
            <ListRow
              key={a.id}
              className={WRAP_ROW}
              leading={<Avatar name={a.user.name} />}
              title={a.user.name}
              subtitle={
                // The reason is words in the quiet line, not a second chip (Fix 2).
                <span className="tabular-nums">
                  <NoBreakParts
                    parts={[line, a.reason ? t(`owner:presence.reason.${a.reason}`) : null]}
                  />
                </span>
              }
              trailing={
                <EditAwaySheet
                  away={{
                    id: a.id,
                    name: a.user.name,
                    workDate: a.workDate,
                    startTs: a.startTs,
                    endTs: a.endTs,
                    reason: a.reason,
                    state: a.state,
                  }}
                />
              }
            />
          );
        })}
      </List>
    </Section>
  );
}
