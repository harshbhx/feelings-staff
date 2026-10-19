/**
 * Staff profile (PRD 5.2, O-07): Overview, Salary (effective-dated, step-up), Shift (template,
 * week-off, strong mode), Leave (balances, ledger, adjust), Advances, Phones (approve, remove,
 * re-send invite, reset PIN) and Exit (mark as left, rehire).
 */
import {
  type Divisor,
  type InviteView,
  istDate,
  type LeaveCode,
  type StaffDetail,
} from '@fs/contracts';
import {
  Avatar,
  Button,
  ChipGroup,
  Field,
  Input,
  List,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  Tabs,
  Textarea,
  useToast,
} from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useShiftTemplates } from '../api/schedule';
import {
  useDecideDevice,
  useExitStaff,
  useLeaveAdjust,
  usePatchStaff,
  useRehire,
  useReinvite,
  useResetPin,
  useRevokeDevice,
  useStaff,
  useStaffLeave,
} from '../api/staff';
import { Meta, Section } from '../components/layout';
import { ErrorCard, QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { clock, days, duration, longDate, money, shortDate } from '../lib/format';
import { phoneLabel } from '../lib/share';
import { dayStatusMeta, leaveKey } from '../lib/status';
import { useOwnerTitle } from '../shell/chrome';
import { InviteSheet } from './InviteSheet';
import { rupeesToPaise } from './staff-form';

const TABS = ['overview', 'salary', 'shift', 'leave', 'advances', 'devices', 'exit'] as const;
type Tab = (typeof TABS)[number];

export function StaffProfileScreen() {
  const { id = '' } = useParams();
  const query = useStaff(id);
  useOwnerTitle(query.data?.name ?? null, '/o/staff');
  return (
    <QueryView query={query} skeleton={<ProfileSkeleton />}>
      {(staff) => <Profile staff={staff} />}
    </QueryView>
  );
}

function useMutationFeedback() {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  return {
    ok: (title?: string) => toast({ title: title ?? t('owner:common.done'), tone: 'success' }),
    fail: (e: unknown) => {
      if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
    },
  };
}

function Profile({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={staff.name} size="lg" />
        <div className="grid min-w-0">
          <p className="font-bold text-text">{staff.designation}</p>
          <Meta>
            {[
              t('owner:staff.profile.joined', { date: longDate(staff.joinDate) }),
              staff.employeeCode
                ? t('owner:staff.profile.code', { code: staff.employeeCode })
                : null,
              staff.phone ? phoneLabel(staff.phone) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Meta>
        </div>
      </div>
      <Tabs
        variant="underline"
        label={t('owner:staff.profile.tabs.label')}
        value={tab}
        onValueChange={setTab}
        items={TABS.map((k) => ({
          value: k,
          label: t(`owner:staff.profile.tabs.${k}`),
          content: <div className="max-w-(--container-narrow) pt-2">{tabContent(k, staff)}</div>,
        }))}
      />
    </div>
  );
}

function tabContent(tab: Tab, staff: StaffDetail) {
  switch (tab) {
    case 'overview':
      return <Overview staff={staff} />;
    case 'salary':
      return <SalaryTab staff={staff} />;
    case 'shift':
      return <ShiftTab staff={staff} />;
    case 'leave':
      return <LeaveTab staff={staff} />;
    case 'advances':
      return <AdvancesTab staff={staff} />;
    case 'devices':
      return <DevicesTab staff={staff} />;
    case 'exit':
      return <ExitTab staff={staff} />;
  }
}

function Overview({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const today = staff.today;
  const m = staff.monthTotals;
  const month = istDate(Date.now()).slice(0, 7);
  return (
    <div className="grid gap-8">
      <Section title={t('owner:staff.profile.today')}>
        {today ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip
              status={dayStatusMeta(today.status).chip}
              label={t(dayStatusMeta(today.status).labelKey)}
            />
            <Meta>
              {[
                today.firstInTs
                  ? t('owner:today.row.inAt', { time: clock(today.firstInTs) })
                  : null,
                today.lastOutTs
                  ? t('owner:today.row.outAt', { time: clock(today.lastOutTs) })
                  : null,
                today.workedMin > 0 ? duration(today.workedMin) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Meta>
          </div>
        ) : (
          <Meta>{t('owner:staff.profile.noToday')}</Meta>
        )}
      </Section>
      <Section
        title={t('owner:staff.profile.month')}
        action={
          <Button asChild size="sm" variant="ghost" iconEnd="arrow-right">
            <Link to={`/o/register?month=${month}&user=${staff.id}`}>
              {t('owner:staff.profile.openRegister')}
            </Link>
          </Button>
        }
      >
        <p className="text-text-body tabular-nums">
          {t('owner:staff.profile.monthLine', {
            present: m.present,
            half: m.half,
            absent: m.absent,
            late: m.lateMin,
          })}
        </p>
      </Section>
      {staff.consents.length > 0 ? (
        <Section title={t('owner:staff.profile.consents')}>
          <List>
            {staff.consents.map((c) => (
              <ListRow
                key={`${c.kind}-${c.acceptedAt}`}
                title={t(`owner:staff.profile.consent.${c.kind}`)}
                subtitle={t('owner:staff.profile.consentLine', {
                  date: longDate(istDate(c.acceptedAt)),
                })}
              />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

const DIVISORS: (Divisor | 'default')[] = ['default', 'calendar', 'fixed30', 'fixed26', 'working'];

function SalaryTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const patch = usePatchStaff(staff.id);
  const fb = useMutationFeedback();
  const basis = staff.salary.type === 'monthly' ? 'month' : 'day';
  return (
    <div className="grid gap-8">
      <Section title={t('owner:staff.profile.tabs.salary')} action={<SalarySheet staff={staff} />}>
        <p className="font-bold text-lg text-text tabular-nums">
          {t('owner:staff.profile.salaryNow', {
            amount: money(staff.salary.amountPaise),
            basis,
            date: longDate(staff.salary.effectiveFrom),
          })}
        </p>
        {staff.minimumWageWarning ? (
          <p className="text-late text-sm">{staff.minimumWageWarning}</p>
        ) : null}
      </Section>
      {staff.salaryHistory.length > 1 ? (
        <Section title={t('owner:staff.profile.salaryHistory')}>
          <List>
            {staff.salaryHistory.map((s) => (
              <ListRow
                key={`${s.effectiveFrom}-${s.createdAt}`}
                title={money(s.amountPaise)}
                subtitle={longDate(s.effectiveFrom)}
              />
            ))}
          </List>
        </Section>
      ) : null}
      <ChipGroup
        type="radio"
        legend={t('owner:staff.profile.divisor')}
        value={staff.divisorOverride ?? 'default'}
        disabled={patch.isPending}
        onValueChange={(d) =>
          patch.mutate(
            { divisorOverride: d === 'default' ? null : (d as Divisor) },
            { onSuccess: () => fb.ok(), onError: fb.fail },
          )
        }
        options={DIVISORS.map((d) => ({
          value: d,
          label:
            d === 'default'
              ? t('owner:staff.profile.divisorDefault')
              : t(`owner:staff.profile.divisors.${d}`),
        }))}
      />
    </div>
  );
}

function SalarySheet({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const patch = usePatchStaff(staff.id);
  const fb = useMutationFeedback();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState(staff.salary.type);
  const [from, setFrom] = useState(() => istDate(Date.now()));
  const [bad, setBad] = useState(false);
  const first = staff.name.split(' ')[0] ?? staff.name;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:staff.profile.salaryForm.title', { name: first })}
      description={t('owner:staff.profile.salaryForm.needsPin')}
      trigger={
        <Button size="sm" variant="secondary" icon="pencil-simple">
          {t('owner:staff.profile.changeSalary')}
        </Button>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const paise = rupeesToPaise(amount);
          if (paise === null) {
            setBad(true);
            return;
          }
          patch.mutate(
            { salary: { type, amountPaise: paise, effectiveFrom: from } },
            {
              onSuccess: () => {
                setOpen(false);
                fb.ok();
              },
              onError: fb.fail,
            },
          );
        }}
      >
        <ChipGroup
          type="radio"
          legend={t('owner:staff.form.salaryType')}
          value={type}
          onValueChange={(x) => setType(x as 'monthly' | 'daily')}
          options={[
            { value: 'monthly', label: t('owner:staff.form.monthly') },
            { value: 'daily', label: t('owner:staff.form.daily') },
          ]}
        />
        <Field
          label={t('owner:staff.profile.salaryForm.amount')}
          error={bad ? t('owner:staff.form.errors.salary') : undefined}
          required
        >
          <Input
            inputMode="decimal"
            start="₹"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setBad(false);
            }}
          />
        </Field>
        <Field
          label={t('owner:staff.profile.salaryForm.from')}
          hint={t('owner:staff.profile.salaryForm.fromHint')}
        >
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={patch.isPending}
            loadingLabel={t('owner:common.saving')}
          >
            {t('owner:staff.profile.salaryForm.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ShiftTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const templates = useShiftTemplates();
  const patch = usePatchStaff(staff.id);
  const fb = useMutationFeedback();
  const first = staff.name.split(' ')[0] ?? staff.name;
  const save = (body: Parameters<typeof patch.mutate>[0]) =>
    patch.mutate(body, { onSuccess: () => fb.ok(), onError: fb.fail });
  return (
    <div className="grid gap-8">
      {templates.data ? (
        <ChipGroup
          type="radio"
          legend={t('owner:staff.form.template')}
          value={staff.defaultTemplateId}
          disabled={patch.isPending}
          onValueChange={(id) => save({ defaultTemplateId: id })}
          options={templates.data
            .filter((x) => x.active)
            .map((x) => ({ value: x.id, label: x.name }))}
        />
      ) : templates.isError ? (
        <ErrorCard error={templates.error} onRetry={() => void templates.refetch()} />
      ) : (
        <Skeleton shape="block" height="5rem" />
      )}
      <ChipGroup
        type="radio"
        legend={t('owner:staff.form.weekOff')}
        value={staff.weekOffDow === null ? 'none' : String(staff.weekOffDow)}
        disabled={patch.isPending}
        onValueChange={(d) => save({ weekOffDow: d === 'none' ? null : Number(d) })}
        options={[
          ...[1, 2, 3, 4, 5, 6, 0].map((d) => ({
            value: String(d),
            label: WEEKDAY_SHORT[d] ?? '',
          })),
          { value: 'none', label: t('owner:staff.form.noWeekOff') },
        ]}
      />
      <ChipGroup
        type="radio"
        legend={t('owner:staff.profile.strongMode')}
        hint={t('owner:staff.profile.strongModeHint', { name: first })}
        value={staff.strongMode ? 'on' : 'off'}
        disabled={patch.isPending}
        onValueChange={(v) => save({ strongMode: v === 'on' })}
        options={[
          { value: 'off', label: t('owner:staff.form.off') },
          { value: 'on', label: t('owner:staff.form.on') },
        ]}
      />
    </div>
  );
}

function LeaveTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const leave = useStaffLeave(staff.id);
  return (
    <div className="grid gap-8">
      <Section title={t('owner:staff.profile.balances')} action={<AdjustSheet staff={staff} />}>
        <List>
          {(leave.data?.balances ?? staff.leaveBalances).map((b) => (
            <ListRow
              key={b.code}
              title={b.name}
              subtitle={
                b.pending > 0
                  ? t('owner:staff.profile.pendingLine', { count: b.pending })
                  : undefined
              }
              trailing={
                <span className="font-bold text-text tabular-nums">
                  {t('owner:staff.profile.balanceLine', { balance: days(b.balance) })}
                </span>
              }
            />
          ))}
        </List>
      </Section>
      <Section title={t('owner:staff.profile.ledger')}>
        <QueryView query={leave} skeleton={<RowsSkeleton rows={4} />}>
          {(view) => (
            <List>
              {view.ledger.map((row) => (
                <ListRow
                  key={row.id}
                  title={`${t(leaveKey(row.code))} · ${row.days > 0 ? '+' : ''}${days(row.days)}`}
                  subtitle={[shortDate(row.entryDate), row.note].filter(Boolean).join(' · ')}
                />
              ))}
            </List>
          )}
        </QueryView>
      </Section>
    </div>
  );
}

function AdjustSheet({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const adjust = useLeaveAdjust(staff.id);
  const fb = useMutationFeedback();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<LeaveCode>('CL');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const n = Number(amount);
  const valid = Number.isFinite(n) && n !== 0 && Number.isInteger(n * 2) && note.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:staff.profile.adjustForm.title', { name: staff.name.split(' ')[0] })}
      trigger={
        <Button size="sm" variant="secondary">
          {t('owner:staff.profile.adjust')}
        </Button>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          adjust.mutate(
            { code, days: n, note: note.trim() },
            {
              onSuccess: () => {
                setOpen(false);
                fb.ok();
              },
              onError: fb.fail,
            },
          );
        }}
      >
        <ChipGroup
          type="radio"
          legend={t('owner:staff.profile.adjustForm.type')}
          value={code}
          onValueChange={(c) => setCode(c as LeaveCode)}
          options={(['CL', 'SL', 'EL', 'CO'] as LeaveCode[]).map((c) => ({
            value: c,
            label: t(leaveKey(c)),
          }))}
        />
        <Field
          label={t('owner:staff.profile.adjustForm.days')}
          hint={t('owner:staff.profile.adjustForm.daysHint')}
        >
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('owner:staff.profile.adjustForm.note')} required>
          <Textarea
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={!valid} loading={adjust.isPending}>
            {t('owner:staff.profile.adjustForm.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function AdvancesTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  return (
    <Section title={t('owner:staff.profile.tabs.advances')}>
      <p className="font-bold text-lg text-text tabular-nums">
        {staff.advanceBalancePaise > 0
          ? t('owner:staff.profile.advanceBalance', { amount: money(staff.advanceBalancePaise) })
          : t('owner:staff.profile.noAdvance')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary" icon="currency-inr">
          <Link to={`/o/advances?user=${staff.id}&give=1`}>
            {t('owner:staff.profile.giveAdvance')}
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" iconEnd="arrow-right">
          <Link to={`/o/advances?user=${staff.id}`}>{t('owner:nav.advances')}</Link>
        </Button>
      </div>
    </Section>
  );
}

function DevicesTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const decide = useDecideDevice(staff.id);
  const reinvite = useReinvite(staff.id);
  const resetPin = useResetPin(staff.id);
  const fb = useMutationFeedback();
  const [invite, setInvite] = useState<InviteView | null>(null);
  const first = staff.name.split(' ')[0] ?? staff.name;
  const visible = staff.devices.filter((d) => d.status === 'approved' || d.status === 'pending');

  return (
    <div className="grid gap-8">
      <Section title={t('owner:staff.profile.tabs.devices')}>
        {visible.length === 0 ? (
          <Meta>{t('owner:staff.profile.devicesNone')}</Meta>
        ) : (
          <List>
            {visible.map((d) => (
              <ListRow
                key={d.id}
                title={d.label}
                subtitle={
                  d.status === 'approved' && d.approvedAt
                    ? t('owner:staff.profile.deviceApproved', {
                        date: shortDate(istDate(d.approvedAt)),
                      })
                    : t('owner:staff.profile.devicePending', {
                        date: shortDate(istDate(d.requestedAt)),
                      })
                }
                trailing={
                  d.status === 'pending' ? (
                    <span className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="check-circle"
                        loading={decide.isPending}
                        onClick={() =>
                          decide.mutate(
                            { deviceId: d.id, decision: 'approve' },
                            { onSuccess: () => fb.ok(), onError: fb.fail },
                          )
                        }
                      >
                        {t('owner:common.approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-secondary"
                        onClick={() =>
                          decide.mutate(
                            { deviceId: d.id, decision: 'reject' },
                            { onSuccess: () => fb.ok(), onError: fb.fail },
                          )
                        }
                      >
                        {t('owner:common.reject')}
                      </Button>
                    </span>
                  ) : (
                    <RevokeSheet staff={staff} deviceId={d.id} label={d.label} />
                  )
                }
              />
            ))}
          </List>
        )}
      </Section>
      <Section title={t('owner:staff.invite.code')}>
        {staff.invite ? (
          <Meta>
            {staff.invite.status === 'active'
              ? t('owner:staff.profile.inviteState.active', {
                  date: shortDate(istDate(staff.invite.expiresAt)),
                })
              : t(`owner:staff.profile.inviteState.${staff.invite.status}`)}
          </Meta>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Action
            hint={t('owner:staff.profile.resendHint')}
            button={
              <Button
                variant="secondary"
                icon="whatsapp-logo"
                loading={reinvite.isPending}
                onClick={() =>
                  reinvite.mutate(undefined, {
                    onSuccess: (r) => setInvite(r.invite),
                    onError: fb.fail,
                  })
                }
              >
                {t('owner:staff.profile.resendInvite')}
              </Button>
            }
          />
          <Action
            hint={t('owner:staff.profile.resetPinHint', { name: first })}
            button={
              <Button
                variant="secondary"
                icon="lock"
                loading={resetPin.isPending}
                onClick={() =>
                  resetPin.mutate(undefined, {
                    onSuccess: (r) => setInvite(r.invite),
                    onError: fb.fail,
                  })
                }
              >
                {t('owner:staff.profile.resetPin')}
              </Button>
            }
          />
        </div>
      </Section>
      <InviteSheet
        invite={invite}
        name={staff.name}
        open={invite !== null}
        onOpenChange={(o) => !o && setInvite(null)}
      />
    </div>
  );
}

function Action({ hint, button }: { hint: string; button: ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <div>{button}</div>
      <Meta>{hint}</Meta>
    </div>
  );
}

function RevokeSheet({
  staff,
  deviceId,
  label,
}: {
  staff: StaffDetail;
  deviceId: string;
  label: string;
}) {
  const { t } = useTranslation();
  const revoke = useRevokeDevice(staff.id);
  const fb = useMutationFeedback();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const first = staff.name.split(' ')[0] ?? staff.name;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:staff.profile.deviceRevokeTitle', { label })}
      description={t('owner:staff.profile.deviceRevokeBody', { name: first })}
      trigger={
        <Button size="sm" variant="danger-secondary">
          {t('owner:staff.profile.deviceRevoke')}
        </Button>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          revoke.mutate(
            { deviceId, reason: reason.trim() },
            {
              onSuccess: () => {
                setOpen(false);
                fb.ok();
              },
              onError: fb.fail,
            },
          );
        }}
      >
        <Field label={t('owner:common.reason')} required>
          <Textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="danger-secondary"
            loading={revoke.isPending}
            disabled={!reason.trim()}
          >
            {t('owner:staff.profile.deviceRevoke')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ExitTab({ staff }: { staff: StaffDetail }) {
  const { t } = useTranslation();
  const exit = useExitStaff(staff.id);
  const rehire = useRehire();
  const fb = useMutationFeedback();
  const [lastDay, setLastDay] = useState(() => istDate(Date.now()));
  const [reason, setReason] = useState('');
  const [invite, setInvite] = useState<InviteView | null>(null);
  const first = staff.name.split(' ')[0] ?? staff.name;

  if (staff.status === 'exited') {
    return (
      <Section title={t('owner:staff.profile.tabs.exit')}>
        <p className="text-text-body">
          {t('owner:staff.profile.exit.already', {
            name: first,
            date: staff.exitDate ? longDate(staff.exitDate) : '',
          })}
        </p>
        {staff.exitReason ? <Meta>{staff.exitReason}</Meta> : null}
        <div>
          <Button
            variant="secondary"
            icon="users"
            loading={rehire.isPending}
            onClick={() =>
              rehire.mutate(
                { id: staff.id, joinDate: istDate(Date.now()) },
                { onSuccess: (r) => setInvite(r.invite), onError: fb.fail },
              )
            }
          >
            {t('owner:staff.profile.exit.rehire', { name: first })}
          </Button>
        </div>
        <InviteSheet
          invite={invite}
          name={staff.name}
          open={invite !== null}
          onOpenChange={(o) => !o && setInvite(null)}
        />
      </Section>
    );
  }

  return (
    <Section title={t('owner:staff.profile.exit.title', { name: first })}>
      <p className="text-text-body">{t('owner:staff.profile.exit.body', { name: first })}</p>
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          exit.mutate(
            { lastDay, reason: reason.trim() },
            {
              onSuccess: () => fb.ok(t('owner:staff.profile.exit.done', { name: first })),
              onError: fb.fail,
            },
          );
        }}
      >
        <Field label={t('owner:staff.profile.exit.lastDay')}>
          <Input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </Field>
        <Field
          label={t('owner:staff.profile.exit.reason')}
          hint={t('owner:staff.profile.exit.needsPin')}
          required
        >
          <Textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="danger-secondary"
            loading={exit.isPending}
            disabled={!reason.trim()}
          >
            {t('owner:staff.profile.exit.confirm')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ProfileSkeleton() {
  return (
    <SkeletonGroup className="grid gap-6">
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" width="3.5rem" height="3.5rem" />
        <span className="grid flex-1 gap-2">
          <Skeleton width="10rem" />
          <Skeleton width="16rem" />
        </span>
      </div>
      <div className="flex gap-2">
        {[6, 5, 5, 5, 6, 5, 4].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder tabs
          <Skeleton key={i} shape="pill" width={`${w}rem`} height="2.75rem" />
        ))}
      </div>
      <RowsSkeleton rows={4} />
    </SkeletonGroup>
  );
}
