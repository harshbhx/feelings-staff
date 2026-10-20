/**
 * One Needs-action item with what it shows and its actions (PRD 4.12 table). Every decision
 * notifies the staff member (server side) and removes the item from the queue.
 */
import type { ActionItem, OwnerPunchView } from '@fs/contracts';
import { Avatar, Button, Field, Icon, Input, Sheet, StatusChip, Textarea, useToast } from '@fs/ui';
import type { TFunction } from 'i18next';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { type Decision, useDecide } from '../api/attendance';
import { useStaffList } from '../api/staff';
import { MapToggle, PunchFacts, RiskReasons, SelfieCompare } from '../components/PunchEvidence';
import { useErrorText } from '../components/states';
import { ago, clock, dayLabel, duration, money, shortDate } from '../lib/format';
import { leaveKey } from '../lib/status';
import { clampOvertime, waitingDays } from './actions-model';

const firstName = (name: string) => name.split(' ')[0] ?? name;

export function ActionCard({
  item,
  now,
  selectable,
  selected,
  onToggle,
}: {
  item: ActionItem;
  now: number;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const decide = useDecide();
  const checkId = useId();
  const name = item.user.name;
  const first = firstName(name);

  const run = (d: Decision, after?: () => void) =>
    decide.mutate(d, {
      onSuccess: () => {
        after?.();
        toast({ title: t('owner:actions.decided', { name: first }), tone: 'success' });
      },
      onError: (e) => {
        if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
      },
    });

  const waited = waitingDays(item.createdAt, now);
  const busy = decide.isPending;

  return (
    <li
      className="grid gap-3 border-border border-t px-(--card-pad) py-4 first:border-t-0"
      data-testid={`action-${item.type}`}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <label
            htmlFor={checkId}
            className="-m-2.5 grid size-11 shrink-0 cursor-pointer place-items-center"
          >
            <input
              id={checkId}
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="size-5 accent-(--accent)"
            />
            <span className="sr-only">{t('owner:actions.select', { name })}</span>
          </label>
        ) : null}
        <Avatar name={name} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="font-bold text-text">{titleFor(item, t)}</p>
          <p className="text-sm text-text-muted">
            {ago(item.createdAt, now, t)}
            {waited > 0 ? ` · ${t('owner:time.waitingDays', { count: waited })}` : ''}
          </p>
        </div>
      </div>
      <div className={`grid gap-3 ${selectable ? 'sm:pl-22' : 'sm:pl-13'}`}>
        <Body item={item} />
        <Actions item={item} busy={busy} run={run} />
      </div>
    </li>
  );
}

type T = TFunction;

function punchKind(p: OwnerPunchView, t: T) {
  return t(`owner:punch.noun.${p.kind}`);
}

function titleFor(item: ActionItem, t: T): string {
  const first = firstName(item.user.name);
  switch (item.type) {
    case 'flagged_punch':
      return t('owner:actions.flagged.title', { name: first, kind: punchKind(item.punch, t) });
    case 'pending_punch':
      return t('owner:actions.pending.title', { name: first });
    case 'new_device':
      return t('owner:actions.device.title', { name: first });
    case 'leave_request':
      return t('owner:actions.leave.title', { name: first });
    case 'regularisation':
      return t('owner:actions.fix.title', { name: first, date: dayLabel(item.request.workDate) });
    case 'overtime':
      return t('owner:actions.overtime.title', { name: first, date: dayLabel(item.workDate) });
    case 'offsite_request':
      return t('owner:actions.offsite.title', { name: first });
    case 'auto_closed':
      return t('owner:actions.autoClosed.title', { name: first, time: clock(item.autoOutTs) });
    case 'advance_request':
      return t('owner:actions.advance.title', { name: first });
    case 'away':
      return t('owner:actions.away.title', {
        name: first,
        start: clock(item.startTs),
        end: clock(item.endTs),
      });
  }
}

function Quote({ children }: { children: ReactNode }) {
  return <p className="border-border-strong border-l-2 pl-3 text-text-body italic">{children}</p>;
}

function PunchBody({ punch, item }: { punch: OwnerPunchView; item: ActionItem }) {
  const { t } = useTranslation();
  const site = 'map' in item ? item.map.site : null;
  return (
    <>
      <p className="text-text-body tabular-nums">
        {t('owner:actions.flagged.at', {
          kind: t(`owner:punch.${punch.kind}`),
          time: clock(punch.effectiveTs),
          date: dayLabel(punch.workDate),
        })}
      </p>
      {punch.pendingReason ? (
        <p className="text-text-body">
          {t('owner:actions.pending.why', {
            reason: t(`owner:punch.pendingReason.${punch.pendingReason}`),
          })}
        </p>
      ) : null}
      <RiskReasons punch={punch} />
      <PunchFacts punch={punch} />
      {punch.note ? <Quote>{t('owner:actions.leave.reason', { reason: punch.note })}</Quote> : null}
      <div className="flex flex-wrap items-start gap-3">
        {punch.selfieUrl ? (
          <SelfieCompare selfieUrl={punch.selfieUrl} userId={item.user.id} name={item.user.name} />
        ) : null}
        <div className="min-w-0 flex-1">
          <MapToggle punch={punch} site={site} />
        </div>
      </div>
    </>
  );
}

function times(inTs: number | null, outTs: number | null, t: T) {
  return t('owner:actions.fix.inOut', {
    in: inTs !== null ? clock(inTs) : t('owner:actions.fix.none'),
    out: outTs !== null ? clock(outTs) : t('owner:actions.fix.none'),
  });
}

function Body({ item }: { item: ActionItem }) {
  const { t } = useTranslation();
  switch (item.type) {
    case 'flagged_punch':
    case 'pending_punch':
      return <PunchBody punch={item.punch} item={item} />;
    case 'new_device':
      return (
        <>
          <p className="text-text-body">
            {t('owner:actions.device.line', {
              label: item.device.label,
              ago: ago(item.device.requestedAt, Date.now(), t),
            })}
          </p>
          {item.replacesDeviceLabel ? (
            <p className="text-text-body">
              {t('owner:actions.device.replaces', { label: item.replacesDeviceLabel })}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Icon name="lock" className="size-5 shrink-0" />
            {t('owner:actions.device.approveHint')}
          </p>
        </>
      );
    case 'leave_request': {
      const r = item.request;
      const total = r.daysPaid + r.daysUnpaid;
      const range =
        r.fromDate === r.toDate
          ? dayLabel(r.fromDate)
          : `${shortDate(r.fromDate)} – ${shortDate(r.toDate)}`;
      return (
        <>
          <p className="text-text-body">
            {t('owner:actions.leave.dates', { range, type: t(leaveKey(r.typeCode)) })} ·{' '}
            {t('owner:actions.leave.days', { count: total })}
            {r.daysUnpaid > 0
              ? ` · ${t('owner:actions.leave.unpaid', { count: r.daysUnpaid })}`
              : ''}
          </p>
          <p className="text-sm text-text-muted">
            {t('owner:actions.leave.balanceAfter', { balance: item.balanceAfter })}
          </p>
          {r.blackoutHit ? (
            <p className="flex items-start gap-2 text-sm text-late">
              <Icon name="warning-circle" className="mt-0.5 size-5 shrink-0" />
              {t('owner:actions.leave.blackout')}
            </p>
          ) : null}
          {r.reason ? <Quote>{t('owner:actions.leave.reason', { reason: r.reason })}</Quote> : null}
        </>
      );
    }
    case 'regularisation': {
      const r = item.request;
      return (
        <>
          <p className="font-semibold text-text-body">{t(`owner:actions.fix.kind.${r.kind}`)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-muted">{t('owner:actions.fix.recorded')}</dt>
            <dd className="text-text-body">{times(r.currentInTs, r.currentOutTs, t)}</dd>
            <dt className="text-text-muted">{t('owner:actions.fix.proposed')}</dt>
            <dd className="font-bold text-text">
              {times(r.proposedInTs ?? r.currentInTs, r.proposedOutTs ?? r.currentOutTs, t)}
            </dd>
          </dl>
          <Quote>{t('owner:actions.leave.reason', { reason: r.reason })}</Quote>
        </>
      );
    }
    case 'overtime': {
      const firstIn = item.punches.find((p) => p.kind === 'in')?.effectiveTs ?? null;
      const lastOut =
        [...item.punches].reverse().find((p) => p.kind === 'out')?.effectiveTs ?? null;
      return (
        <>
          <p className="text-text-body tabular-nums">
            {t('owner:actions.overtime.minutes', { duration: duration(item.candidateMin) })}
            {item.shiftEnd
              ? ` · ${t('owner:actions.overtime.shiftEnd', { time: item.shiftEnd })}`
              : ''}
          </p>
          {firstIn !== null || lastOut !== null ? (
            <p className="text-sm text-text-muted tabular-nums">{times(firstIn, lastOut, t)}</p>
          ) : null}
          {item.preapprovedMin > 0 ? (
            <StatusChip
              status="venue"
              label={t('owner:actions.overtime.preapproved', {
                duration: duration(item.preapprovedMin),
              })}
            />
          ) : null}
        </>
      );
    }
    case 'offsite_request': {
      const p = item.punch;
      return (
        <>
          {p.placeName ? (
            <p className="font-semibold text-text">
              {t('owner:actions.offsite.place', { place: p.placeName })}
            </p>
          ) : null}
          <p className="text-text-body tabular-nums">
            {t('owner:actions.flagged.at', {
              kind: t(`owner:punch.${p.kind}`),
              time: clock(p.effectiveTs),
              date: dayLabel(p.workDate),
            })}
            {p.distanceM !== null
              ? ` · ${t('owner:actions.offsite.distance', { km: (p.distanceM / 1000).toFixed(1) })}`
              : ''}
          </p>
          {p.note ? <Quote>{t('owner:actions.leave.reason', { reason: p.note })}</Quote> : null}
          <MapToggle punch={p} site={item.map.site} />
        </>
      );
    }
    case 'away':
      return (
        <p className="text-text-body tabular-nums">
          {t('owner:actions.away.line', { count: item.minutes })}
        </p>
      );
    case 'auto_closed':
      return (
        <p className="text-text-body tabular-nums">
          {t('owner:actions.autoClosed.line', {
            date: dayLabel(item.workDate),
            in: clock(item.inTs),
          })}
        </p>
      );
    case 'advance_request': {
      const a = item.advance;
      return (
        <>
          <p className="font-semibold text-text tabular-nums">
            {t('owner:actions.advance.amount', {
              amount: money(a.amountPaise),
              plan:
                a.plan === 'full'
                  ? t('owner:actions.advance.planFull')
                  : t('owner:actions.advance.planInstalments', { count: a.instalmentsN ?? 2 }),
            })}
          </p>
          {item.openBalancePaise > 0 ? (
            <p className="text-sm text-text-muted">
              {t('owner:actions.advance.open', { amount: money(item.openBalancePaise) })}
            </p>
          ) : null}
          {a.reason ? <Quote>{t('owner:actions.leave.reason', { reason: a.reason })}</Quote> : null}
        </>
      );
    }
  }
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Actions({
  item,
  busy,
  run,
}: {
  item: ActionItem;
  busy: boolean;
  run: (d: Decision, after?: () => void) => void;
}) {
  const { t } = useTranslation();
  const name = firstName(item.user.name);
  const approve = (label: string, d: Decision) => (
    <Button
      size="sm"
      variant="secondary"
      icon="check-circle"
      disabled={busy}
      onClick={() => run(d)}
    >
      {label}
    </Button>
  );
  const reject = (label: string, make: (note: string) => Decision) => (
    <RejectSheet
      label={label}
      name={name}
      busy={busy}
      onReject={(note, done) => run(make(note), done)}
    />
  );

  switch (item.type) {
    case 'flagged_punch':
      return (
        <Row>
          {approve(t('owner:actions.flagged.looksFine'), {
            type: 'flagged_punch',
            id: item.id,
            punchId: item.punch.id,
            decision: 'clear',
          })}
          {reject(t('owner:actions.flagged.reject'), (note) => ({
            type: 'flagged_punch',
            id: item.id,
            punchId: item.punch.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'pending_punch':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'pending_punch',
            id: item.id,
            punchId: item.punch.id,
            decision: 'approve',
          })}
          {reject(t('owner:common.reject'), (note) => ({
            type: 'pending_punch',
            id: item.id,
            punchId: item.punch.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'new_device':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'new_device',
            id: item.id,
            deviceId: item.device.id,
            decision: 'approve',
          })}
          {reject(t('owner:common.reject'), (note) => ({
            type: 'new_device',
            id: item.id,
            deviceId: item.device.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'leave_request':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'leave_request',
            id: item.id,
            requestId: item.request.id,
            decision: 'approve',
          })}
          {reject(t('owner:common.reject'), (note) => ({
            type: 'leave_request',
            id: item.id,
            requestId: item.request.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'regularisation':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'regularisation',
            id: item.id,
            requestId: item.request.id,
            decision: 'approve',
          })}
          {reject(t('owner:common.reject'), (note) => ({
            type: 'regularisation',
            id: item.id,
            requestId: item.request.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'overtime':
      return <OvertimeActions item={item} busy={busy} run={run} />;
    case 'offsite_request':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'offsite_request',
            id: item.id,
            punchId: item.punch.id,
            decision: 'approve',
          })}
          <OpenVenueSheet
            busy={busy}
            exclude={item.user.id}
            onConfirm={(staffIds, done) =>
              run(
                {
                  type: 'offsite_request',
                  id: item.id,
                  punchId: item.punch.id,
                  decision: 'approve_and_open',
                  staffIds,
                },
                done,
              )
            }
          />
          {reject(t('owner:common.reject'), (note) => ({
            type: 'offsite_request',
            id: item.id,
            punchId: item.punch.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
    case 'auto_closed':
      return (
        <Row>
          {approve(t('owner:actions.autoClosed.keep', { time: clock(item.autoOutTs) }), {
            type: 'auto_closed',
            id: item.id,
            userId: item.user.id,
            workDate: item.workDate,
            outTs: null,
          })}
          <ChangeTimeSheet
            name={name}
            busy={busy}
            workDate={item.workDate}
            initial={clock(item.autoOutTs)}
            onSave={(outTs, done) =>
              run(
                {
                  type: 'auto_closed',
                  id: item.id,
                  userId: item.user.id,
                  workDate: item.workDate,
                  outTs,
                },
                done,
              )
            }
          />
        </Row>
      );
    case 'away':
      // Confirm, mark as work and ignore arrive with the credits screens (WP-9 slice 9c).
      return null;
    case 'advance_request':
      return (
        <Row>
          {approve(t('owner:common.approve'), {
            type: 'advance_request',
            id: item.id,
            advanceId: item.advance.id,
            decision: 'approve',
          })}
          {reject(t('owner:common.reject'), (note) => ({
            type: 'advance_request',
            id: item.id,
            advanceId: item.advance.id,
            decision: 'reject',
            note,
          }))}
        </Row>
      );
  }
}

function OvertimeActions({
  item,
  busy,
  run,
}: {
  item: Extract<ActionItem, { type: 'overtime' }>;
  busy: boolean;
  run: (d: Decision, after?: () => void) => void;
}) {
  const { t } = useTranslation();
  const [part, setPart] = useState<number | null>(null);
  const base = {
    type: 'overtime' as const,
    id: item.id,
    userId: item.user.id,
    workDate: item.workDate,
  };
  const canPart = item.candidateMin >= 30;
  return (
    <div className="grid gap-3">
      <Row>
        <Button
          size="sm"
          variant="secondary"
          icon="check-circle"
          disabled={busy}
          onClick={() => run({ ...base, approvedMin: item.candidateMin })}
        >
          {t('owner:actions.overtime.approveAll')}
        </Button>
        {canPart ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-expanded={part !== null}
            onClick={() =>
              setPart((p) =>
                p === null ? clampOvertime(item.candidateMin / 2, item.candidateMin) : null,
              )
            }
          >
            {t('owner:actions.overtime.approvePart')}
          </Button>
        ) : null}
        <RejectSheet
          label={t('owner:common.reject')}
          name={firstName(item.user.name)}
          busy={busy}
          onReject={(note, done) => run({ ...base, approvedMin: 0, note }, done)}
        />
      </Row>
      {part !== null ? (
        <fieldset className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <legend className="px-1 font-semibold text-sm text-text">
            {t('owner:actions.overtime.partLabel')}
          </legend>
          <Stepper
            value={part}
            onChange={(v) => setPart(clampOvertime(v, item.candidateMin))}
            min={15}
            max={item.candidateMin}
            step={15}
            format={(v) => duration(v)}
            lessLabel={t('owner:actions.overtime.decrease')}
            moreLabel={t('owner:actions.overtime.increase')}
          />
          <span className="text-sm text-text-muted">{t('owner:actions.overtime.partHint')}</span>
          <Button
            size="sm"
            variant="secondary"
            icon="check-circle"
            disabled={busy}
            onClick={() => run({ ...base, approvedMin: part }, () => setPart(null))}
          >
            {t('owner:actions.overtime.approveMinutes', { duration: duration(part) })}
          </Button>
        </fieldset>
      ) : null}
    </div>
  );
}

/** Minus / value / plus with 44 px circles (the kit's Stepper arrives in v1; same behaviour). */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  lessLabel,
  moreLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  lessLabel: string;
  moreLabel: string;
}) {
  const circle =
    'grid size-11 place-items-center rounded-full border border-border-strong bg-bg text-text hover:border-text disabled:opacity-40';
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        className={circle}
        aria-label={lessLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Icon name="minus" className="size-5" />
      </button>
      <output className="min-w-16 text-center font-bold text-text tabular-nums" aria-live="polite">
        {format(value)}
      </output>
      <button
        type="button"
        className={circle}
        aria-label={moreLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Icon name="plus" className="size-5" />
      </button>
    </span>
  );
}

function RejectSheet({
  label,
  name,
  busy,
  onReject,
}: {
  label: string;
  name: string;
  busy: boolean;
  onReject: (note: string, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:actions.reject.title')}
      trigger={
        <Button size="sm" variant="danger-secondary" disabled={busy}>
          {label}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) {
            setMissing(true);
            return;
          }
          onReject(note.trim(), () => {
            setOpen(false);
            setNote('');
          });
        }}
      >
        <Field
          label={t('owner:actions.reject.reasonLabel')}
          hint={t('owner:actions.reject.reasonHint', { name })}
          error={missing ? t('owner:day.override.reasonMissing') : undefined}
        >
          <Textarea
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setMissing(false);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="danger-secondary" loading={busy}>
            {t('owner:actions.reject.confirm')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function OpenVenueSheet({
  busy,
  exclude,
  onConfirm,
}: {
  busy: boolean;
  exclude: string;
  onConfirm: (staffIds: string[], done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const staff = useStaffList('active');
  const people = (staff.data ?? []).filter((s) => s.id !== exclude);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:actions.offsite.openTitle')}
      description={t('owner:actions.offsite.openHint')}
      trigger={
        <Button size="sm" variant="secondary" disabled={busy}>
          {t('owner:actions.offsite.approveOpen')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <fieldset className="grid gap-1">
          <legend className="sr-only">{t('owner:actions.offsite.openTitle')}</legend>
          {people.map((p) => {
            const checked = picked.includes(p.id);
            return (
              <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-(--accent)"
                  checked={checked}
                  onChange={() =>
                    setPicked((list) =>
                      checked ? list.filter((x) => x !== p.id) : [...list, p.id],
                    )
                  }
                />
                <span className="text-text">{p.name}</span>
                <span className="text-sm text-text-muted">{p.designation}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            icon="check-circle"
            loading={busy}
            onClick={() => onConfirm(picked, () => setOpen(false))}
          >
            {t('owner:actions.offsite.openConfirm')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ChangeTimeSheet({
  name,
  busy,
  workDate,
  initial,
  onSave,
}: {
  name: string;
  busy: boolean;
  workDate: string;
  initial: string;
  onSave: (outTs: number, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(initial);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:actions.autoClosed.changeTitle', { name })}
      trigger={
        <Button size="sm" variant="secondary" disabled={busy}>
          {t('owner:actions.autoClosed.change')}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const [hh, mm] = time.split(':').map(Number) as [number, number];
          const ts = Date.parse(`${workDate}T00:00:00+05:30`) + (hh * 60 + mm) * 60_000;
          if (Number.isFinite(ts)) onSave(ts, () => setOpen(false));
        }}
      >
        <Field label={t('owner:actions.autoClosed.changeLabel')} hint={dayLabel(workDate)}>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="secondary" loading={busy}>
            {t('owner:actions.autoClosed.save')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
