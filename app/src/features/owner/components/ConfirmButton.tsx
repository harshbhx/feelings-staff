/**
 * A destructive action with a confirm step (PRD 12.2): an outline pill in --status-absent that opens
 * a sheet saying what will happen, with the same action again to confirm and Cancel.
 */
import { Button, Sheet } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ConfirmButton({
  label,
  title,
  body,
  busy = false,
  size,
  onConfirm,
}: {
  label: string;
  title: string;
  body?: string;
  busy?: boolean;
  size?: 'sm';
  /** Call `done` once the action succeeded, to close the sheet. */
  onConfirm: (done: () => void) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={body}
      trigger={
        <Button variant="danger-secondary" size={size}>
          {label}
        </Button>
      }
      footer={
        <>
          <Button
            variant="danger-secondary"
            disabled={busy}
            onClick={() => onConfirm(() => setOpen(false))}
          >
            {busy ? t('owner:common.saving') : label}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    />
  );
}
