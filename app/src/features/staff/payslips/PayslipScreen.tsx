/**
 * One payslip (`/payslips/:id`, PRD 4.14, 5.1; AC S-14): the same figures as the PDF, every line
 * with its formula, Download PDF and Share. A settlement shows only as "Time adjustment" (7.17.9).
 * Its own lazy chunk; the route loads the `payslip` catalog.
 */
import type { PayslipView } from '@fs/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  List,
  ListRow,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '@fs/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApi } from '../../../api/provider';
import { asFile, shareNative } from '../../owner/lib/share';
import { useOwnerName, usePayslip } from '../api';
import { type Fmt, useFmt } from '../lib/format';
import { ActionBar } from '../shell/ActionBar';
import { QueryError } from '../shell/ScreenFallback';
import { ScreenHeader } from '../shell/ScreenHeader';
import { type PayslipRow, payslipSections } from './payslip-model';

export function PayslipScreen() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const { id = '' } = useParams();
  const slip = usePayslip(id);
  const title = slip.data ? fmt.month(slip.data.month) : t('staff:screens.payslip');
  return (
    <>
      <ScreenHeader title={title} back="/payslips" dataAt={slip.dataUpdatedAt || undefined} />
      <main id="main" className="staff-main flex flex-col gap-4">
        {slip.data ? (
          <Body view={slip.data} />
        ) : slip.isError ? (
          <QueryError
            error={slip.error}
            message={t('staff:payslips.loadError')}
            onRetry={() => void slip.refetch()}
          />
        ) : (
          <SkeletonGroup label={t('common:states.loading')} className="flex flex-col gap-4">
            <Skeleton shape="block" height="6rem" />
            <Skeleton shape="block" height="10rem" />
            <Skeleton shape="block" height="8rem" />
          </SkeletonGroup>
        )}
      </main>
      {slip.data ? <Actions view={slip.data} /> : null}
    </>
  );
}

function Body({ view }: { view: PayslipView }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const owner = useOwnerName();
  const r = view.result;
  const sections = payslipSections(view);
  const c = r.counts;
  return (
    <>
      {view.status === 'superseded' ? (
        <Banner icon="clock" tone="plain">
          {t('staff:payslips.superseded')}
        </Banner>
      ) : null}

      <Card tone="soft">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-text-muted">{t('staff:payslips.net')}</p>
          <p className="text-3xl font-bold text-text tabular" data-testid="payslip-net">
            {fmt.rupees(r.netPaise)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {view.paid ? (
              <Badge tone="success" icon="check-circle">
                {t('staff:payslips.paid', {
                  date: fmt.date(view.paid.on),
                  mode: t(`staff:payslips.mode.${view.paid.mode}`),
                })}
              </Badge>
            ) : (
              <Badge tone="neutral" icon="clock">
                {t('staff:payslips.notPaid')}
              </Badge>
            )}
            {view.revision > 1 ? (
              <Badge tone="outline" icon="clock">
                {t('staff:payslips.revision', { n: view.revision })}
              </Badge>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={t('staff:payslips.days')}>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular">
          <dt className="text-text-muted">{t('payslip:days.inMonth')}</dt>
          <dd className="text-right">{r.daysInMonth}</dd>
          <dt className="text-text-muted">{t('payslip:days.paid')}</dt>
          <dd className="text-right">{c.paidDays}</dd>
          <dt className="text-text-muted">{t('payslip:days.counts')}</dt>
          <dd className="text-right">{`P ${c.P} · H ${c.H} · A ${c.A} · L ${c.L} · WO ${c.WO} · HO ${c.HO}`}</dd>
          <dt className="text-text-muted">{t('payslip:rate', { days: r.divisorDays })}</dt>
          <dd className="text-right">{fmt.rupees(r.dailyRatePaise)}</dd>
        </dl>
      </Card>

      <Card
        title={t('staff:payslips.earnings')}
        flush
        footer={<TotalLine label={t('staff:payslips.gross')} value={fmt.rupees(r.grossPaise)} />}
      >
        <Rows rows={sections.earnings} fmt={fmt} owner={owner} month={view.month} sign="+" />
      </Card>

      <Card
        title={t('staff:payslips.deductions')}
        flush
        footer={
          <TotalLine label={t('payslip:totalDeductions')} value={fmt.rupees(r.deductionsPaise)} />
        }
      >
        <Rows rows={sections.deductions} fmt={fmt} owner={owner} month={view.month} sign="−" />
      </Card>

      {sections.rounding.length ? (
        <p className="flex justify-between gap-4 px-1 text-sm text-text-muted tabular">
          <span>{t('payslip:rounding')}</span>
          <span>{fmt.rupees(r.roundingPaise)}</span>
        </p>
      ) : null}

      {view.leaveBalances.length ? (
        <Card title={t('payslip:leaveBalances')} flush>
          <List>
            {view.leaveBalances.map((b) => (
              <ListRow
                key={b.code}
                title={b.name}
                trailing={<span className="font-bold text-text tabular">{b.balance}</span>}
              />
            ))}
          </List>
        </Card>
      ) : null}
    </>
  );
}

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4 font-bold text-text tabular">
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}

function Rows({
  rows,
  fmt,
  owner,
  month,
  sign,
}: {
  rows: PayslipRow[];
  fmt: Fmt;
  owner: string;
  month: string;
  sign: '+' | '−';
}) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="px-4 pb-3 text-sm text-text-muted">{t('payslip:none')}</p>;
  return (
    <List>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          title={row.kind === 'adjustment' ? t('staff:payslips.timeAdjustment') : row.label}
          subtitle={
            row.kind === 'adjustment'
              ? t('staff:payslips.timeAdjustmentNote', { owner, month: fmt.month(month) })
              : row.formula
          }
          trailing={
            <span className="font-bold text-text tabular">
              {sign}
              {fmt.rupees(row.amountPaise)}
            </span>
          }
        />
      ))}
    </List>
  );
}

/** Download and Share (PDF ready), "Preparing" meanwhile, Print when the PDF could not be made. */
function Actions({ view }: { view: PayslipView }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const api = useApi();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const monthLabel = fmt.month(view.month);

  if (view.pdfStatus === 'pending')
    return (
      <ActionBar>
        <Button block variant="secondary" icon="clock" disabled>
          {t('staff:payslips.preparing')}
        </Button>
      </ActionBar>
    );

  if (view.pdfStatus === 'failed' || !view.pdfUrl)
    return (
      <ActionBar>
        <p className="text-sm text-text-muted" role="status">
          {t('staff:payslips.pdfFailed')}
        </p>
        <Button block variant="primary" icon="file-pdf" onClick={() => window.print()}>
          {t('staff:payslips.print')}
        </Button>
      </ActionBar>
    );

  const url = view.pdfUrl;
  const share = async () => {
    setSharing(true);
    try {
      const text = t('staff:payslips.shareText', { month: monthLabel, url: view.verifyUrl ?? '' });
      const title = t('staff:payslips.shareTitle', { month: monthLabel });
      // Level 2 first: the PDF itself. Then the link by WhatsApp.
      let outcome: Awaited<ReturnType<typeof shareNative>> = 'unsupported';
      if (view.id) {
        const blob = await api.payslipPdf({ params: { id: view.id } });
        outcome = await shareNative({
          title,
          text,
          files: [asFile(blob, `payslip-${view.month}.pdf`)],
        });
      }
      if (outcome === 'unsupported')
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch {
      toast({ tone: 'error', title: t('errors:generic') });
    } finally {
      setSharing(false);
    }
  };
  return (
    <ActionBar>
      <Button variant="primary" icon="file-pdf" block asChild>
        <a href={url} download={`payslip-${view.month}.pdf`}>
          {t('staff:payslips.download')}
        </a>
      </Button>
      <Button
        variant="secondary"
        icon="share-network"
        loading={sharing}
        onClick={() => void share()}
      >
        {t('staff:payslips.share')}
      </Button>
    </ActionBar>
  );
}
