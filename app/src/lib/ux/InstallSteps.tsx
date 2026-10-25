/**
 * The iOS "Add to Home Screen" guide: three numbered steps, each with the glyph the person will
 * look for. Shared by the install sheet (owner, any phone browser tab) and the staff install gate.
 */
import { Bindi, Icon, type IconName } from '@fs/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './ux.css';

interface Step {
  key: 'iosShare' | 'iosAdd' | 'iosOpen';
  glyph: ReactNode;
}

const STEPS: readonly Step[] = [
  {
    key: 'iosShare',
    glyph: <Icon name={'export' satisfies IconName} className="ux-steps__icon" />,
  },
  {
    key: 'iosAdd',
    glyph: <Icon name={'plus-square' satisfies IconName} className="ux-steps__icon" />,
  },
  { key: 'iosOpen', glyph: <Bindi size="success" /> },
];

export function InstallSteps() {
  const { t } = useTranslation();
  return (
    <div className="ux-install">
      <div className="ux-safari" aria-hidden="true">
        <span className="ux-safari__url">{t('common:ux.install.mockSafari')}</span>
        <span className="ux-safari__share">
          <Icon name="export" className="ux-safari__icon" />
        </span>
      </div>
      <ol className="ux-steps" aria-label={t('common:ux.install.stepsLabel')}>
        {STEPS.map((s, i) => (
          <li key={s.key} className="ux-steps__item">
            <span className="ux-steps__glyph" aria-hidden="true">
              {s.glyph}
            </span>
            <span className="ux-steps__text">
              <span className="ux-steps__title">
                <span className="ux-steps__num" aria-hidden="true">
                  {i + 1}
                </span>
                {t(`common:ux.install.${s.key}`)}
              </span>
              <span className="ux-steps__hint">{t(`common:ux.install.${s.key}Hint`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
