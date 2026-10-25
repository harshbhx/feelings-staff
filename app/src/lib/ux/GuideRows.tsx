/** The two rows that reopen a guide: "Replay the tour" (Me, More) and "Add to Home Screen" (More). */
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
      onClick={() => openGuide('tour')}
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

function InstallRowView() {
  const { t } = useTranslation('ux');
  return (
    <ListRow
      leading={
        <span className="fs-tile" data-tone="bridal">
          <Icon name="plus-square" />
        </span>
      }
      title={t('install.row')}
      subtitle={t('install.rowHint')}
      onClick={() => openGuide('install')}
    />
  );
}

export function InstallRow() {
  return (
    <WithUx>
      <InstallRowView />
    </WithUx>
  );
}
