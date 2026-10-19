/**
 * Payslip verify page (PRD 4.14, 5.2, O-14.3), public at `/v/:token`: the QR on a payslip PDF opens
 * it. Shows only the allowed fields: salon name, the staff member's first name and initial, month,
 * net pay, revision, and whether it is valid or replaced. A malformed or unknown link says
 * "This payslip link isn't valid." No sign-in, no other data.
 */
import { isApiError, type PayslipVerify } from '@fs/contracts';
import { Bindi, Button, Skeleton, SkeletonGroup, StatusChip } from '@fs/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApi } from '../../api/provider';
import { held, retryUnlessHeld } from '../owner/api/mock-states';
import { money, monthLabel } from '../owner/lib/format';

/** Tokens are 16-40 URL-safe characters (contracts `VerifyTokenParams`); anything else is not ours. */
export function plausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,40}$/.test(token);
}

export function VerifyScreen() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const api = useApi();
  const plausible = plausibleToken(token);
  const query = useQuery({
    queryKey: ['public', 'verify', token],
    queryFn: () => held('verifyPayslip', () => api.verifyPayslip({ params: { token } })),
    retry: retryUnlessHeld('verifyPayslip'),
    enabled: plausible,
    staleTime: 5 * 60_000,
  });

  let body: ReactNode;
  const unknown =
    !plausible ||
    (query.data && !query.data.valid) ||
    isApiError(query.error, 'NOT_FOUND') ||
    isApiError(query.error, 'VALIDATION');
  if (unknown) body = <Invalid />;
  else if (query.data) body = <Result v={query.data} />;
  else if (query.isError)
    body = (
      <div role="alert" className="grid gap-3" data-testid="verify-error">
        <p className="text-text-body">{t('owner:errors.network')}</p>
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon="arrows-clockwise"
            onClick={() => void query.refetch()}
          >
            {t('owner:common.retry')}
          </Button>
        </div>
      </div>
    );
  else
    body = (
      <SkeletonGroup label={t('owner:common.loading')} className="grid gap-3">
        <Skeleton shape="pill" width="5rem" height="1.75rem" />
        <Skeleton width="70%" />
        <Skeleton width="55%" />
        <Skeleton width="60%" />
      </SkeletonGroup>
    );

  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto grid w-full max-w-[30rem] gap-6 px-(--gutter) py-10">
        <p className="flex items-center gap-1 font-extrabold text-maroon-800 text-xl tracking-display">
          {t('common:app.shortName')}
          <Bindi size="heading" />
        </p>
        <h1 className="font-extrabold text-2xl text-text tracking-display">
          {t('owner:verify.title')}
        </h1>
        <section className="grid gap-5 rounded-md border border-border p-5" aria-live="polite">
          {body}
        </section>
        <p className="text-sm text-text-muted">{t('owner:verify.footer')}</p>
      </main>
    </div>
  );
}

function Invalid() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2" data-testid="verify-invalid">
      <div>
        <StatusChip status="absent" label={t('owner:verify.invalid')} />
      </div>
      <p className="text-text-body">{t('owner:verify.invalidLine')}</p>
    </div>
  );
}

function Result({ v }: { v: PayslipVerify }) {
  const { t } = useTranslation();
  const rows: [string, ReactNode][] = [
    [t('owner:verify.name'), v.staffName],
    [t('owner:verify.month'), v.month ? monthLabel(v.month) : null],
    [t('owner:verify.net'), v.netPaise !== null ? money(v.netPaise) : null],
    [t('owner:verify.revision'), v.revision],
  ];
  return (
    <div className="grid gap-4" data-testid="verify-result">
      <div className="grid gap-2">
        <div>
          {v.superseded ? (
            <StatusChip status="flag" label={t('owner:verify.superseded')} />
          ) : (
            <StatusChip status="present" label={t('owner:verify.valid')} />
          )}
        </div>
        <p className="text-text-body">
          {v.superseded
            ? t('owner:verify.supersededLine')
            : t('owner:verify.validLine', { org: v.orgName ?? '' })}
        </p>
      </div>
      <dl className="grid border-border border-t">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-6 border-border border-b py-2.5">
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-right font-semibold text-text tabular-nums">{value ?? '–'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
