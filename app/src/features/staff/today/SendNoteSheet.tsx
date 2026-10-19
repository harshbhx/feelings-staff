/**
 * "Send to {{owner}}" for a punch waiting for proof (PRD 4.3.5, 4.4.4): a note and one button.
 * Its own chunk: Today only loads it when the person taps the button.
 */
import type { PunchView } from '@fs/contracts';
import { isApiError } from '@fs/contracts';
import { Button, Field, Sheet, Textarea, useToast } from '@fs/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../../../api/provider';
import { staffKeys, useOwnerName } from '../api';
import { useFmt } from '../lib/format';

export function SendNoteSheet({
  punch,
  open,
  onOpenChange,
}: {
  punch: PunchView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const fmt = useFmt();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('staff:punch.note.title', { owner })}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.punchRequestApproval({
              params: { id: punch.id },
              body: { note: note.trim(), placeName: null },
            });
            onOpenChange(false);
            toast({
              title: t('staff:punch.sent.body', { owner, time: fmt.clock(punch.effectiveTs) }),
            });
            void qc.invalidateQueries({ queryKey: staffKeys.today });
          } catch (err) {
            toast({
              tone: 'error',
              title: isApiError(err, 'UNAVAILABLE') ? t('errors:network') : t('errors:generic'),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label={t('staff:punch.note.label', { owner })}
          hint={t('staff:punch.note.hint')}
          optional
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={3}
          />
        </Field>
        <Button variant="primary" type="submit" block loading={busy}>
          {t('staff:punch.note.send', { owner })}
        </Button>
      </form>
    </Sheet>
  );
}
