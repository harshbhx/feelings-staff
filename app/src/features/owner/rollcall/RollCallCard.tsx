/**
 * The roll-call card on Today (PRD 4.18.3, N32, N33): when a roll-call is open it asks "Who's not
 * here?" and opens the view; when one was missed it says so ("Roll-call at 15:00 not done"); after
 * it is done, or before the next one, it is one quiet line. Only for the owner and managers with
 * `rollcall`. The button is sindoor only when nothing else on Today is (one per view).
 */
import type { TodayBoard } from '@fs/contracts';
import { Button, Icon } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCanRollCall } from '../api/presence';

type Slot = NonNullable<TodayBoard['rollCall']>;

export function RollCallCard({ slot, primary }: { slot: Slot | null; primary: boolean }) {
  const { t } = useTranslation();
  const allowed = useCanRollCall();
  if (!slot || !allowed) return null;
  const to = `/o/roll-call/${slot.id}`;
  const time = slot.slotTime;

  if (slot.status === 'open' || slot.status === 'missed') {
    const missed = slot.status === 'missed';
    return (
      <section
        aria-labelledby="today-roll-call"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border-strong bg-bg-soft px-4 py-3"
        data-testid="today-roll-call"
      >
        <Icon
          name={missed ? 'warning-circle' : 'users'}
          className={`size-6 shrink-0 ${missed ? 'text-accent' : 'text-on-tint'}`}
        />
        <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
          <h2 id="today-roll-call" className="font-bold text-text tabular-nums">
            {missed
              ? t('owner:presence.card.missed', { time })
              : t('owner:presence.card.open', { time })}
          </h2>
          <p className="text-sm text-text-body">
            {missed ? t('owner:presence.card.missedBody') : t('owner:presence.card.openBody')}
          </p>
        </div>
        <Button asChild variant={primary ? 'primary' : 'secondary'} size="sm" iconEnd="arrow-right">
          <Link to={to}>
            {missed ? t('owner:presence.card.doIt') : t('owner:presence.card.start')}
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-body"
      data-testid="today-roll-call"
    >
      <Icon
        name={slot.status === 'done' ? 'check-circle' : 'clock'}
        className={`size-5 shrink-0 ${slot.status === 'done' ? 'text-present' : 'text-text-muted'}`}
      />
      <span className="tabular-nums">
        {slot.status === 'done'
          ? t('owner:presence.card.done', { time })
          : t('owner:presence.card.upcoming', { time })}
      </span>
      <Link
        to="/o/roll-call"
        className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline"
      >
        {t('owner:presence.card.all')}
      </Link>
    </p>
  );
}
