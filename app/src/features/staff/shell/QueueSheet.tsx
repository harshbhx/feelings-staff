/**
 * The offline queue, explained (PRD 4.3.6): each waiting or failed check-in with its time, why it
 * failed in words, and a human fallback (tell the owner on WhatsApp with the time prefilled).
 */
import type { ErrorCode } from '@fs/contracts';
import { Button, List, ListRow, Sheet, StatusChip } from '@fs/ui';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { flush, type QueuedPunch, removeQueued, retryQueued, useQueue } from '../../../pwa/queue';
import { useOwnerName, useStaffMe } from '../api';
import { useFmt } from '../lib/format';
import { whatsappLink } from '../lib/links';

export function QueueSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queue = useQueue();
  const owner = useOwnerName();
  const me = useStaffMe();
  const fmt = useFmt();

  const label = (item: QueuedPunch) =>
    item.request.kind === 'out'
      ? t('staff:queue.itemOut', { time: fmt.clock(item.request.clientTs) })
      : t('staff:queue.itemIn', { time: fmt.clock(item.request.clientTs) });

  const reason = (code: ErrorCode) => t(`errors:code.${code}`, { owner });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('staff:queue.title')}>
      <p className="mb-4 text-sm text-text-muted">{t('staff:queue.explain')}</p>
      <List framed>
        {queue.items.map((item) => (
          <Fragment key={item.idempotencyKey}>
            <ListRow
              title={label(item)}
              subtitle={
                item.status === 'failed' && item.lastError
                  ? t('staff:queue.why', { reason: reason(item.lastError.code) })
                  : undefined
              }
              trailing={
                <StatusChip
                  status={item.status === 'failed' ? 'flag' : 'waiting'}
                  label={
                    item.status === 'failed'
                      ? t('staff:queue.failed')
                      : item.status === 'sending'
                        ? t('staff:queue.sending')
                        : t('staff:queue.waiting')
                  }
                />
              }
            />
            {item.status === 'failed' ? (
              <li className="fs-list__item flex flex-wrap gap-2 pb-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void retryQueued(item.idempotencyKey)}
                >
                  {t('staff:queue.retry')}
                </Button>
                {me.org.contactPhone ? (
                  <Button size="sm" variant="secondary" icon="whatsapp-logo" asChild>
                    <a
                      href={whatsappLink(
                        me.org.contactPhone,
                        `${label(item)}. ${item.lastError ? reason(item.lastError.code) : ''}`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('staff:queue.sendToOwner', { owner })}
                    </a>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="danger-secondary"
                  onClick={() => {
                    if (window.confirm(t('staff:queue.removeConfirm')))
                      void removeQueued(item.idempotencyKey);
                  }}
                >
                  {t('staff:queue.remove')}
                </Button>
              </li>
            ) : null}
          </Fragment>
        ))}
      </List>
      {queue.waiting > 0 ? (
        <div className="mt-4">
          <Button variant="secondary" block onClick={() => void flush()}>
            {t('staff:queue.retry')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
