/** React glue shared by the auth screens. */
import type { Me } from '@fs/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { meQueryKey } from '../../../api/hooks';
import { homeFor } from '../../../app/guards';
import type { ErrorCopy } from './errors';
import { withFlags } from './flags';
import { nextFitsRole, safeNext } from './next';
import { readOrgContact, saveOrgContact } from './storage';

/** A type alias (not an interface) so it passes as i18next interpolation values. */
export type OwnerNames = {
  /** For the middle of a sentence: "Ask Urmi to…" / "Ask the owner to…". */
  owner: string;
  /** For the start of a sentence: "Urmi needs to…" / "The owner needs to…". */
  Owner: string;
};

/**
 * The owner's display name for staff copy (PRD 5: never hard-coded). Uses the name we know from
 * the API, else the one remembered on this phone, else "the owner".
 */
export function useOwnerNames(known?: string | null): OwnerNames {
  const { t } = useTranslation();
  return useMemo(() => {
    const name = known ?? readOrgContact().ownerName;
    return name
      ? { owner: name, Owner: name }
      : { owner: t('auth:common.ownerFallback'), Owner: t('auth:common.ownerFallbackStart') };
  }, [known, t]);
}

/** Turn an {@link ErrorCopy} into text, with the owner's name available as {{owner}} / {{Owner}}. */
export function useErrorText(names: OwnerNames): (copy: ErrorCopy) => string {
  const { t } = useTranslation();
  return useCallback(
    (copy: ErrorCopy) => t(copy.key, { ...names, ...(copy.values ?? {}) }),
    [t, names],
  );
}

/**
 * After any successful sign-in: put Me in the cache (so guards don't refetch), remember the owner's
 * name and phone for signed-out copy, then go to `?next=` (when it fits the role) or the role's home.
 */
export function useFinishSignIn(): (me: Me) => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return useCallback(
    (me: Me) => {
      queryClient.setQueryData(meQueryKey, me);
      saveOrgContact({ ownerName: me.org.ownerDisplayName, ownerPhone: me.org.contactPhone });
      const next = safeNext(params.get('next'));
      const to = next && nextFitsRole(next, me.user.role) ? next : homeFor(me.user.role);
      navigate(withFlags(to), { replace: true });
    },
    [queryClient, navigate, params],
  );
}

/** The UI language as a contract `Lang`. */
export function useLang(): 'en' | 'gu' {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage === 'gu' ? 'gu' : 'en';
}
