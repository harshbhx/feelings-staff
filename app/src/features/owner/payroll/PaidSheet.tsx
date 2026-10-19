/** Date, how and an optional reference; shared by "Mark all paid" and one person's payslip. */
import type { PayMode } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, Sheet } from '@fs/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaidVars } from '../api/payroll';
import { todayIst } from '../lib/format';

const MODES: PayMode[] = ['cash', 'upi', 'bank'];

export function PaidSheet({
  who,
  trigger,
  primary,
  busy,
  onSave,
}: {
  who: string;
  trigger: ReactNode;
  primary: boolean;
  busy: boolean;
  onSave: (v: PaidVars, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(todayIst());
  const [mode, setMode] = useState<PayMode>('upi');
  const [ref, setRef] = useState('');
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:payroll.run.markPaidTitle', { who })}
      trigger={trigger}
      footer={
        <>
          <Button
            variant={primary ? 'primary' : 'secondary'}
            icon="check-circle"
            disabled={busy}
            onClick={() =>
              onSave(ref.trim() ? { paidOn, mode, ref: ref.trim() } : { paidOn, mode }, () =>
                setOpen(false),
              )
            }
          >
            {busy ? t('owner:common.saving') : t('owner:payroll.run.markPaid')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('owner:payroll.run.paidDate')}>
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <ChipGroup
          type="radio"
          legend={t('owner:payroll.run.paidMode')}
          value={mode}
          onValueChange={(m) => setMode(m as PayMode)}
          options={MODES.map((m) => ({ value: m, label: t(`owner:payroll.run.modes.${m}`) }))}
        />
        <Field
          label={t('owner:payroll.run.paidRef')}
          hint={t('owner:payroll.run.paidRefHint')}
          optional
        >
          <Input value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
