/**
 * Roster (PRD 5.2, O-08): the week plan. Desktop: a real table, staff x 7 days with the shift name
 * and hours, week offs, holidays, leave and venue duties, and the weekly hours with the 48 h warning.
 * Phone: one row per person with a 7-day strip. Tapping a day opens a sheet: pick a shift, make it
 * the week off, no shift, back to usual, or "Swap week off with…". **Add off-site duty** is the one
 * sindoor action; this week's duties are listed under the grid with Cancel.
 */
import {
  type DutyView,
  isoWeekDates,
  isoWeekOf,
  type RosterCell,
  type RosterView,
} from '@fs/contracts';
import {
  Banner,
  Button,
  ChipGroup,
  Icon,
  IconButton,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '@fs/ui';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useCancelDuty, useDuties, useRoster, useRosterChange } from '../api/schedule';
import { Meta, Section } from '../components/layout';
import { QueryView, useErrorText } from '../components/states';
import { clock, dayLabel, longDate, shortDate, todayIst } from '../lib/format';
import { leaveKey } from '../lib/status';
import { useOwnerTitle } from '../shell/chrome';
import {
  cellChange,
  isWeekOff,
  type RosterRow,
  swapChanges,
  swapTargets,
  weeklyHours,
  weekNav,
} from './roster-model';

const WEEK_RE = /^\d{4}-W\d{2}$/;

export function RosterScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('week') ?? '';
  const week = WEEK_RE.test(raw) ? raw : isoWeekOf(todayIst());
  const dates = isoWeekDates(week);
  const monday = dates[0] ?? todayIst();
  const sunday = dates[6] ?? monday;
  const roster = useRoster(week);
  const nav = weekNav(week);
  useOwnerTitle(null);

  const go = (w: string) => {
    const next = new URLSearchParams(params);
    next.set('week', w);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton
            icon="caret-left"
            label={t('owner:roster.prevWeek')}
            onClick={() => go(nav.prev)}
          />
          <h2 className="min-w-44 text-center font-bold text-lg text-text" aria-live="polite">
            {t('owner:roster.week', { date: shortDate(monday) })}
          </h2>
          <IconButton
            icon="caret-right"
            label={t('owner:roster.nextWeek')}
            onClick={() => go(nav.next)}
          />
        </div>
        <Button asChild variant="primary" icon="map-pin">
          <Link to={`/o/duties/new?date=${monday >= todayIst() ? monday : todayIst()}`}>
            {t('owner:roster.addDuty')}
          </Link>
        </Button>
      </div>
      <QueryView query={roster} skeleton={<RosterSkeleton />}>
        {(view) => <RosterBody view={view} week={week} />}
      </QueryView>
      <Duties from={monday} to={sunday} />
    </div>
  );
}

interface Target {
  row: RosterRow;
  date: string;
}

function RosterBody({ view, week }: { view: RosterView; week: string }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target | null>(null);
  const over = view.rows.filter((r) => r.over48);
  return (
    <>
      {over.length > 0 ? (
        <Banner icon="warning-circle">
          {over
            .map((r) =>
              t('owner:roster.over48', {
                name: firstName(r.user.name),
                hours: weeklyHours(r),
              }),
            )
            .join(' ')}
        </Banner>
      ) : null}
      <div className="hidden xl:block">
        <RosterTable view={view} onPick={setTarget} />
      </div>
      <div className="xl:hidden">
        <RosterList view={view} onPick={setTarget} />
      </div>
      {target ? (
        <CellSheet
          key={`${target.row.user.id}-${target.date}`}
          view={view}
          week={week}
          target={target}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}

const firstName = (name: string) => name.split(' ')[0] ?? name;

/** Words for a cell: the shift name, Week off, Holiday, the leave type, Not working, No shift. */
function cellWords(cell: RosterCell, t: TFunction): string {
  switch (cell.kind) {
    case 'template':
      return cell.templateName ?? t('owner:roster.cell.no_shift');
    case 'L':
      return cell.leaveCode ? t(leaveKey(cell.leaveCode)) : t('owner:roster.cell.L');
    default:
      return t(`owner:roster.cell.${cell.kind}`);
  }
}

/** The short form for the phone strip: the shift's first word ("Full", "Eve"), or WO / HO / L. */
function cellShort(cell: RosterCell): string {
  if (cell.kind === 'template') {
    const word = (cell.templateName ?? '–').split(' ')[0] ?? '–';
    return word.length <= 4 ? word : word.slice(0, 3);
  }
  if (cell.kind === 'no_shift' || cell.kind === 'NE') return '–';
  return cell.kind;
}

function cellTone(cell: RosterCell): string {
  switch (cell.kind) {
    case 'WO':
    case 'HO':
    case 'NE':
    case 'no_shift':
      return 'bg-off-bg text-off';
    case 'L':
      return 'bg-leave-bg text-leave';
    default:
      return 'bg-bg text-text';
  }
}

function segmentsText(cell: RosterCell): string {
  return cell.segments.map((s) => `${s.start}–${s.end}`).join(', ');
}

function cellLabel(row: RosterRow, cell: RosterCell, t: TFunction): string {
  const parts = [`${row.user.name}, ${dayLabel(cell.date)}: ${cellWords(cell, t)}`];
  if (cell.kind === 'template' && cell.segments.length > 0) parts.push(segmentsText(cell));
  for (const d of cell.duties) parts.push(d.placeName);
  if (cell.override) parts.push(t('owner:roster.cell.changed'));
  return parts.join(' · ');
}

function RosterTable({ view, onPick }: { view: RosterView; onPick: (t: Target) => void }) {
  const { t } = useTranslation();
  const today = todayIst();
  return (
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          {t('owner:roster.caption', { date: shortDate(view.dates[0] ?? today) })}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-36 border-border border-r border-b bg-bg px-3 py-2 text-left font-semibold text-text-muted text-xs"
            >
              {t('owner:roster.staffColumn')}
            </th>
            {view.dates.map((d) => (
              <th
                key={d}
                scope="col"
                className={`border-border border-b px-1 py-2 text-left font-semibold text-xs ${d === today ? 'text-text' : 'text-text-muted'}`}
              >
                {dayLabel(d)}
              </th>
            ))}
            <th
              scope="col"
              className="border-border border-b border-l px-2 py-2 text-right font-semibold text-text-muted text-xs"
            >
              {t('owner:roster.hoursColumn')}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.user.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-border border-r border-b bg-bg px-3 py-1.5 text-left font-bold text-text"
              >
                <span className="block truncate">{row.user.name}</span>
                {row.user.designation ? (
                  <span className="block truncate font-normal text-text-muted text-xs">
                    {row.user.designation}
                  </span>
                ) : null}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.date} className="border-border border-b p-1 align-top">
                  <button
                    type="button"
                    onClick={() => onPick({ row, date: cell.date })}
                    className={`grid min-h-14 w-full min-w-[5.25rem] content-start gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:outline-1 hover:outline-border-strong ${cellTone(cell)}`}
                  >
                    <span className="sr-only">{cellLabel(row, cell, t)}</span>
                    <span className="truncate font-semibold" aria-hidden="true">
                      {cellWords(cell, t)}
                      {cell.override ? (
                        <span className="ml-1 inline-block size-1.5 rounded-full bg-accent align-middle" />
                      ) : null}
                    </span>
                    {cell.kind === 'template' && cell.segments.length > 0 ? (
                      <span
                        className="whitespace-nowrap text-text-muted text-xs tabular-nums"
                        aria-hidden="true"
                      >
                        {segmentsText(cell)}
                      </span>
                    ) : null}
                    {cell.duties.map((d) => (
                      <span
                        key={d.id}
                        className="flex items-center gap-1 text-leave text-xs"
                        aria-hidden="true"
                      >
                        <Icon name="map-pin" className="size-3.5 shrink-0" />
                        <span className="max-w-[6.5rem] truncate">{d.placeName}</span>
                      </span>
                    ))}
                  </button>
                </td>
              ))}
              <td
                className={`whitespace-nowrap border-border border-b border-l px-2 text-right font-semibold tabular-nums ${row.over48 ? 'text-absent' : 'text-text'}`}
              >
                {row.over48 ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="warning-circle" className="size-4" />
                    {t('owner:roster.hours', { hours: weeklyHours(row) })}
                    <span className="sr-only">{t('owner:roster.over48Short')}</span>
                  </span>
                ) : (
                  t('owner:roster.hours', { hours: weeklyHours(row) })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RosterList({ view, onPick }: { view: RosterView; onPick: (t: Target) => void }) {
  const { t } = useTranslation();
  const today = todayIst();
  return (
    <ul className="grid">
      {view.rows.map((row) => (
        <li key={row.user.id} className="grid gap-2 border-border border-t py-4 first:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-bold text-text">{row.user.name}</p>
            <p
              className={`shrink-0 font-semibold text-sm tabular-nums ${row.over48 ? 'text-absent' : 'text-text-muted'}`}
            >
              {t('owner:roster.hours', { hours: weeklyHours(row) })}
              {row.over48 ? ` · ${t('owner:roster.over48Short')}` : ''}
            </p>
          </div>
          <ol className="grid grid-cols-7 gap-1">
            {row.cells.map((cell) => (
              <li key={cell.date} className="grid gap-0.5 text-center">
                <span
                  className={`text-xs ${cell.date === today ? 'font-bold text-text' : 'text-text-muted'}`}
                  aria-hidden="true"
                >
                  {dayLabel(cell.date).slice(0, 2)}
                </span>
                <button
                  type="button"
                  onClick={() => onPick({ row, date: cell.date })}
                  className={`relative grid h-12 place-items-center rounded-sm px-0.5 font-semibold text-xs ${cellTone(cell)} ${cell.kind === 'template' ? 'outline-1 outline-border -outline-offset-1' : ''}`}
                >
                  <span className="sr-only">{cellLabel(row, cell, t)}</span>
                  <span className="w-full truncate" aria-hidden="true">
                    {cellShort(cell)}
                  </span>
                  {cell.duties.length > 0 ? (
                    <Icon
                      name="map-pin"
                      className="-top-1 -right-1 absolute size-3.5 rounded-full bg-bg text-leave"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function CellSheet({
  view,
  week,
  target,
  onClose,
}: {
  view: RosterView;
  week: string;
  target: Target;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const change = useRosterChange(week);
  const { row, date } = target;
  const cell = row.cells.find((c) => c.date === date);
  const [swapping, setSwapping] = useState(false);
  const [swapWith, setSwapWith] = useState<string>('');
  if (!cell) return null;
  const name = firstName(row.user.name);
  const locked = cell.kind === 'HO' || cell.kind === 'L';
  const templates = view.templates.filter((x) => x.active).sort((a, b) => a.sort - b.sort);

  const save = (changes: Parameters<typeof change.mutate>[0]) =>
    change.mutate(changes, {
      onSuccess: () => {
        toast({ title: t('owner:roster.edit.saved', { name }) });
        onClose();
      },
      onError: (e) => {
        if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
      },
    });

  const targets = swapTargets(row).filter((c) => c.date !== date);

  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t('owner:roster.edit.title', { name: row.user.name, date: longDate(date) })}
      description={cellWords(cell, t)}
      footer={
        swapping ? (
          <>
            <Button
              variant="primary"
              disabled={!swapWith || change.isPending}
              onClick={() => save(swapChanges(row, date, swapWith))}
            >
              {change.isPending ? t('owner:common.saving') : t('owner:roster.edit.swapConfirm')}
            </Button>
            <Button onClick={() => setSwapping(false)}>{t('owner:common.cancel')}</Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('owner:common.close')}</Button>
        )
      }
    >
      {swapping ? (
        <div className="grid gap-4">
          <p className="text-text-body">
            {t('owner:roster.edit.swapBody', { date: dayLabel(date) })}
          </p>
          <ChipGroup
            type="radio"
            legend={t('owner:roster.edit.swapTitle', { name })}
            legendHidden
            layout="grid"
            value={swapWith}
            onValueChange={setSwapWith}
            options={targets.map((c) => ({ value: c.date, label: dayLabel(c.date) }))}
          />
        </div>
      ) : (
        <div className="grid gap-6">
          {cell.duties.length > 0 ? (
            <Meta>
              {cell.duties
                .map((d) =>
                  t('owner:roster.dutyLine', {
                    place: d.placeName,
                    times: `${clock(d.startTs)}–${clock(d.endTs)}`,
                  }),
                )
                .join(' · ')}
            </Meta>
          ) : null}
          {locked ? null : (
            <ChipGroup
              type="radio"
              legend={t('owner:roster.edit.useTemplate')}
              layout="grid"
              disabled={change.isPending}
              value={cell.kind === 'template' ? (cell.templateId ?? '') : ''}
              onValueChange={(id) =>
                save([cellChange(row, date, { kind: 'template', templateId: id })])
              }
              options={templates.map((x) => ({ value: x.id, label: x.name }))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {isWeekOff(cell) && targets.length > 0 ? (
              <Button variant="secondary" icon="arrows-clockwise" onClick={() => setSwapping(true)}>
                {t('owner:roster.edit.swap')}
              </Button>
            ) : null}
            {!locked && !isWeekOff(cell) ? (
              <Button
                variant="secondary"
                icon="minus"
                disabled={change.isPending}
                onClick={() => save([cellChange(row, date, { kind: 'week_off' })])}
              >
                {t('owner:roster.edit.weekOff')}
              </Button>
            ) : null}
            {!locked && cell.kind !== 'no_shift' ? (
              <Button
                variant="secondary"
                disabled={change.isPending}
                onClick={() => save([cellChange(row, date, { kind: 'no_shift' })])}
              >
                {t('owner:roster.edit.noShift')}
              </Button>
            ) : null}
            {cell.override ? (
              <Button
                variant="ghost"
                disabled={change.isPending}
                onClick={() => save([cellChange(row, date, { kind: 'clear' })])}
              >
                {t('owner:roster.edit.reset')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Duties({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const duties = useDuties(from, to);
  return (
    <Section title={t('owner:roster.dutiesTitle')}>
      <QueryView
        query={duties}
        skeleton={<Skeleton width="60%" />}
        isEmpty={(list) => list.length === 0}
        empty={<Meta>{t('owner:roster.noDuties')}</Meta>}
      >
        {(list) => (
          <List>
            {list.map((d) => (
              <DutyRow key={d.id} duty={d} />
            ))}
          </List>
        )}
      </QueryView>
    </Section>
  );
}

function DutyRow({ duty }: { duty: DutyView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const cancel = useCancelDuty();
  const [open, setOpen] = useState(false);
  const names = duty.staff.map((s) => firstName(s.name)).join(', ');
  return (
    <ListRow
      leading={<Icon name="map-pin" className="text-leave" />}
      title={duty.placeName}
      subtitle={`${names} · ${shortDate(duty.workDate)} ${clock(duty.startTs)}–${clock(duty.endTs)}`}
      trailing={
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title={t('owner:roster.cancelDutyTitle', { place: duty.placeName })}
          description={t('owner:roster.cancelDutyBody')}
          trigger={
            <Button variant="danger-secondary" size="sm">
              {t('owner:roster.cancelDuty')}
            </Button>
          }
          footer={
            <>
              <Button
                variant="danger-secondary"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(duty.id, {
                    onSuccess: () => setOpen(false),
                    onError: (e) => {
                      if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
                    },
                  })
                }
              >
                {t('owner:roster.cancelDuty')}
              </Button>
              <Button onClick={() => setOpen(false)}>{t('owner:common.close')}</Button>
            </>
          }
        />
      }
    />
  );
}

function RosterSkeleton() {
  return (
    <SkeletonGroup className="grid gap-3">
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="grid gap-2">
          <Skeleton width="9rem" />
          <Skeleton shape="block" height="3rem" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
