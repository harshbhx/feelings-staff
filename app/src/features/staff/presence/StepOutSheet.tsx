/**
 * Step out (PRD 4.18.4, S-24.2): reason chips Personal, Lunch outside, Work errand, Other, an
 * optional note ("Bank for the salon"), and one button. The server stamps the time. Its own chunk:
 * Today loads it only when the person taps Step out.
 */
import type { AwayReason } from '@fs/contracts';
import { isApiError } from '@fs/contracts';
import { Button, ChipGroup, Field, hapticTick, Sheet, Textarea, useToast } from '@fs/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnerName } from '../api';
import { newPresenceKey } from './api';
import { STEP_OUT_REASONS } from './presence-model';
import { useStepOut } from './sheet-api';

export function StepOutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const toast = useToast();
  const stepOut = useStepOut();
  const [reason, setReason] = useState<AwayReason | null>(null);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const key = useRef<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setReason(null);
    setNote('');
    setMissing(false);
    key.current = null;
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={t('presence:sheet.title')}
      description={t('presence:sheet.who', { owner })}
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        data-testid="step-out-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason) {
            setMissing(true);
            return;
          }
          hapticTick();
          key.current ??= newPresenceKey();
          stepOut.mutate(
            { reason, note: note.trim(), key: key.current },
            {
              onSuccess: close,
              onError: (err) => {
                // No answer (offline, dropped reply): keep the key so a retry cannot repeat it.
                if (!isApiError(err, 'UNAVAILABLE')) key.current = null;
                toast({
                  tone: 'error',
                  title: isApiError(err, 'UNAVAILABLE')
                    ? t('errors:network')
                    : isApiError(err, 'CONFLICT')
                      ? t('presence:errors.cannotStepOut')
                      : t('errors:generic'),
                });
              },
            },
          );
        }}
      >
        <ChipGroup
          type="radio"
          legend={t('presence:sheet.reason')}
          layout="grid"
          required
          value={reason ?? ''}
          onValueChange={(v) => {
            setReason(v as AwayReason);
            setMissing(false);
          }}
          error={missing ? t('presence:sheet.reasonMissing') : undefined}
          options={STEP_OUT_REASONS.map((r) => ({
            value: r,
            label: t(`presence:reason.${r}`),
          }))}
        />
        <Field
          label={t('presence:sheet.note', { owner })}
          hint={t('presence:sheet.noteHint')}
          optional
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          size="lg"
          block
          icon="sign-out"
          loading={stepOut.isPending}
        >
          {t('presence:sheet.go')}
        </Button>
      </form>
    </Sheet>
  );
}
