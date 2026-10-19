/**
 * Needs action (PRD 4.12, 5.2, O-04): one queue, grouped by type, with filter chips and counts.
 * Select several items of one type to approve them together (never devices). The only sindoor
 * button on this screen is "Approve selected"; per-item actions are outline buttons.
 */
import type { ActionItem, ActionsView, ActionType } from '@fs/contracts';
import { Button, ChipGroup, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { useActions, useBulkApprove } from '../api/attendance';
import { Section, useNow } from '../components/layout';
import { Empty, QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { ActionCard } from './ActionCard';
import {
  type BulkType,
  canBulk,
  filterChips,
  groupActions,
  openActionCount,
  toggleSelected,
} from './actions-model';

export function ActionsScreen() {
  const query = useActions();
  return (
    <QueryView
      query={query}
      skeleton={<RowsSkeleton rows={6} />}
      isEmpty={(v) => v.items.length === 0}
      empty={<AllClear />}
    >
      {(view) => <Queue view={view} />}
    </QueryView>
  );
}

function AllClear() {
  const { t } = useTranslation();
  return <Empty>{t('owner:actions.allClear')}</Empty>;
}

interface Selection {
  type: BulkType | null;
  ids: Set<string>;
}

function Queue({ view }: { view: ActionsView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const now = useNow();
  const [filter, setFilter] = useState<ActionType | null>(null);
  const [sel, setSel] = useState<Selection>({ type: null, ids: new Set() });
  const bulk = useBulkApprove();

  // Keep the selection to items that are still open.
  const openIds = new Set(view.items.map((i) => i.id));
  const selected = [...sel.ids].filter((id) => openIds.has(id));
  const groups = groupActions(view.items, filter);
  const chips = filterChips(view);

  const toggle = (item: ActionItem) => setSel((s) => toggleSelected(s, item));

  const approveSelected = () => {
    if (!sel.type || selected.length === 0) return;
    bulk.mutate(
      { type: sel.type, ids: selected },
      {
        onSuccess: (res) => {
          setSel({ type: null, ids: new Set() });
          toast(
            res.failed.length === 0
              ? { title: t('owner:actions.bulkDone', { count: res.done.length }), tone: 'success' }
              : {
                  title: t('owner:actions.bulkSomeFailed', {
                    done: res.done.length,
                    failed: res.failed.length,
                  }),
                  tone: 'error',
                },
          );
        },
        onError: (e) => {
          if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
        },
      },
    );
  };

  return (
    <div className="grid gap-6">
      {chips.length > 1 ? (
        <ChipGroup
          type="radio"
          legend={t('owner:actions.filterLabel')}
          legendHidden
          layout="scroll"
          value={filter ?? 'all'}
          onValueChange={(v) => setFilter(v === 'all' ? null : (v as ActionType))}
          options={[
            { value: 'all', label: t('owner:actions.all'), count: openActionCount(view) },
            ...chips.map((c) => ({
              value: c.type,
              label: t(`owner:actions.types.${c.type}`),
              count: c.count,
            })),
          ]}
        />
      ) : null}

      <div className="grid gap-8 xl:grid-cols-2 xl:items-start xl:gap-x-12">
        {groups.map((g) => (
          <Section
            key={g.type}
            title={t(`owner:actions.types.${g.type}`)}
            count={g.items.length}
            className="grid gap-1"
          >
            <ul className="grid">
              {g.items.map((item) => (
                <ActionCard
                  key={item.id}
                  item={item}
                  now={now}
                  selectable={canBulk(item.type)}
                  selected={sel.ids.has(item.id) && sel.type === item.type}
                  onToggle={() => toggle(item)}
                />
              ))}
            </ul>
          </Section>
        ))}
      </div>

      {selected.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-20 border-border border-t bg-(--bg-glass) backdrop-blur-[10px] xl:bottom-0 xl:left-(--owner-rail-w)">
          <section
            className="mx-auto flex max-w-(--container-page) flex-wrap items-center gap-3 px-(--gutter) py-3"
            aria-label={t('owner:common.selected', { count: selected.length })}
          >
            <p className="flex-1 font-bold text-text" aria-live="polite">
              {t('owner:common.selected', { count: selected.length })}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSel({ type: null, ids: new Set() })}
            >
              {t('owner:common.clearSelection')}
            </Button>
            <Button
              variant="primary"
              icon="check-circle"
              loading={bulk.isPending}
              loadingLabel={t('owner:common.saving')}
              onClick={approveSelected}
            >
              {t('owner:actions.approveSelected', { count: selected.length })}
            </Button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
