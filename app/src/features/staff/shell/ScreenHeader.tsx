/**
 * The iOS navigation bar (PRD 12.5): the bar holds back, the inbox bell and the shell banners
 * (offline, queued punches). A tab's root screen shows its title as the large title on the page,
 * and the bar's small centred title fades in once the large one has scrolled under it. A
 * sub-screen (with `back`) carries its h1 in the bar, centred. The bar is clear at the top of the
 * page and turns into the material with a hairline once content runs under it. Today's is the brand
 * bar: the logo at the start, the date as a quiet label before the bell.
 */
import { IconButton, Logo } from '@fs/ui';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LOGO_MASK } from '../../../lib/brand';
import { useUnderBar } from '../../../lib/use-under-bar';
import { InboxBell } from '../../inbox';
import { ShellBanners } from './ShellBanners';

export interface ScreenHeaderProps {
  title: ReactNode;
  /**
   * `h1` (default): the screen's one h1 (the large title on a tab's root, the bar title on a
   * sub-screen). `quiet`: a small label (a screen whose h1 is in the content). `brand`: the logo,
   * then the title as a quiet label (Today, whose h1 is the greeting).
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
  const mark = useRef<HTMLDivElement>(null);
  const under = useUnderBar(mark);
  const large = as === 'h1' && !back;
  return (
    <>
      <header className="staff-header" data-under={under ? '' : undefined}>
        <div className="staff-header__row">
          {back ? (
            <IconButton
              icon="caret-left"
              label={t('common:actions.back')}
              onClick={() => navigate(back)}
              className="fs-bar-btn"
            />
          ) : null}
          {as === 'brand' ? (
            <Logo
              name={t('common:app.shortName')}
              size="sm"
              mask={LOGO_MASK}
              className="staff-header__logo"
            />
          ) : null}
          {as === 'h1' && !large ? (
            <h1 className="staff-header__title">{title}</h1>
          ) : (
            <p
              className="staff-header__title"
              data-quiet={as === 'h1' ? undefined : ''}
              aria-hidden={large ? 'true' : undefined}
            >
              {title}
            </p>
          )}
          <InboxBell />
        </div>
        <ShellBanners dataAt={dataAt} />
      </header>
      <div ref={mark} className="staff-large-title">
        {large ? <h1 className="fs-large-title">{title}</h1> : null}
      </div>
    </>
  );
}
