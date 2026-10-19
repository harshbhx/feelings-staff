/**
 * People and roles (PRD 2.2, 4.17, 10.2): managers and what each may do, for everyone or for some
 * staff. Making someone a manager or removing it needs the owner PIN.
 */
import type { Permission } from '@fs/contracts';
import { Button, ChipGroup, Field, List, ListRow, Select, Sheet, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { ownerKeys } from '../api/keys';
import { useOwnerMutation } from '../api/query';
import { useManagers } from '../api/settings';
import { useStaffList } from '../api/staff';
import { ConfirmButton } from '../components/ConfirmButton';
import { Meta } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';

const PERMISSIONS: Permission[] = [
  'approve_attendance',
  'approve_leave',
  'approve_overtime',
  'offsite',
  'roster',
  'door',
  'staff',
  'payroll',
  'exports',
];

function useFail() {
  const toast = useToast();
  const errorText = useErrorText();
  return (e: unknown) => {
    if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
  };
}

export function PeopleSection() {
  const { t } = useTranslation();
  const fail = useFail();
  const managers = useManagers();
  const remove = useOwnerMutation({
    run: (api, id: string, call) => api.ownerManagerRemove({ params: { id } }, call),
    invalidate: () => [ownerKeys.managers()],
  });
  return (
    <div className="grid max-w-(--container-narrow) grid-cols-[minmax(0,1fr)] gap-6">
      <Meta>{t('owner:settings.people.what')}</Meta>
      <QueryView
        query={managers}
        skeleton={<RowsSkeleton rows={2} />}
        isEmpty={(list) => list.length === 0}
        empty={<Meta>{t('owner:settings.people.none')}</Meta>}
      >
        {(list) => (
          <List>
            {list.map((m) => (
              <ListRow
                key={m.user.id}
                title={m.user.name}
                subtitle={m.permissions
                  .map((p) => t(`owner:settings.people.perms.${p}`))
                  .join(' · ')}
                trailing={
                  <ConfirmButton
                    size="sm"
                    label={t('owner:common.remove')}
                    title={t('owner:settings.people.removeTitle', { name: m.user.name })}
                    busy={remove.isPending}
                    onConfirm={(done) =>
                      remove.mutate(m.user.id, { onSuccess: done, onError: fail })
                    }
                  />
                }
              />
            ))}
          </List>
        )}
      </QueryView>
      <div>
        <AddManager />
      </div>
    </div>
  );
}

function AddManager() {
  const { t } = useTranslation();
  const toast = useToast();
  const fail = useFail();
  const staff = useStaffList('active');
  const upsert = useOwnerMutation({
    run: (api, body: { userId: string; permissions: Permission[]; staffIds: string[] }, call) =>
      api.ownerManagerUpsert({ body }, call),
    invalidate: () => [ownerKeys.managers()],
  });
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [perms, setPerms] = useState<string[]>(['approve_attendance', 'roster']);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('owner:settings.people.add')}
      description={t('owner:settings.people.addWhat')}
      trigger={
        <Button variant="secondary" icon="plus">
          {t('owner:settings.people.add')}
        </Button>
      }
      footer={
        <>
          <Button
            variant="primary"
            icon="lock"
            disabled={!userId || perms.length === 0 || upsert.isPending}
            onClick={() =>
              upsert.mutate(
                {
                  userId,
                  permissions: perms as Permission[],
                  staffIds: (staff.data ?? []).map((s) => s.id),
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    toast({ title: t('owner:settings.saved') });
                  },
                  onError: fail,
                },
              )
            }
          >
            {upsert.isPending ? t('owner:common.saving') : t('owner:common.save')}
          </Button>
          <Button onClick={() => setOpen(false)}>{t('owner:common.cancel')}</Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field label={t('owner:settings.people.person')}>
          <Select
            value={userId}
            onValueChange={setUserId}
            options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <ChipGroup
          type="checkbox"
          legend={t('owner:settings.people.may')}
          value={perms}
          onValueChange={setPerms}
          options={PERMISSIONS.map((p) => ({
            value: p,
            label: t(`owner:settings.people.perms.${p}`),
          }))}
        />
      </div>
    </Sheet>
  );
}
