/**
 * One note on the time away (PRD 4.18.4 "Away note"; 9.4 `POST /me/presence/away/:id/note`): it
 * goes to the owner's item. Its own chunk, loaded when the person taps Add a note.
 */
import { isApiError } from '@fs/contracts';
import { Button, Field, Sheet, Textarea, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnerName } from '../api';
import { useAwayNote } from './api';

export function AwayNoteSheet({
  awayId,
  open,
  onOpenChange,
}: {
  awayId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const owner = useOwnerName();
  const toast = useToast();
  const save = useAwayNote();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('presence:note.title', { owner })}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) {
            setMissing(true);
            return;
          }
          save.mutate(
            { id: awayId, note: note.trim() },
            {
              onSuccess: () => {
                onOpenChange(false);
                toast({ tone: 'success', title: t('presence:note.sent', { owner }) });
              },
              onError: (err) =>
                toast({
                  tone: 'error',
                  title: isApiError(err, 'UNAVAILABLE') ? t('errors:network') : t('errors:generic'),
                }),
            },
          );
        }}
      >
        <Field
          label={t('presence:note.label')}
          hint={t('presence:note.hint', { owner })}
          error={missing ? t('presence:note.missing') : undefined}
        >
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setMissing(false);
            }}
            maxLength={300}
            rows={3}
          />
        </Field>
        <Button variant="primary" type="submit" block loading={save.isPending}>
          {t('presence:note.send')}
        </Button>
      </form>
    </Sheet>
  );
}
