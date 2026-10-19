/**
 * The invite share sheet (PRD 4.1.2): the join code big, the message, then Share (Web Share API),
 * Send on WhatsApp (`wa.me` link with the text) and Copy. Also used for PIN-reset links.
 */
import type { InviteView } from '@fs/contracts';
import { istDate } from '@fs/contracts';
import { Button, Sheet, useToast } from '@fs/ui';
import { useTranslation } from 'react-i18next';
import { clock, dayLabel } from '../lib/format';
import { canShare, copyText, shareNative } from '../lib/share';

export function InviteSheet({
  invite,
  name,
  open,
  onOpenChange,
}: {
  invite: InviteView | null;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const first = name.split(' ')[0] ?? name;
  if (!invite) return null;
  const share = { title: t('owner:staff.invite.title', { name: first }), text: invite.message };
  const native = canShare(share);
  const pinReset = invite.purpose === 'pin_reset';

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        pinReset
          ? t('owner:staff.invite.pinReset', { name: first })
          : t('owner:staff.invite.title', { name: first })
      }
      description={
        pinReset
          ? t('owner:staff.invite.pinResetBody', { name: first })
          : t('owner:staff.invite.body', { name: first })
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-1 rounded-md border border-border bg-bg-soft px-4 py-3">
          <span className="font-semibold text-sm text-text-muted">
            {t('owner:staff.invite.code')}
          </span>
          <span
            className="font-extrabold text-3xl text-text tracking-display tabular-nums"
            data-testid="invite-code"
          >
            {invite.code}
          </span>
          <span className="text-sm text-text-muted">
            {t('owner:staff.invite.expires', {
              time: clock(invite.expiresAt),
              date: dayLabel(istDate(invite.expiresAt)),
            })}
          </span>
        </div>
        <p className="whitespace-pre-line text-sm text-text-body">{invite.message}</p>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {native ? (
            <Button
              variant="primary"
              icon="share-network"
              onClick={async () => {
                await shareNative(share);
              }}
            >
              {t('owner:staff.invite.share')}
            </Button>
          ) : null}
          <Button asChild variant={native ? 'secondary' : 'primary'} icon="whatsapp-logo">
            <a href={invite.waLink} target="_blank" rel="noreferrer">
              {t('owner:staff.invite.whatsapp')}
            </a>
          </Button>
          <Button
            variant="secondary"
            icon="copy"
            onClick={async () => {
              const ok = await copyText(invite.message);
              toast({
                title: ok ? t('owner:staff.invite.copied') : t('owner:errors.generic'),
                tone: ok ? 'success' : 'error',
              });
            }}
          >
            {t('owner:staff.invite.copy')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
