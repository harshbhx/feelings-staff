/**
 * Step-up for owner actions (PRD 4.1.7): finalise or reopen payroll, change salary, approve a device,
 * change the geofence, pair a door device, export data, change retention, add a manager.
 *
 * `useStepUp()` returns a runner: it runs the action, and when the server answers STEP_UP_REQUIRED it
 * opens the owner-PIN sheet, then runs the action again. Cancelling rejects with StepUpCancelled,
 * which screens ignore (the owner chose not to continue).
 *
 * The sheet is passed in by the shell (`renderSheet`): the owner panel's own PIN sheet until WP-3's
 * shared sheet (`app/src/features/auth/`) is on main, then that one, with no change for screens.
 */
import { isApiError } from '@fs/contracts';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';

export type StepUpRunner = <T>(action: () => Promise<T>) => Promise<T>;

export class StepUpCancelled extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelled';
  }
}

export function isStepUpCancelled(e: unknown): e is StepUpCancelled {
  return e instanceof StepUpCancelled;
}

const StepUpContext = createContext<StepUpRunner | null>(null);

interface Waiter {
  resolve: () => void;
  reject: (e: Error) => void;
}

export interface StepUpSheetProps {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}

export function StepUpProvider({
  children,
  renderSheet,
}: {
  children: ReactNode;
  renderSheet: (props: StepUpSheetProps) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const waiters = useRef<Waiter[]>([]);

  const askForPin = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        setOpen(true);
      }),
    [],
  );

  const runner = useCallback<StepUpRunner>(
    async (action) => {
      try {
        return await action();
      } catch (e) {
        if (!isApiError(e, 'STEP_UP_REQUIRED')) throw e;
        await askForPin();
        return action();
      }
    },
    [askForPin],
  );

  const settle = useCallback((ok: boolean) => {
    const list = waiters.current;
    waiters.current = [];
    setOpen(false);
    for (const w of list) {
      if (ok) w.resolve();
      else w.reject(new StepUpCancelled());
    }
  }, []);

  return (
    <StepUpContext.Provider value={runner}>
      {children}
      {renderSheet({ open, onVerified: () => settle(true), onCancel: () => settle(false) })}
    </StepUpContext.Provider>
  );
}

const passThrough: StepUpRunner = (action) => action();

/** The step-up runner; outside the owner shell it simply runs the action. */
export function useStepUp(): StepUpRunner {
  return useContext(StepUpContext) ?? passThrough;
}
