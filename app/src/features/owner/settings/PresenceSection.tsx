/**
 * Settings -> Presence (PRD 4.17, 4.18, 4.19.5, O-30.10): on or off (owner PIN), one to four
 * roll-call times inside opening hours (a change applies from the next roll-call), the Step out
 * button, the optional quiet location check and its interval, and pausing during breaks. Who may do
 * a roll-call is a manager permission (Settings -> People). **Save** is the one sindoor action and
 * sends only what changed.
 */
import type { OrgSettingsPatch, PresenceSettings, SettingsView } from '@fs/contracts';
import { Button, Field, IconButton, Stepper, Switch, TimeField, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { usePatchSettings, useSettings } from '../api/settings';
import { Meta } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { checkRollCallTimes, nextTime } from '../rollcall/rollcall-model';

export function PresenceSection() {
  const settings = useSettings();
  return (
    <QueryView query={settings} skeleton={<RowsSkeleton rows={6} />}>
      {(view) => <PresenceForm view={view} />}
    </QueryView>
  );
}

/** Only the parts of presence that changed, as a settings patch (or null when nothing did). */
export function presencePatch(
  saved: PresenceSettings,
  draft: PresenceSettings,
): OrgSettingsPatch | null {
  const p: NonNullable<OrgSettingsPatch['presence']> = {};
  if (draft.enabled !== saved.enabled) p.enabled = draft.enabled;
  if (JSON.stringify(draft.rollCallTimes) !== JSON.stringify(saved.rollCallTimes))
    p.rollCallTimes = draft.rollCallTimes;
  if (draft.stepOut !== saved.stepOut) p.stepOut = draft.stepOut;
  if (draft.quietDuringBreaks !== saved.quietDuringBreaks)
    p.quietDuringBreaks = draft.quietDuringBreaks;
  const fg: { enabled?: boolean; intervalMin?: number } = {};
  if (draft.foreground.enabled !== saved.foreground.enabled) fg.enabled = draft.foreground.enabled;
  if (draft.foreground.intervalMin !== saved.foreground.intervalMin)
    fg.intervalMin = draft.foreground.intervalMin;
  if (Object.keys(fg).length > 0) p.foreground = fg;
  return Object.keys(p).length > 0 ? { presence: p } : null;
}

function PresenceForm({ view }: { view: SettingsView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const patch = usePatchSettings();
  const saved = view.settings.presence;
  const closing = view.settings.attendance.closingTime;
  const [draft, setDraft] = useState<PresenceSettings>(saved);
  // Bumped on save and undo so the time fields start again from the saved value.
  const [round, setRound] = useState(0);
  const set = (part: Partial<PresenceSettings>) => setDraft((d) => ({ ...d, ...part }));
  const times = draft.rollCallTimes;
  const problem = checkRollCallTimes(times, closing);
  const changes = presencePatch(saved, draft);
  const pin = draft.enabled !== saved.enabled;
  const reset = () => {
    setDraft(saved);
    setRound((n) => n + 1);
  };

  const save = () => {
    if (!changes || problem !== 'none') return;
    patch.mutate(
      { settings: changes },
      {
        onSuccess: (v) => {
          setDraft(v.settings.presence);
          setRound((n) => n + 1);
          toast({ title: t('owner:settings.saved') });
        },
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );
  };

  const setTime = (i: number, v: string) =>
    set({ rollCallTimes: times.map((x, j) => (j === i ? v : x)) });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-7"
    >
      <Meta>{t('owner:presence.settings.intro')}</Meta>

      <Switch
        label={t('owner:presence.settings.enabled.label')}
        description={
          draft.enabled
            ? t('owner:presence.settings.enabled.on')
            : t('owner:presence.settings.enabled.off')
        }
        checked={draft.enabled}
        onCheckedChange={(enabled) => set({ enabled })}
      />

      <fieldset className="grid gap-3" disabled={!draft.enabled}>
        <legend className="mb-1 font-bold text-text">
          {t('owner:presence.settings.times.legend')}
        </legend>
        <Meta>{t('owner:presence.settings.times.hint')}</Meta>
        <ol className="grid gap-3">
          {times.map((time, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the position is the identity (Roll-call 1, 2, 3)
            <li key={`${i}-${round}`} className="flex items-end gap-2">
              <Field
                label={t('owner:presence.settings.times.timeLabel', { n: i + 1 })}
                className="max-w-48 flex-1"
              >
                <TimeField value={time} onValueChange={(v) => setTime(i, v)} />
              </Field>
              {times.length > 1 ? (
                <IconButton
                  icon="trash"
                  label={t('owner:presence.settings.times.remove', { n: i + 1 })}
                  onClick={() => set({ rollCallTimes: times.filter((_, j) => j !== i) })}
                />
              ) : null}
            </li>
          ))}
        </ol>
        {problem !== 'none' ? (
          <p className="text-sm font-semibold text-absent" role="alert">
            {t(`owner:presence.settings.times.problems.${problem}`, { time: closing })}
          </p>
        ) : null}
        {nextTime(times, closing) !== null ? (
          <div>
            <Button
              size="sm"
              icon="plus"
              onClick={() => {
                const next = nextTime(times, closing);
                if (next) set({ rollCallTimes: [...times, next] });
              }}
            >
              {t('owner:presence.settings.times.add')}
            </Button>
          </div>
        ) : null}
        <Meta>{t('owner:presence.settings.who')}</Meta>
      </fieldset>

      <Switch
        label={t('owner:presence.settings.stepOut.label')}
        description={
          draft.stepOut
            ? t('owner:presence.settings.stepOut.on')
            : t('owner:presence.settings.stepOut.off')
        }
        checked={draft.stepOut}
        disabled={!draft.enabled}
        onCheckedChange={(stepOut) => set({ stepOut })}
      />

      <div className="grid gap-4">
        <Switch
          label={t('owner:presence.settings.foreground.label')}
          description={
            draft.foreground.enabled
              ? t('owner:presence.settings.foreground.on', { min: draft.foreground.intervalMin })
              : t('owner:presence.settings.foreground.off')
          }
          checked={draft.foreground.enabled}
          disabled={!draft.enabled}
          onCheckedChange={(enabled) => set({ foreground: { ...draft.foreground, enabled } })}
        />
        {draft.enabled && draft.foreground.enabled ? (
          <Stepper
            label={t('owner:presence.settings.foreground.interval')}
            value={draft.foreground.intervalMin}
            onValueChange={(intervalMin) =>
              set({ foreground: { ...draft.foreground, intervalMin } })
            }
            min={10}
            max={120}
            step={5}
            unit={t('owner:settings.units.min')}
          />
        ) : null}
      </div>

      <Switch
        label={t('owner:presence.settings.quietBreaks.label')}
        description={
          draft.quietDuringBreaks
            ? t('owner:presence.settings.quietBreaks.on')
            : t('owner:presence.settings.quietBreaks.off')
        }
        checked={draft.quietDuringBreaks}
        disabled={!draft.enabled}
        onCheckedChange={(quietDuringBreaks) => set({ quietDuringBreaks })}
      />

      <div className="grid gap-3 border-border border-t pt-5">
        {pin ? <Meta>{t('owner:settings.needsPin')}</Meta> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            icon={pin ? 'lock' : 'check-circle'}
            disabled={!changes || problem !== 'none' || patch.isPending}
          >
            {patch.isPending ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          {changes ? <Button onClick={reset}>{t('owner:settings.undo')}</Button> : null}
        </div>
      </div>
    </form>
  );
}
