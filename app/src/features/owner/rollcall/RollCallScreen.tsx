/**
 * Roll-call (PRD 4.18.3, 5.2 `/o/roll-call/:id`, O-30): everyone checked in at the slot time,
 * each on Here; tap the people who are not at the salon; **Done** saves (the one sindoor button).
 * Not here starts an away interval at the slot time that counts at once; someone already away
 * stays Not here (the interval continues) until the owner taps Here. A done roll-call opens the
 * same way and Done saves the edit until the day is locked. `/o/roll-call` lists today's slots.
 */
import type { RollCallPerson, RollCallSlot, RollCallView } from '@fs/contracts';
import { Avatar, Badge, Button, Icon, List, ListRow, StatusChip, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useIsOwner, useRollCall, useRollCallDay, useRollCallSubmit } from '../api/presence';
import { Meta } from '../components/layout';
import { Empty, QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { clock } from '../lib/format';
import { useOwnerTitle } from '../shell/chrome';
import {
  canOpenSlot,
  countMarks,
  initialMarks,
  type Mark,
  type RowHint,
  rowHints,
  submitBody,
  toggleMark,
} from './rollcall-model';

// ---- /o/roll-call: today's slots ------------------------------------------------------------

export function RollCallListScreen() {
  const { t } = useTranslation();
  const day = useRollCallDay();
  const isOwner = useIsOwner();
  useOwnerTitle(t('owner:presence.list.title'));
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-4">
      <Meta>{t('owner:presence.list.hint')}</Meta>
      <QueryView
        query={day}
        skeleton={<RowsSkeleton rows={3} />}
        isEmpty={(d) => d.slots.length === 0}
        empty={
          <Empty
            action={
              isOwner ? (
                <Button asChild size="sm" variant="secondary">
                  <Link to="/o/settings/presence">{t('owner:presence.list.settings')}</Link>
                </Button>
              ) : undefined
            }
          >
            {t('owner:presence.list.empty')}
          </Empty>
        }
      >
        {(d) => (
          <List framed>
            {d.slots.map((s) => (
              <SlotRow key={s.id} slot={s} />
            ))}
          </List>
        )}
      </QueryView>
      {isOwner ? (
        <p>
          <Link
            to="/o/settings/presence"
            className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline"
          >
            {t('owner:presence.list.settings')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function slotChip(slot: RollCallSlot, t: ReturnType<typeof useTranslation>['t']) {
  switch (slot.status) {
    case 'done':
      return <StatusChip status="present" label={t('owner:presence.slot.done')} />;
    case 'open':
      return (
        <Badge tone="info" icon="users">
          {t('owner:presence.slot.open')}
        </Badge>
      );
    case 'missed':
      return <StatusChip status="flag" label={t('owner:presence.slot.missed')} />;
    case 'upcoming':
      return (
        <Badge tone="neutral" icon="clock">
          {t('owner:presence.slot.upcoming')}
        </Badge>
      );
  }
}

function SlotRow({ slot }: { slot: RollCallSlot }) {
  const { t } = useTranslation();
  const title = (
    <span className="tabular-nums">{t('owner:presence.view.title', { time: slot.slotTime })}</span>
  );
  const subtitle =
    slot.status === 'done' && slot.submittedBy
      ? t('owner:presence.slot.doneBy', { name: slot.submittedBy.name.split(' ')[0] })
      : slot.status === 'upcoming'
        ? t('owner:presence.slot.opensAt', { time: slot.slotTime })
        : undefined;
  const leading = <Icon name="users" className="size-5 text-text-muted" />;
  if (!canOpenSlot(slot))
    return (
      <ListRow leading={leading} title={title} subtitle={subtitle} trailing={slotChip(slot, t)} />
    );
  return (
    <ListRow
      asChild
      leading={leading}
      title={title}
      subtitle={subtitle}
      trailing={slotChip(slot, t)}
    >
      <Link to={`/o/roll-call/${slot.id}`} />
    </ListRow>
  );
}

// ---- /o/roll-call/:id: mark who is not here ----------------------------------------------------

export function RollCallViewScreen() {
  const { id = '' } = useParams();
  const query = useRollCall(id);
  const day = useRollCallDay();
  const slot = day.data?.slots.find((s) => s.id === id) ?? null;
  return (
    <QueryView query={query} skeleton={<RowsSkeleton rows={8} />}>
      {(view) => <Marking key={view.id} view={view} slot={slot} />}
    </QueryView>
  );
}

function Marking({ view, slot }: { view: RollCallView; slot: RollCallSlot | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const submit = useRollCallSubmit(view.id);
  const [marks, setMarks] = useState<Record<string, Mark>>(() => initialMarks(view.people));
  const counts = countMarks(view.people, marks);
  const time = view.slotTime;
  useOwnerTitle(t('owner:presence.view.title', { time }), '/o/today');

  if (view.people.length === 0) return <Empty>{t('owner:presence.view.empty')}</Empty>;

  const done = () => {
    // The hook adds one idempotency key per Done (a repeat tap reuses it).
    const { notHere, here } = submitBody(view.people, marks, '');
    submit.mutate(
      { notHere, here },
      {
        onSuccess: () => {
          toast({
            title: t('owner:presence.view.saved', {
              time,
              here: counts.here,
              notHere: counts.notHere,
            }),
            tone: 'success',
          });
          navigate('/o/today');
        },
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );
  };

  const editing = slot?.status === 'done';
  const savedBy = slot?.submittedBy?.name.split(' ')[0];

  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-5 pb-24 xl:pb-20">
      <div className="grid gap-1">
        <p className="font-extrabold text-text text-xl tracking-display">
          {t('owner:presence.view.intro')}
        </p>
        <Meta>
          {editing
            ? savedBy
              ? t('owner:presence.view.edit', { name: savedBy })
              : t('owner:presence.view.editNoName')
            : t('owner:presence.view.how')}
        </Meta>
      </div>

      <fieldset className="grid">
        <legend className="sr-only">{t('owner:presence.view.legend', { time })}</legend>
        <ul className="fs-list" data-framed="">
          {view.people.map((p) => (
            <PersonRow
              key={p.userId}
              person={p}
              mark={marks[p.userId] ?? 'here'}
              onToggle={() => setMarks((m) => toggleMark(m, p.userId))}
            />
          ))}
        </ul>
      </fieldset>

      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-20 border-border border-t bg-(--bg-glass) backdrop-blur-[10px] xl:bottom-0 xl:left-(--owner-rail-w)">
        <section
          className="mx-auto flex max-w-(--container-page) flex-wrap items-center gap-3 px-(--gutter) py-3"
          aria-label={t('owner:presence.view.title', { time })}
        >
          <p
            className="flex-1 font-bold text-text tabular-nums"
            aria-live="polite"
            data-testid="roll-call-summary"
          >
            {t('owner:presence.view.summary', { here: counts.here, notHere: counts.notHere })}
          </p>
          <Button
            variant="primary"
            icon="check-circle"
            loading={submit.isPending}
            loadingLabel={t('owner:common.saving')}
            onClick={done}
          >
            {t('owner:presence.view.done')}
          </Button>
        </section>
      </div>
    </div>
  );
}

function hintText(h: RowHint, t: ReturnType<typeof useTranslation>['t']): string {
  switch (h.kind) {
    case 'away_since':
      return t('owner:presence.hint.awaySince', { time: clock(h.since) });
    case 'stepped_out':
      return h.detail
        ? t('owner:presence.hint.steppedOutDetail', { detail: h.detail })
        : h.since !== null
          ? t('owner:presence.hint.steppedOutSince', { time: clock(h.since) })
          : t('owner:presence.hint.steppedOut');
    case 'seems_away':
      return t('owner:presence.hint.seemsAway');
    case 'on_break':
      return t('owner:presence.hint.onBreak');
  }
}

const HINT_ICON = {
  away_since: 'sign-out',
  stepped_out: 'sign-out',
  seems_away: 'map-pin',
  on_break: 'coffee',
} as const;

/**
 * One person: the whole row is the target (56 px+). A native checkbox carries "Not here" for
 * screen readers and the keyboard; the status on the right says Here or Not here in words.
 */
function PersonRow({
  person,
  mark,
  onToggle,
}: {
  person: RollCallPerson;
  mark: Mark;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const notHere = mark === 'not_here';
  const hints = rowHints(person);
  return (
    <li className="fs-list__item">
      <label
        className="fs-row cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--focus) has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-solid"
        data-interactive=""
        data-testid="roll-call-row"
        data-mark={mark}
      >
        <input type="checkbox" className="sr-only" checked={notHere} onChange={onToggle} />
        <span className="fs-row__leading">
          <Avatar name={person.name} />
        </span>
        <span className="fs-row__text">
          <span className="fs-row__title">
            <span className="sr-only">{t('owner:presence.view.notHereFor')} </span>
            {person.name}
          </span>
          <span className="fs-row__subtitle tabular-nums">
            {t('owner:presence.view.inAt', { time: clock(person.inAt) })}
          </span>
          {hints.length > 0 ? (
            <span className="fs-row__meta">
              {hints.map((h) => (
                <Badge
                  key={h.kind}
                  tone={h.kind === 'seems_away' ? 'warning' : 'neutral'}
                  icon={HINT_ICON[h.kind]}
                >
                  {hintText(h, t)}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
        <span className="fs-row__trailing" aria-hidden="true">
          {notHere ? (
            <StatusChip status="absent" label={t('owner:presence.view.notHere')} />
          ) : (
            <StatusChip status="present" label={t('owner:presence.view.here')} />
          )}
        </span>
      </label>
    </li>
  );
}
