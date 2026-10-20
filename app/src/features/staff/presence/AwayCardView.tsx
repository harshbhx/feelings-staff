/**
 * The away card on Today (PRD 4.18.4, S-24.2 and S-24.3): "You're out since 15:30 · Lunch outside"
 * after Step out, or "Urmi marked you away since 15:00" after a roll-call Not here, with one note
 * for the owner. **I'm back** sits in the action bar as the one sindoor button while the person is
 * out (`useImBack`). Only times, minutes and the chosen reason; never credits or rupees.
 */
import { Badge, Button, Icon } from '@fs/ui';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../lib/format';
import type { AwayCard as Card } from './presence-model';

const AwayNoteSheet = lazy(() =>
  import('./AwayNoteSheet').then((m) => ({ default: m.AwayNoteSheet })),
);

export function AwayCard({ card }: { card: Card }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const [noteOpen, setNoteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  if (noteOpen && !mounted) setMounted(true);
  const away = card.away;
  const time = fmt.clock(away.startTs);
  return (
    <section
      aria-labelledby="today-away"
      className="staff-card staff-card--soft flex flex-col gap-3"
      data-testid="presence-away"
    >
      <div className="flex gap-3">
        <Icon name="sign-out" className="mt-1 size-5 shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="today-away" className="tabular text-lg font-bold text-text">
            {card.kind === 'marked'
              ? t('staff:presence.card.marked', { name: card.by, time })
              : t('staff:presence.card.stepped', { time })}
          </h2>
          <p className="text-sm text-text-muted">
            {card.kind === 'marked'
              ? t('staff:presence.card.markedHint')
              : t('staff:presence.card.steppedHint')}
          </p>
          {away.reason ? (
            <div>
              <Badge tone="neutral" icon="sign-out">
                {t(`staff:presence.reason.${away.reason}`)}
              </Badge>
            </div>
          ) : null}
        </div>
      </div>
      {away.staffNote ? (
        <p className="border-border-strong border-l-2 pl-3 text-text-body">
          {t('staff:presence.card.yourNote', { note: away.staffNote })}
        </p>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon="pencil-simple"
            onClick={() => setNoteOpen(true)}
          >
            {t('staff:presence.card.addNote')}
          </Button>
        </div>
      )}
      {mounted ? (
        <Suspense fallback={null}>
          <AwayNoteSheet awayId={away.id} open={noteOpen} onOpenChange={setNoteOpen} />
        </Suspense>
      ) : null}
    </section>
  );
}
