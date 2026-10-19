/**
 * The presence notice (PRD 4.18.1, 10.6; S-24.1): shown once per person when presence tracking is
 * on, in plain words and their language, after the privacy notice. **OK, I understand** stores a
 * `presence_checks` consent. **Not now** is fine: the person still works, checks in and can use
 * Step out; the notice comes back at the next app open. Its own chunk.
 */
import { Button, Sheet, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { useOwnerName } from '../api';
import { usePresenceConsent } from './api';

export function PresenceConsentSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const owner = useOwnerName();
  const toast = useToast();
  const consent = usePresenceConsent();
  const lang = i18n.language === 'gu' ? 'gu' : 'en';
  const paragraphs = ['p1', 'p2', 'p3', 'p4'] as const;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('staff:presence.consent.title')}>
      <div className="flex flex-col gap-4" data-testid="presence-consent">
        {paragraphs.map((p) => (
          <p key={p} className="text-text-body">
            {t(`staff:presence.consent.${p}`, { owner })}
          </p>
        ))}
        <p className="font-bold text-text">{t('staff:presence.consent.nothingCut')}</p>
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            block
            loading={consent.isPending}
            onClick={() =>
              consent.mutate(lang, {
                onSuccess: () => onOpenChange(false),
                onError: () => toast({ tone: 'error', title: t('errors:generic') }),
              })
            }
          >
            {t('staff:presence.consent.ok')}
          </Button>
          <Button variant="ghost" block onClick={() => onOpenChange(false)}>
            {t('staff:presence.consent.later')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
