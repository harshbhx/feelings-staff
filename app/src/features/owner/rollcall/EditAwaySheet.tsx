/**
 * Edit one away interval (PRD 4.18.5, 4.19.5, O-30.4 and O-30.10): start, end, reason and how it
 * counts (away, work, ignored), with a required reason for the change. The server keeps the old and
 * new values in the audit log and the minutes and ledger entry follow. Owner and managers with
 * `rollcall`; until the day is locked.
 */
import type { AwayPatch, AwayReason } from '@fs/contracts';
import { Button, ChipGroup, Field, Sheet, Textarea, TimeField, useToast } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { useAwayPatch } from '../api/presence';
import { useErrorText } from '../components/states';
import { clock, dayLabel } from '../lib/format';
import { AWAY_REASONS, istTs } from './rollcall-model';

type Counted = 'confirmed' | 'work' | 'ignored';
const COUNTED: readonly Counted[] = ['confirmed', 'work', 'ignored'];

export interface AwayToEdit {
  id: string;
  name: string;
  workDate: string;
  startTs: number;
  endTs: number | null;
  reason: AwayReason | null;
  /** `pending` (a step-out waiting for a decision) has no "how it counts" yet. */
  state: 'open' | 'pending' | Counted;
}

/** The PATCH body: only what changed, plus the reason for the change. */
export function awayPatch(
  away: AwayToEdit,
  draft: { start: string; end: string; reason: AwayReason | null; state: Counted | null },
  editReason: string,
): AwayPatch | 'endBeforeStart' | 'badTime' | 'endMissing' {
  const startTs = istTs(away.workDate, draft.start);
  const endTs = draft.end === '' ? null : istTs(away.workDate, draft.end);
  if (startTs === null || (draft.end !== '' && endTs === null)) return 'badTime';
  // A closed interval keeps an end time: clearing it is not something the API can express.
  if (draft.end === '' && away.endTs !== null) return 'endMissing';
  if (endTs !== null && endTs <= startTs) return 'endBeforeStart';
  const patch: AwayPatch = { editReason };
  if (draft.start !== clock(away.startTs)) patch.startTs = startTs;
  if (endTs !== null && (away.endTs === null || draft.end !== clock(away.endTs)))
    patch.endTs = endTs;
  if (draft.reason !== null && draft.reason !== away.reason) patch.reason = draft.reason;
  if (draft.state !== null && draft.state !== away.state) patch.state = draft.state;
  return patch;
}

export function EditAwaySheet({
  away,
  busy = false,
  trigger,
}: {
  away: AwayToEdit;
  busy?: boolean;
  trigger?: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const save = useAwayPatch();
  const first = away.name.split(' ')[0] ?? away.name;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(clock(away.startTs));
  const [end, setEnd] = useState(away.endTs === null ? '' : clock(away.endTs));
  const [reason, setReason] = useState<AwayReason | null>(away.reason);
  const [state, setState] = useState<Counted | null>(
    away.state === 'pending' || away.state === 'open' ? null : away.state,
  );
  const [why, setWhy] = useState('');
  const [problem, setProblem] = useState<
    'why' | 'endBeforeStart' | 'badTime' | 'endMissing' | null
  >(null);

  const reset = () => {
    setStart(clock(away.startTs));
    setEnd(away.endTs === null ? '' : clock(away.endTs));
    setReason(away.reason);
    setState(away.state === 'pending' || away.state === 'open' ? null : away.state);
    setWhy('');
    setProblem(null);
  };
  const onOpenChange = (o: boolean) => {
    // Every way out (Cancel, Esc, overlay) drops the draft; opening starts from the fresh values.
    reset();
    setOpen(o);
  };

  const submit = () => {
    if (!why.trim()) return setProblem('why');
    const patch = awayPatch(away, { start, end, reason, state }, why.trim());
    if (typeof patch === 'string') return setProblem(patch);
    save.mutate(
      { id: away.id, patch },
      {
        onSuccess: () => {
          setOpen(false);
          setWhy('');
          toast({ title: t('owner:presence.edit.saved', { name: first }), tone: 'success' });
        },
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('owner:presence.edit.title', { name: first })}
      description={dayLabel(away.workDate)}
      trigger={
        trigger ?? (
          <Button size="sm" variant="ghost" icon="pencil-simple" disabled={busy}>
            {t('owner:presence.edit.open')}
          </Button>
        )
      }
    >
      <form
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('owner:presence.edit.start')}
            error={problem === 'badTime' ? t('owner:presence.edit.badTime') : undefined}
          >
            <TimeField
              value={start}
              onValueChange={(v) => {
                setStart(v);
                setProblem(null);
              }}
            />
          </Field>
          <Field
            label={t('owner:presence.edit.end')}
            hint={away.endTs === null ? t('owner:presence.edit.endOpen') : undefined}
            error={
              problem === 'endBeforeStart'
                ? t('owner:presence.edit.endBeforeStart')
                : problem === 'endMissing'
                  ? t('owner:presence.edit.endMissing')
                  : undefined
            }
          >
            <TimeField
              value={end}
              onValueChange={(v) => {
                setEnd(v);
                setProblem(null);
              }}
            />
          </Field>
        </div>
        <ChipGroup
          type="radio"
          legend={t('owner:presence.edit.reason')}
          value={reason ?? ''}
          onValueChange={(v) => setReason(v as AwayReason)}
          options={AWAY_REASONS.map((r) => ({
            value: r,
            label: t(`owner:presence.reason.${r}`),
          }))}
        />
        <ChipGroup
          type="radio"
          legend={t('owner:presence.edit.countsAs')}
          hint={t('owner:presence.edit.countsAsHint')}
          value={state ?? ''}
          onValueChange={(v) => setState(v as Counted)}
          options={COUNTED.map((s) => ({
            value: s,
            label: t(`owner:presence.edit.state.${s}`),
          }))}
        />
        <Field
          label={t('owner:presence.edit.why')}
          hint={t('owner:presence.edit.whyHint')}
          error={problem === 'why' ? t('owner:presence.edit.whyMissing') : undefined}
          required
        >
          <Textarea
            rows={2}
            maxLength={300}
            value={why}
            onChange={(e) => {
              setWhy(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            icon="check-circle"
            loading={save.isPending}
            loadingLabel={t('owner:common.saving')}
          >
            {t('owner:presence.edit.save')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
