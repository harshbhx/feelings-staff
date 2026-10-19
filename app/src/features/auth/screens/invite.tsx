/**
 * Invite page `/join/:code` (PRD 4.1.3, 5.1 "Invite", S-01.6, S-03). In a browser tab it never
 * enrols: it greets the person by name and teaches the install for this browser. Opened in the
 * installed app (or with the test flag) it goes straight to `/join` with the code prefilled.
 */
import type { JoinLookup } from '@fs/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { useApi } from '../../../api/provider';
import { describeAuthError } from '../lib/errors';
import { actsInstalled, withFlags } from '../lib/flags';
import { useErrorText, useOwnerNames } from '../lib/hooks';
import { parseJoinCode } from '../lib/inputs';
import { saveJoinCode, saveOrgContact } from '../lib/storage';
import { Button, Card, ErrorFromCopy, ExternalButton, Skeleton, Title } from '../ui/bits';
import { Icon } from '../ui/icons';
import { InstallGuide } from '../ui/install-guide';
import { AuthScreen } from '../ui/layout';

function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

function InviteProblem({
  lookup,
}: {
  lookup: Pick<JoinLookup, 'status' | 'ownerDisplayName' | 'ownerPhone'>;
}) {
  const { t } = useTranslation();
  const names = useOwnerNames(lookup.ownerDisplayName);
  const message =
    lookup.status === 'expired'
      ? t('auth:invite.expired', names)
      : lookup.status === 'used'
        ? t('auth:invite.used', names)
        : t('auth:invite.unknown', names);
  const showWhatsApp = lookup.ownerPhone && lookup.status !== 'unknown';
  return (
    <Card className="mt-8">
      <div className="flex items-start gap-3">
        <Icon name="warning-circle" className="mt-0.5 size-6 text-[var(--status-absent)]" />
        <p data-testid="invite-problem" className="text-base font-semibold text-text">
          {message}
        </p>
      </div>
      {showWhatsApp && lookup.ownerPhone ? (
        <div className="mt-5">
          <ExternalButton
            href={waLink(lookup.ownerPhone, t('auth:invite.whatsAppText'))}
            icon="whatsapp-logo"
          >
            {t('auth:invite.whatsApp', names)}
          </ExternalButton>
        </div>
      ) : null}
    </Card>
  );
}

export function InviteScreen() {
  const { t } = useTranslation();
  const api = useApi();
  const { code: raw = '' } = useParams();
  const code = parseJoinCode(raw);
  const [installed] = useState(actsInstalled);

  const lookup = useQuery({
    queryKey: ['auth', 'joinLookup', code],
    queryFn: () => api.joinLookup({ query: { code: code ?? '' } }),
    enabled: code !== null && !installed,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const data = lookup.data;
  const names = useOwnerNames(data?.ownerDisplayName ?? null);
  const text = useErrorText(names);

  useEffect(() => {
    if (!code || data?.status !== 'valid') return;
    // Chrome shares storage with the installed WebAPK, so the app can prefill the code.
    saveJoinCode(code);
    saveOrgContact({ ownerName: data.ownerDisplayName, ownerPhone: data.ownerPhone });
  }, [code, data]);

  if (installed) {
    return <Navigate to={withFlags(code ? `/join?code=${code}` : '/join')} replace />;
  }

  const link = `${window.location.origin}/join/${code ?? raw}`;
  const name = data?.status === 'valid' ? data.staffFirstName : null;
  const title = name ? t('auth:invite.title', { name }) : t('auth:invite.titleNoName');

  let body: ReactNode;
  if (code === null) {
    body = (
      <InviteProblem lookup={{ status: 'unknown', ownerDisplayName: null, ownerPhone: null }} />
    );
  } else if (lookup.isPending) {
    body = (
      <div className="mt-8 space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-[4.5rem] w-full" />
        <Skeleton className="h-[4.5rem] w-full" />
        <Skeleton className="h-[4.5rem] w-full" />
      </div>
    );
  } else if (lookup.isError) {
    body = (
      <div className="mt-8 space-y-4">
        <ErrorFromCopy copy={describeAuthError(lookup.error, 'lookup')} text={text} />
        <Button icon="arrows-clockwise" onClick={() => void lookup.refetch()}>
          {t('auth:common.tryAgain')}
        </Button>
      </div>
    );
  } else if (data && data.status !== 'valid') {
    body = <InviteProblem lookup={data} />;
  } else {
    body = (
      <>
        <p className="mt-2 text-base text-pretty text-text-body">{t('auth:invite.lead', names)}</p>
        <InstallGuide code={code} link={link} />
      </>
    );
  }

  return (
    <AuthScreen busy={lookup.isLoading}>
      {lookup.isLoading ? (
        <>
          <h1 className="sr-only">{t('auth:invite.titleNoName')}</h1>
          <Skeleton className="h-8 w-4/5" />
        </>
      ) : (
        <Title>{title}</Title>
      )}
      {body}
    </AuthScreen>
  );
}
