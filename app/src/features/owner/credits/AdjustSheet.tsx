/**
 * Adjust minutes (PRD 4.19.5, O-29.10): one sheet for a new adjustment (day, kind, add or take away,
 * minutes, required reason) and for one ledger entry, where it also shows what was recorded, the
 * history (original, each adjustment with its reason, who and when, voids) and lets Urmi change or
 * void an adjustment with a reason. The original entry always stays; a recompute never undoes these.
 */
import { type CreditHistoryItem, CreditKind, type CreditLedgerRow, istDate } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, Select, Sheet, Textarea, useToast } from '@fs/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useAdjustCredits, useChangeAdjustment, useVoidAdjustment } from '../api/credits';
import { Meta } from '../components/layout';
import { useErrorText } from '../components/states';
import { clock, dayLabel, shortDate, todayIst } from '../lib/format';
import {
  type AdjustDraft,
  activeAdjustments,
  adjustDelta,
  type Direction,
  draftFor,
  rowTotal,
  signedMin,
} from './credits-model';
import { KindBadge } from './parts';

type Mode =
  | { kind: 'add' }
  | { kind: 'change'; id: string; was: number }
  | { kind: 'void'; id: string; was: number };

export interface AdjustSheetProps {
  userId: string;
  /** The entry to adjust; null for a new adjustment on any day and kind. */
  entry: CreditLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdjustSheet({ userId, entry, open, onOpenChange }: AdjustSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const add = useAdjustCredits(userId);
  const change = useChangeAdjustment();
  const voidIt = useVoidAdjustment();
  const [mode, setMode] = useState<Mode>({ kind: 'add' });
  const [day, setDay] = useState(todayIst());
  const [kind, setKind] = useState<CreditKind>('late');
  const [draft, setDraft] = useState<AdjustDraft>(draftFor(0));

  // A fresh form every time the sheet opens, on the entry's day and kind.
  useEffect(() => {
    if (!open) return;
    setMode({ kind: 'add' });
    setDraft(draftFor(0));
    setDay(entry?.date ?? todayIst());
    setKind(entry && entry.kind !== 'settled' ? entry.kind : 'late');
  }, [open, entry]);

  const delta = adjustDelta(draft);
  const reasonOk = draft.reason.trim().length >= 3;
  const busy = add.isPending || change.isPending || voidIt.isPending;
  const done = (title: string) => {
    onOpenChange(false);
    toast({ title, tone: 'success' });
  };
  const fail = (e: unknown) => {
    if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
  };

  const submit = () => {
    if (mode.kind === 'void') {
      if (!reasonOk) return;
      voidIt.mutate(
        { id: mode.id, reason: draft.reason.trim() },
        { onSuccess: () => done(t('owner:credits.voidForm.saved')), onError: fail },
      );
      return;
    }
    if (delta === null) return;
    if (mode.kind === 'change') {
      change.mutate(
        { id: mode.id, deltaMin: delta, reason: draft.reason.trim() },
        { onSuccess: () => done(t('owner:credits.changeForm.saved')), onError: fail },
      );
      return;
    }
    add.mutate(
      { workDate: day, kind, deltaMin: delta, reason: draft.reason.trim() },
      { onSuccess: () => done(t('owner:credits.adjustForm.saved')), onError: fail },
    );
  };

  const title =
    mode.kind === 'void'
      ? t('owner:credits.voidForm.title')
      : mode.kind === 'change'
        ? t('owner:credits.changeForm.title')
        : entry
          ? t('owner:credits.entry.title', {
              kind: t(`owner:credits.kinds.${entry.kind}`),
              date: dayLabel(entry.date),
            })
          : t('owner:credits.adjustForm.title');
  const cta =
    mode.kind === 'void'
      ? t('owner:credits.voidForm.save')
      : mode.kind === 'change'
        ? t('owner:credits.changeForm.save')
        : t('owner:credits.adjustForm.save');
  const ready = mode.kind === 'void' ? reasonOk : delta !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        mode.kind === 'void' ? t('owner:credits.voidForm.body') : t('owner:credits.adjustForm.body')
      }
      footer={
        <>
          <Button
            variant={mode.kind === 'void' ? 'danger-secondary' : 'primary'}
            icon={mode.kind === 'void' ? 'trash' : 'check-circle'}
            disabled={!ready || busy}
            onClick={submit}
          >
            {busy ? t('owner:common.saving') : cta}
          </Button>
          <Button
            onClick={() => (mode.kind === 'add' ? onOpenChange(false) : setMode({ kind: 'add' }))}
          >
            {t('owner:common.cancel')}
          </Button>
        </>
      }
    >
      <div className="grid gap-6">
        {entry && mode.kind === 'add' ? (
          <EntryDetails
            entry={entry}
            userId={userId}
            onChange={(h) => {
              setMode({ kind: 'change', id: h.adjustmentId ?? '', was: h.minutes });
              setDraft(draftFor(h.minutes));
            }}
            onVoid={(h) => {
              setMode({ kind: 'void', id: h.adjustmentId ?? '', was: h.minutes });
              setDraft(draftFor(0));
            }}
          />
        ) : null}
        {!entry && mode.kind === 'add' ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('owner:credits.adjustForm.day')}>
              <Input
                type="date"
                value={day}
                max={todayIst()}
                onChange={(e) => e.target.value && setDay(e.target.value)}
              />
            </Field>
            <Field label={t('owner:credits.adjustForm.kind')}>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as CreditKind)}
                options={CreditKind.options.map((k) => ({
                  value: k,
                  label: t(`owner:credits.kinds.${k}`),
                }))}
              />
            </Field>
          </div>
        ) : null}
        {mode.kind === 'void' ? null : (
          <MinutesForm
            draft={draft}
            onChange={setDraft}
            was={mode.kind === 'change' ? mode.was : 0}
          />
        )}
        <Field
          label={
            mode.kind === 'void'
              ? t('owner:credits.voidForm.reason')
              : t('owner:credits.adjustForm.reason')
          }
          hint={t('owner:credits.adjustForm.reasonHint')}
        >
          <Textarea
            value={draft.reason}
            rows={2}
            maxLength={300}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  );
}

function MinutesForm({
  draft,
  onChange,
  was,
}: {
  draft: AdjustDraft;
  onChange: (d: AdjustDraft) => void;
  was: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5">
      <ChipGroup
        type="radio"
        legend={t('owner:credits.adjustForm.direction')}
        value={draft.direction}
        onValueChange={(v) => onChange({ ...draft, direction: v as Direction })}
        options={(['add', 'take'] as const).map((d) => ({
          value: d,
          label: t(`owner:credits.adjustForm.${d}`),
          icon: d === 'add' ? 'plus' : 'minus',
        }))}
      />
      <Field
        label={t('owner:credits.adjustForm.minutes')}
        hint={was !== 0 ? t('owner:credits.min', { value: signedMin(was) }) : undefined}
        className="max-w-48"
      >
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft.minutes}
          maxLength={4}
          end={<span className="text-text-muted">{t('owner:settings.units.min')}</span>}
          onChange={(e) => onChange({ ...draft, minutes: e.target.value.replace(/\D/g, '') })}
        />
      </Field>
    </div>
  );
}

function EntryDetails({
  entry,
  userId,
  onChange,
  onVoid,
}: {
  entry: CreditLedgerRow;
  userId: string;
  onChange: (h: CreditHistoryItem) => void;
  onVoid: (h: CreditHistoryItem) => void;
}) {
  const { t } = useTranslation();
  const active = new Set(activeAdjustments(entry.history).map((h) => h.adjustmentId));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <KindBadge kind={entry.kind} />
        <span className="font-bold text-text tabular-nums">
          {t('owner:credits.entry.now', { min: signedMin(rowTotal(entry)) })}
        </span>
        {entry.adjustedMin !== 0 ? (
          <Meta>{t('owner:credits.entry.recorded', { min: signedMin(entry.minutes) })}</Meta>
        ) : null}
      </div>
      <div>
        <Button asChild size="sm" variant="secondary" iconEnd="arrow-right">
          <Link to={`/o/register/${userId}/${entry.date}`}>{t('owner:credits.entry.openDay')}</Link>
        </Button>
      </div>
      <section className="grid gap-2" aria-label={t('owner:credits.entry.history')}>
        <h3 className="font-bold text-text">{t('owner:credits.entry.history')}</h3>
        {entry.history.length === 0 ? (
          <Meta>{t('owner:credits.entry.noHistory')}</Meta>
        ) : (
          <ul className="grid">
            {entry.history.map((h) => (
              <li
                key={`${h.kind}-${h.adjustmentId ?? 'original'}-${h.at}`}
                className="grid gap-1 border-border border-t py-2.5 first:border-t-0"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-text">
                  <span className="font-semibold">
                    {h.kind === 'original'
                      ? t('owner:credits.entry.original', { min: signedMin(h.minutes) })
                      : h.kind === 'void'
                        ? t('owner:credits.entry.voided', {
                            name: h.by?.name ?? t('owner:credits.entry.someone'),
                          })
                        : t('owner:credits.entry.adjustment', {
                            min: signedMin(h.minutes),
                            name: h.by?.name ?? t('owner:credits.entry.someone'),
                          })}
                  </span>
                  <span className="text-sm text-text-muted tabular-nums">
                    {`${shortDate(istDate(h.at))}, ${clock(h.at)}`}
                  </span>
                </p>
                {h.reason ? <p className="text-sm text-text-body">{h.reason}</p> : null}
                {h.kind === 'adjustment' && h.adjustmentId && active.has(h.adjustmentId) ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="pencil-simple"
                      onClick={() => onChange(h)}
                    >
                      {t('owner:credits.entry.change')}
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => onVoid(h)}>
                      {t('owner:credits.entry.void')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
