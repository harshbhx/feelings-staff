/**
 * Owner-PIN sheet for step-up (PRD 4.1.7). Interim until WP-3's shared sheet lands; same contract:
 * open, verify the 6-digit owner PIN with POST /auth/step-up, then call onVerified.
 */
import { isApiError, type Me } from '@fs/contracts';
import { Button, Field, Input, Sheet } from '@fs/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { meQueryKey } from '../../../api/hooks';
import { useApi } from '../../../api/provider';

export function StepUpSheet({
  open,
  onVerified,
  onCancel,
}: {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: (value: string) => api.stepUp({ body: { pin: value } }),
    onSuccess: (res) => {
      qc.setQueryData<Me | null>(meQueryKey, (me) =>
        me ? { ...me, flags: { ...me.flags, stepUpUntil: res.stepUpUntil } } : me,
      );
      setPin('');
      setProblem(null);
      onVerified();
    },
    onError: (e) => {
      setPin('');
      if (isApiError(e, 'PIN_WRONG')) setProblem(e.message || t('owner:stepUp.wrong'));
      else if (isApiError(e, 'PIN_LOCKED')) setProblem(e.message || t('owner:stepUp.locked'));
      else setProblem(t('owner:errors.network'));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      setProblem(t('owner:stepUp.sixDigits'));
      return;
    }
    verify.mutate(pin);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPin('');
          setProblem(null);
          onCancel();
        }
      }}
      title={t('owner:stepUp.title')}
      description={t('owner:stepUp.body')}
    >
      <form onSubmit={submit} className="grid gap-5">
        <Field
          label={t('owner:stepUp.label')}
          hint={t('owner:stepUp.hint')}
          error={problem ?? undefined}
        >
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={verify.isPending}
            loadingLabel={t('owner:stepUp.checking')}
          >
            {t('owner:stepUp.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('owner:common.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
