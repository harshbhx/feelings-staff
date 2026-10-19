/**
 * Audit log (PRD 10.7, 5.2, O-18): who changed what, newest first. Filters by kind (changes,
 * security, who looked at what, exports) and by date; each row reads "Urmi · Day edited",
 * before -> after in words, the reason, and the time. Read-only: nothing here can be edited.
 */
import type { AuditCategory, AuditEntryView } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, List } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudit } from '../api/settings';
import { CHIPS_WRAP, Meta } from '../components/layout';
import { Empty, ErrorCard, RowsSkeleton } from '../components/states';
import { clock, shortDate, todayIst } from '../lib/format';
import { describeChange } from './audit-model';

const CATEGORIES: (AuditCategory | 'all')[] = ['all', 'change', 'security', 'access', 'export'];

export function AuditScreen() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const audit = useAudit({
    ...(category !== 'all' ? { category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-6">
      <ChipGroup
        type="radio"
        legend={t('owner:audit.filter')}
        legendHidden
        layout="scroll"
        className={CHIPS_WRAP}
        value={category}
        onValueChange={(v) => setCategory(v as AuditCategory | 'all')}
        options={CATEGORIES.map((c) => ({ value: c, label: t(`owner:audit.categories.${c}`) }))}
      />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Field label={t('owner:audit.from')}>
          <Input
            type="date"
            value={from}
            max={to || todayIst()}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t('owner:audit.to')}>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            max={todayIst()}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {audit.isError && items.length === 0 ? (
        <ErrorCard error={audit.error} onRetry={() => void audit.refetch()} />
      ) : audit.isPending ? (
        <RowsSkeleton rows={6} />
      ) : items.length === 0 ? (
        <Empty>{t('owner:audit.empty')}</Empty>
      ) : (
        <>
          <List>
            {items.map((e) => (
              <AuditRow key={e.id} entry={e} />
            ))}
          </List>
          {audit.hasNextPage ? (
            <div>
              <Button
                variant="secondary"
                disabled={audit.isFetchingNextPage}
                onClick={() => void audit.fetchNextPage()}
              >
                {audit.isFetchingNextPage ? t('owner:common.loading') : t('owner:audit.more')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AuditRow({ entry: e }: { entry: AuditEntryView }) {
  const { t } = useTranslation();
  const who = e.actorName ?? t(`owner:audit.actors.${e.actorType}`);
  const change = describeChange(e.before, e.after);
  return (
    <li className="fs-list__item grid gap-1 py-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-bold text-text">
          {who} ·{' '}
          {t(`owner:audit.actions.${e.action.replaceAll('.', '_')}`, { defaultValue: e.action })}
        </span>
        <span className="text-sm text-text-muted tabular-nums">
          {shortDate(todayIst(e.createdAt))} {clock(e.createdAt)}
        </span>
      </p>
      {change.length > 0 ? (
        <ul className="grid gap-0.5 text-sm text-text-body">
          {change.map((c) => (
            <li key={c.key} className="break-words">
              <span className="text-text-muted">{c.key}: </span>
              {c.before ?? '–'} → {c.after ?? '–'}
            </li>
          ))}
        </ul>
      ) : null}
      {e.reason ? <Meta>{t('owner:audit.reason', { reason: e.reason })}</Meta> : null}
    </li>
  );
}
