/** The row that replays the tour, in Me (staff) and More (owner). */
import { Icon, ListRow } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { openGuide } from './bus';
import { WithUx } from './ns';

function TourRowView({ tile }: { tile: boolean }) {
  const { t } = useTranslation('ux');
  return (
    <ListRow
      leading={
        tile ? (
          <span className="fs-tile" data-tone="academy">
            <Icon name="navigation" />
          </span>
        ) : undefined
      }
      title={t('tour.replay')}
      subtitle={t('tour.replayHint')}
      onClick={() => openGuide()}
    />
  );
}

export function TourRow({ tile = false }: { tile?: boolean }) {
  return (
    <WithUx>
      <TourRowView tile={tile} />
    </WithUx>
  );
}
