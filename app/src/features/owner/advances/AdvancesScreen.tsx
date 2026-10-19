/**
 * Advances (PRD 4.10, 5.2, O-12): who still owes what, every advance with its plan, how much is
 * recovered, and whether the staff member confirmed it. **Give an advance** (the one sindoor action)
 * records amount, date, how it was paid, the reason, the recovery plan (full next month or 2-12
 * instalments) and the first recovery month, and can ask the person to confirm in the app.
 * `?user=<id>&give=1` (from a staff profile) opens the sheet for that person.
 */
import type { AdvanceCreate, AdvanceView, PayMode } from '@fs/contracts';
import {
  Button,
  ChipGroup,
  Field,
  Input,
  List,
  ListRow,
  Select,
  Sheet,
  StatusChip,
  Stepper,
  Switch,
  Textarea,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { isStepUpCancelled } from '../../auth/step-up';
import { useAdvances, useCancelAdvance, useGiveAdvance } from '../api/payroll';
import { useStaffList } from '../api/staff';
import { Meta, Section, WRAP_ROW } from '../components/layout';
import { Empty, QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { money, monthLabel, shortDate, todayIst } from '../lib/format';
import { rupeesToPaise } from '../staff/staff-form';

const MODES: PayMode[] = ['cash', 'upi', 'bank'];
const firstName = (name: string) => name.split(' ')[0] ?? name;

export function AdvancesScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [all, setAll] = useState(false);
  const user = params.get('user') ?? undefined;
  const advances = useAdvances(undefined, all ? 'all' : 'open');
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-8">
      <div>
        <GiveSheet initialUser={user} openAtStart={params.get('give') === '1'} />
      </div>
      <QueryView
        query={advances}
        skeleton={<RowsSkeleton rows={4} />}
        isEmpty={(v) => v.items.length === 0 && v.balances.length === 0}
        empty={<Empty>{t('owner:advances.empty')}</Empty>}
      >
        {(view) => (
          <>
            <Section title={t('owner:advances.balances')}>
              <List>
                {view.balances
                  .filter((b) => b.balancePaise > 0)
                  .map((b) => (
                    <ListRow
                      key={b.user.id}
                      title={b.user.name}
                      subtitle={b.user.designation ?? undefined}
                      trailing={
                        <span className="font-bold text-text tabular-nums">
                          {money(b.balancePaise)}
                        </span>
                      }
                    />
                  ))}
              </List>
            </Section>
            <Section title={t('owner:advances.ledger')}>
              <Switch label={t('owner:advances.all')} checked={all} onCheckedChange={setAll} />
              <List>
                {view.items.map((a) => (
                  <AdvanceRow key={a.id} advance={a} />
                ))}
              </List>
            </Section>
          </>
        )}
      </QueryView>
    </div>
  );
}

const STATUS_CHIP = {
  requested: 'waiting',
  active: 'flag',
  closed: 'present',
  rejected: 'off',
  cancelled: 'off',
} as const;

function AdvanceRow({ advance: a }: { advance: AdvanceView }) {
  const { t } = useTranslation();
  const first = firstName(a.user.name);
  const lines = [
    a.givenOn && a.mode
      ? t('owner:advances.line', {
          amount: money(a.amountPaise),
          date: shortDate(a.givenOn),
          mode: t(`owner:payroll.run.modes.${a.mode}`),
        })
      : t('owner:advances.asked', { amount: money(a.amountPaise) }),
    a.plan === 'full'
      ? t('owner:advances.planLine.full', { month: monthLabel(a.firstMonth) })
      : t('owner:advances.planLine.instalments', {
          n: a.instalmentsN ?? 2,
          month: monthLabel(a.firstMonth),
        }),
    t('owner:advances.recovered', {
      recovered: money(a.recoveredPaise),
      balance: money(a.balancePaise),
    }),
    t(`owner:advances.ackStatus.${a.staffAck}`, { name: first }),
  ];
  return (
    <ListRow
      className={WRAP_ROW}
      title={a.reason ? `${a.user.name} · ${a.reason}` : a.user.name}
      subtitle={
        <span className="grid tabular-nums">
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </span>
      }
      trailing={
        <span className="flex flex-wrap items-center justify-end gap-2">
          <StatusChip
            status={STATUS_CHIP[a.status]}
            label={t(`owner:advances.status.${a.status}`)}
          />
          {a.status === 'active' && a.recoveredPaise === 0 ? <CancelAdvance id={a.id} /> : null}
        </span>
      }
    />
  );
}

function CancelAdvance({ id }: { id: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const cancel = useCancelAdvance();
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:advances.cancelTitle')}
      description={t('owner:advances.cancelBody')}
      trigger={
        <Button size="sm" variant="danger-secondary">
          {t('owner:advances.cancel')}
        </Button>
      }
      footer={
        <>
          <Button
            variant="danger-secondary"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(id, {
                onSuccess: () => setOpen(false),
                onError: (e) => {
                  if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
                },
              })
            }
          >
            {t('owner:advances.cancel')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.close')}</Button>
        </>
      }
    />
  );
}

function GiveSheet({
  initialUser,
  openAtStart,
}: {
  initialUser: string | undefined;
  openAtStart: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const staff = useStaffList('active');
  const give = useGiveAdvance();
  const today = todayIst();
  const [open, setOpen] = useState(openAtStart);
  const [userId, setUserId] = useState(initialUser ?? '');
  const [amount, setAmount] = useState('');
  const [givenOn, setGivenOn] = useState(today);
  const [mode, setMode] = useState<PayMode>('cash');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<'full' | 'instalments'>('full');
  const [n, setN] = useState(3);
  // The next payroll is this month's, made on the 1st of next month.
  const [firstMonth, setFirstMonth] = useState(today.slice(0, 7));
  const [ack, setAck] = useState(true);
  const [tried, setTried] = useState(false);
  const paise = rupeesToPaise(amount);
  const person = staff.data?.find((s) => s.id === userId);
  const problems = {
    person: userId ? undefined : t('owner:advances.errors.person'),
    amount: paise !== null && paise > 0 ? undefined : t('owner:advances.errors.amount'),
  };

  const save = () => {
    setTried(true);
    if (problems.person || problems.amount || paise === null) return;
    const body: AdvanceCreate = {
      userId,
      amountPaise: paise,
      givenOn,
      mode,
      plan,
      firstMonth,
      askStaffAck: ack,
      ...(plan === 'instalments' ? { instalmentsN: n } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    give.mutate(body, {
      onSuccess: () => {
        setOpen(false);
        setAmount('');
        setReason('');
        setTried(false);
        toast({ title: t('owner:advances.saved', { name: firstName(person?.name ?? '') }) });
      },
      onError: (e) => {
        if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
      },
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={
        person
          ? t('owner:advances.giveTo', { name: firstName(person.name) })
          : t('owner:advances.give')
      }
      trigger={
        <Button variant="primary" icon="currency-inr">
          {t('owner:advances.give')}
        </Button>
      }
      footer={
        <>
          <Button variant="primary" disabled={give.isPending} onClick={save}>
            {give.isPending ? t('owner:common.saving') : t('owner:advances.save')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('owner:advances.person')} error={tried ? problems.person : undefined}>
          <Select
            value={userId}
            onValueChange={setUserId}
            options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <Field label={t('owner:advances.amount')} error={tried ? problems.amount : undefined}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('owner:advances.givenOn')}>
          <Input
            type="date"
            value={givenOn}
            max={today}
            onChange={(e) => setGivenOn(e.target.value)}
          />
        </Field>
        <ChipGroup
          type="radio"
          legend={t('owner:advances.mode')}
          value={mode}
          onValueChange={(m) => setMode(m as PayMode)}
          options={MODES.map((m) => ({ value: m, label: t(`owner:payroll.run.modes.${m}`) }))}
        />
        <Field label={t('owner:advances.reason')} optional>
          <Textarea
            value={reason}
            rows={2}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ChipGroup
          type="radio"
          legend={t('owner:advances.plan')}
          value={plan}
          onValueChange={(p) => setPlan(p as 'full' | 'instalments')}
          options={(['full', 'instalments'] as const).map((p) => ({
            value: p,
            label: t(`owner:advances.plans.${p}`),
          }))}
        />
        {plan === 'instalments' ? (
          <Stepper
            label={t('owner:advances.instalments')}
            value={n}
            onValueChange={setN}
            min={2}
            max={12}
          />
        ) : null}
        <Field label={t('owner:advances.firstMonth')}>
          <Input type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} />
        </Field>
        <Switch
          label={
            person
              ? t('owner:advances.ack', { name: firstName(person.name) })
              : t('owner:advances.ackShort')
          }
          checked={ack}
          onCheckedChange={setAck}
        />
        {tried && (problems.person || problems.amount) ? (
          <Meta>{[problems.person, problems.amount].filter(Boolean).join(' ')}</Meta>
        ) : null}
      </div>
    </Sheet>
  );
}
