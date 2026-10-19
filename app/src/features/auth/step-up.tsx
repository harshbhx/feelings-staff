/**
 * Step-up for owner actions (PRD 4.1.7 step 4, O-01.4): finalise or reopen payroll, change salary,
 * approve a device, change the geofence, pair a door device, export data, change retention, add a
 * manager. The server answers `STEP_UP_REQUIRED` when the owner PIN wasn't entered in the last
 * 10 minutes; `useStepUp().run(action)` then slides up the PIN sheet and retries the action once.
 *
 * How WP-6 mounts it: wrap the owner shell's content once, inside the router (the sheet links to
 * Settings), e.g. in `OwnerShell`:
 *
 *   <StepUpProvider><Outlet /></StepUpProvider>
 *
 * then in any owner screen:
 *
 *   const { run } = useStepUp();
 *   await run(() => api.ownerDeviceDecide({ params: { id }, body: { decision: 'approve' } }, { idempotencyKey }));
 *
 * `run` rejects with {@link StepUpCancelledError} when the owner closes the sheet; treat that as
 * "nothing happened" (no error toast). Pass the same idempotency key on both tries (the retry is a
 * fresh call of the same function).
 */
import { isApiError, type Me } from '@fs/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { meQueryKey } from '../../api/hooks';
import { useApi } from '../../api/provider';
import { describeAuthError, type ErrorCopy } from './lib/errors';
import { useErrorText, useOwnerNames } from './lib/hooks';
import { OWNER_PIN } from './lib/inputs';
import { Button, ButtonLink, ErrorFromCopy, Lead, SectionTitle } from './ui/bits';
import { PinPad } from './ui/pin-pad';
import { Sheet } from './ui/sheet';

/** The owner closed the PIN sheet; the action did not run. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelledError';
  }
}

export function isStepUpCancelled(e: unknown): e is StepUpCancelledError {
  return e instanceof StepUpCancelledError;
}

export type StepUpRun = <T>(action: () => Promise<T>) => Promise<T>;

/**
 * Run `action`; on `STEP_UP_REQUIRED` wait for `request()` (the PIN sheet) and run it once more.
 * Any other error, a second failure, or a cancelled sheet is passed through. Pure; unit-tested.
 */
export function createStepUpRunner(request: () => Promise<void>): StepUpRun {
  return async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (e) {
      if (!isApiError(e, 'STEP_UP_REQUIRED')) throw e;
      await request();
      return action();
    }
  };
}

interface Pending {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function pending(): Pending {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface StepUpContextValue {
  request: () => Promise<void>;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

/** Hosts the PIN sheet for every `useStepUp()` below it. Mount once, inside the router. */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const current = useRef<Pending | null>(null);

  // Several actions asking at once share one sheet.
  const request = useCallback(() => {
    if (!current.current) {
      current.current = pending();
      setOpen(true);
    }
    return current.current.promise;
  }, []);

  const finish = useCallback((ok: boolean) => {
    const p = current.current;
    current.current = null;
    setOpen(false);
    if (!p) return;
    if (ok) p.resolve();
    else p.reject(new StepUpCancelledError());
  }, []);

  const value = useMemo(() => ({ request }), [request]);

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {open ? (
        <StepUpSheet open onDone={() => finish(true)} onCancel={() => finish(false)} />
      ) : null}
    </StepUpContext.Provider>
  );
}

/** `run(action)` with step-up handling, and `request()` to ask for the PIN up front. */
export function useStepUp(): { run: StepUpRun; request: () => Promise<void> } {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp outside StepUpProvider');
  return useMemo(() => ({ run: createStepUpRunner(ctx.request), request: ctx.request }), [ctx]);
}

function StepUpSheet({
  open,
  onDone,
  onCancel,
}: {
  open: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const names = useOwnerNames();
  const text = useErrorText(names);
  const titleId = useId();
  const leadId = useId();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);

  const reset = () => {
    setPin('');
    setError(null);
    setBusy(false);
  };

  const submit = async (value: string) => {
    if (busy) return;
    if (value.length !== OWNER_PIN.max) {
      setError({ key: 'auth:validation.ownerPin' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { stepUpUntil } = await api.stepUp({ body: { pin: value } });
      queryClient.setQueryData<Me | null>(meQueryKey, (old) =>
        old ? { ...old, flags: { ...old.flags, stepUpUntil } } : old,
      );
      reset();
      onDone();
    } catch (e) {
      setPin('');
      setBusy(false);
      setError(describeAuthError(e, 'stepUp'));
    }
  };

  const cancel = () => {
    reset();
    onCancel();
  };

  const noPin = error?.action === 'noOwnerPin';

  return (
    <Sheet open={open} onCancel={cancel} labelledBy={titleId} describedBy={leadId}>
      <SectionTitle id={titleId}>{t('auth:stepUp.title')}</SectionTitle>
      <div id={leadId}>
        <Lead>{t('auth:stepUp.lead')}</Lead>
      </div>
      <form
        className="mt-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(pin);
        }}
      >
        {noPin ? null : (
          <PinPad
            label={t('auth:stepUp.pinLabel')}
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (error) setError(null);
            }}
            onComplete={(v) => void submit(v)}
            length={OWNER_PIN}
            disabled={busy}
            autoComplete="off"
          />
        )}
        <div className="mt-5">
          <ErrorFromCopy copy={error} text={text} />
        </div>
        <div className="mt-6 flex flex-col gap-3">
          {noPin ? (
            <ButtonLink to="/o/settings/security" variant="primary" onClick={cancel}>
              {t('auth:stepUp.openSettings')}
            </ButtonLink>
          ) : (
            <Button type="submit" variant="primary" disabled={busy} icon="lock">
              {busy ? t('auth:stepUp.checking') : t('auth:stepUp.submit')}
            </Button>
          )}
          <Button onClick={cancel}>{t('auth:stepUp.cancel')}</Button>
        </div>
      </form>
    </Sheet>
  );
}
