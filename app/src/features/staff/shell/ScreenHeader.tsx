/**
 * Sticky glass header (PRD 12.5): screen title, the inbox bell (WP-8), and the shell banners
 * (offline, queued punches) right under it. Every staff screen renders one.
 */
import { IconButton } from '@fs/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { InboxBell } from '../../inbox';
import { ShellBanners } from './ShellBanners';

export interface ScreenHeaderProps {
  title: ReactNode;
  /**
   * `h1` (default): the header carries the screen's one h1. `quiet`: a small label (Today, whose
   * h1 is the greeting in the content).
   */
  as?: 'h1' | 'quiet';
  /** Path for the back button (sub-screens such as a day or a form). */
  back?: string | undefined;
  /** When the data on screen was fetched, for "Showing what we had at 10:05". */
  dataAt?: number | undefined;
}

export function ScreenHeader({ title, as = 'h1', back, dataAt }: ScreenHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="staff-header">
      <div className="staff-header__row" data-back={back ? '' : undefined}>
        {back ? (
          <IconButton
            icon="caret-left"
            label={t('common:actions.back')}
            onClick={() => navigate(back)}
          />
        ) : null}
        {as === 'h1' ? (
          <h1 className="staff-header__title">{title}</h1>
        ) : (
          <p className="staff-header__title staff-header__title--quiet">{title}</p>
        )}
        <InboxBell />
      </div>
      <ShellBanners dataAt={dataAt} />
    </header>
  );
}
