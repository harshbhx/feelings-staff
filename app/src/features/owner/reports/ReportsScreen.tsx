/**
 * Reports (PRD 4.16, 5.2, O-15): one month for every file, then a card per export with its format
 * (CSV everywhere, PDF for the two registers) and **Make file** (the server asks for the owner PIN),
 * and the recent files with Download for 7 days. Files are made in the background; the list checks
 * every 3 s while one is still being made.
 */
import type { ExportFormat, ExportKind, ExportView } from '@fs/contracts';
import { Button, ChipGroup, Field, Input, List, ListRow, StatusChip, useToast } from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStepUpCancelled } from '../../auth/step-up';
import { useCreateExport, useExportFileUrl, useExports } from '../api/payroll';
import { Meta, Section, WRAP_ROW } from '../components/layout';
import { QueryView, RowsSkeleton, useErrorText } from '../components/states';
import { monthLabel, shortDate, todayIst } from '../lib/format';
import { previousMonth } from '../payroll/run-model';

const KINDS: ExportKind[] = [
  'register',
  'salary_register',
  'punches',
  'late_early',
  'overtime',
  'leave',
  'advances',
  'exceptions',
  'audit',
];
const WITH_PDF = new Set<ExportKind>(['register', 'salary_register']);

export function ReportsScreen() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(previousMonth(todayIst()));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid max-w-(--container-narrow) gap-3">
        <Meta>{t('owner:reports.lead')}</Meta>
        <Field label={t('owner:reports.month')} className="max-w-60">
          <Input
            type="month"
            value={month}
            max={todayIst().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {KINDS.map((k) => (
          <ExportCard key={k} kind={k} month={month} />
        ))}
      </ul>
      <Recent />
    </div>
  );
}

function ExportCard({ kind, month }: { kind: ExportKind; month: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const create = useCreateExport();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const pdf = WITH_PDF.has(kind);
  return (
    <li className="grid content-between gap-4 rounded-md border border-border p-4">
      <div className="grid gap-1">
        <h2 className="font-bold text-lg text-text">{t(`owner:reports.kinds.${kind}.title`)}</h2>
        <p className="text-sm text-text-muted">{t(`owner:reports.kinds.${kind}.body`)}</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {pdf ? (
          <ChipGroup
            type="radio"
            legend={t('owner:reports.format')}
            legendHidden
            value={format}
            onValueChange={(f) => setFormat(f as ExportFormat)}
            options={(['csv', 'pdf'] as const).map((f) => ({
              value: f,
              label: t(`owner:reports.formats.${f}`),
            }))}
          />
        ) : (
          <Meta>{t('owner:reports.formats.csv')}</Meta>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={format === 'pdf' && pdf ? 'file-pdf' : 'chart-bar'}
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { kind, month, format: pdf ? format : 'csv' },
              {
                onSuccess: () => toast({ title: t('owner:reports.queued') }),
                onError: (e) => {
                  if (!isStepUpCancelled(e)) toast({ title: errorText(e), tone: 'error' });
                },
              },
            )
          }
        >
          {create.isPending ? t('owner:reports.making') : t('owner:reports.make')}
        </Button>
      </div>
    </li>
  );
}

const STATUS_CHIP = { queued: 'waiting', ready: 'present', failed: 'absent' } as const;

function Recent() {
  const { t } = useTranslation();
  const exports = useExports();
  return (
    <Section title={t('owner:reports.recent')} className="grid max-w-(--container-narrow) gap-2">
      <QueryView
        query={exports}
        skeleton={<RowsSkeleton rows={3} />}
        isEmpty={(list) => list.length === 0}
        empty={<Meta>{t('owner:reports.noRecent')}</Meta>}
      >
        {(list) => (
          <List>
            {list.map((e) => (
              <RecentRow key={e.id} file={e} />
            ))}
          </List>
        )}
      </QueryView>
    </Section>
  );
}

function RecentRow({ file }: { file: ExportView }) {
  const { t } = useTranslation();
  const fileUrl = useExportFileUrl();
  return (
    <ListRow
      className={WRAP_ROW}
      title={`${t(`owner:reports.kinds.${file.kind}.title`)} · ${monthLabel(file.month)}`}
      subtitle={`${t(`owner:reports.formats.${file.format}`)} · ${t('owner:reports.expires', { date: shortDate(todayIst(file.expiresAt)) })}`}
      trailing={
        file.status === 'ready' ? (
          <Button
            asChild
            size="sm"
            variant="secondary"
            icon={file.format === 'pdf' ? 'file-pdf' : 'chart-bar'}
          >
            <a href={file.fileUrl ?? fileUrl(file.id)} download={file.fileName}>
              {t('owner:reports.download')}
            </a>
          </Button>
        ) : (
          <StatusChip
            status={STATUS_CHIP[file.status]}
            label={t(`owner:reports.status.${file.status}`)}
          />
        )
      }
    />
  );
}
