/**
 * The two presence sheets Today can open: Step out and the one-time notice. One lazy chunk with its
 * own copy catalog, loaded when either is needed (PRD 11.10 staff JS budget).
 */
import { useState } from 'react';
import { withPresenceCopy } from './copy';
import { PresenceConsentSheet } from './PresenceConsentSheet';
import { StepOutSheet } from './StepOutSheet';

/** "Not now" on the notice holds until the app is opened again (4.18.1: at the next app open). */
let noticeHeld = false;

interface Props {
  stepOut: boolean;
  stepOutOpen: boolean;
  onStepOutOpenChange: (open: boolean) => void;
  /** The server wants the notice shown. */
  notice: boolean;
  /** Another sheet is open: hold the notice back. */
  blocked: boolean;
}

function Sheets(p: Props) {
  const [closed, setClosed] = useState(noticeHeld);
  return (
    <>
      {p.stepOut ? (
        <StepOutSheet open={p.stepOutOpen} onOpenChange={p.onStepOutOpenChange} />
      ) : null}
      {p.notice && !closed ? (
        <PresenceConsentSheet
          open={!p.blocked}
          onOpenChange={(o) => {
            if (o) return;
            noticeHeld = true;
            setClosed(true);
          }}
        />
      ) : null}
    </>
  );
}

export const PresenceSheets = withPresenceCopy(Sheets);
