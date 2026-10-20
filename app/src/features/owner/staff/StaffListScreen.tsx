/**
 * Staff list (PRD 5.2): search, filter (active, invited, left), rows with name, role, status and
 * phone state, and the one sindoor action, Add staff. The 15-active-staff cap is said plainly.
 */
import { MAX_ACTIVE_STAFF, type StaffRow } from '@fs/contracts';
import { Avatar, Banner, Button, ChipGroup, Field, Input, List, ListRow, StatusChip } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { StaffStatusFilter } from '../api/keys';
import { useStaffList } from '../api/staff';
import { Meta, NoBreakParts, WRAP_ROW } from '../components/layout';
import { Empty, QueryView, RowsSkeleton } from '../components/states';
import { shortDate } from '../lib/format';

const FILTERS: StaffStatusFilter[] = ['active', 'invited', 'exited', 'all'];

export function StaffListScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StaffStatusFilter>('active');
  const [q, setQ] = useState('');
  const list = useStaffList(filter, q);
  const active = useStaffList('active');
  const activeCount = active.data?.filter((s) => s.status !== 'exited').length ?? 0;
  const full = activeCount >= MAX_ACTIVE_STAFF;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('owner:staff.search')} labelHidden className="min-w-0 flex-1 basis-60">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('owner:staff.search')}
            autoComplete="off"
          />
        </Field>
        {!full ? (
          <Button asChild variant="primary" icon="plus">
            <Link to="/o/staff/new">{t('owner:staff.add')}</Link>
          </Button>
        ) : null}
      </div>
      {full ? (
        <Banner icon="users">{t('owner:staff.capReached', { count: MAX_ACTIVE_STAFF })}</Banner>
      ) : null}
      <ChipGroup
        type="radio"
        legend={t('owner:staff.filterLabel')}
        legendHidden
        layout="segmented"
        value={filter}
        onValueChange={(v) => setFilter(v as StaffStatusFilter)}
        options={FILTERS.map((f) => ({ value: f, label: t(`owner:staff.filters.${f}`) }))}
      />
      <QueryView
        query={list}
        skeleton={<RowsSkeleton rows={8} />}
        isEmpty={(rows) => rows.length === 0}
        empty={
          q || filter !== 'active' ? (
            <Empty>{t('owner:staff.emptyFilter')}</Empty>
          ) : (
            <Empty
              action={
                <Button asChild variant="secondary" icon="plus">
                  <Link to="/o/staff/new">{t('owner:staff.add')}</Link>
                </Button>
              }
            >
              {t('owner:staff.empty')}
            </Empty>
          )
        }
      >
        {(rows) => (
          <div className="grid gap-2">
            <Meta>{t('owner:staff.count', { count: rows.length })}</Meta>
            <List>
              {rows.map((s) => (
                <StaffListRow key={s.id} row={s} filter={filter} />
              ))}
            </List>
          </div>
        )}
      </QueryView>
    </div>
  );
}

function StaffListRow({ row, filter }: { row: StaffRow; filter: StaffStatusFilter }) {
  const { t } = useTranslation();
  const trailing =
    row.status === 'exited' ? (
      <StatusChip
        status="off"
        label={
          row.exitDate
            ? t('owner:staff.leftOn', { date: shortDate(row.exitDate) })
            : t('owner:staff.statusWord.exited')
        }
      />
    ) : row.status === 'invited' ? (
      <StatusChip status="waiting" label={t('owner:staff.statusWord.invited')} />
    ) : row.deviceState === 'pending' ? (
      <StatusChip status="flag" label={t('owner:staff.device.pending')} />
    ) : row.deviceState === 'none' ? (
      <StatusChip status="waiting" label={t('owner:staff.device.none')} />
    ) : filter === 'active' ? null : (
      // Under the Active filter every row would say "Active": only the exceptions get a chip.
      <StatusChip status="present" label={t('owner:staff.statusWord.active')} />
    );
  return (
    <ListRow
      asChild
      className={WRAP_ROW}
      leading={<Avatar name={row.name} />}
      title={row.name}
      subtitle={<NoBreakParts parts={[row.designation, row.employeeCode]} />}
      trailing={trailing}
    >
      <Link to={`/o/staff/${row.id}`} />
    </ListRow>
  );
}
