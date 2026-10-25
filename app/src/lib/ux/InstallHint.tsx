/** On a computer: one slim line saying the app is for phones, with the link to copy. Never blocks. */
import { Button, Icon } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WithUx } from './ns';
import './ux.css';

function HintView() {
  const { t } = useTranslation('ux');
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="ux-hint" role="note">
      <Icon name="phone" className="ux-hint__icon" />
      <p className="ux-hint__text">{t('hint.text')}</p>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(window.location.origin)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? t('gate.copied') : t('hint.copy')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
        {t('hint.close')}
      </Button>
    </div>
  );
}

export function InstallHint() {
  return (
    <WithUx>
      <HintView />
    </WithUx>
  );
}
