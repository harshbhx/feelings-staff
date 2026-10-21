/**
 * Sticky glass header (PRD 12.5): screen title, the inbox bell (WP-8), and the shell banners
 * (offline, queued punches) right under it. Every staff screen renders one. Today's is the brand
 * header: the logo at the start, the date as a quiet label before the bell, on the warm band.
 */
import { IconButton, Logo } from '@fs/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { InboxBell } from '../../inbox';
import { ShellBanners } from './ShellBanners';

export interface ScreenHeaderProps {
  title: ReactNode;
  /**
   * `h1` (default): the header carries the screen's one h1. `quiet`: a small label (a screen whose
   * h1 is in the content). `brand`: the logo, then the title as a quiet label (Today, whose h1 is
   * the greeting).
   */
  as?: 'h1' | 'quiet' | 'brand';
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
        {as === 'brand' ? (
          <Logo name={t('common:app.shortName')} size="sm" className="staff-header__logo" />
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
