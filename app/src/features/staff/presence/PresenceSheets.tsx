/**
 * The two presence sheets Today can open: Step out and the one-time notice. One lazy chunk with its
 * own copy catalog, loaded when either is needed (PRD 11.10 staff JS budget).
 */
import { useState } from 'react';
import { withPresenceCopy } from './copy';
import { PresenceConsentSheet } from './PresenceConsentSheet';
import { StepOutSheet } from './StepOutSheet';
import { useHeldBack } from './use-held-back';

/** "Not now" on the notice holds until the app is opened again (4.18.1: at the next app open). */
let noticeHeld = false;

/** A closing sheet is on the page for its exit animation (140 ms): wait it out. */
const SHEET_EXIT_MS = 300;

interface Props {
  stepOutOpen: boolean;
  onStepOutOpenChange: (open: boolean) => void;
  /** The server wants the notice shown. */
  notice: boolean;
  /** Another sheet is open: hold the notice back (Step out counts too). */
  blocked: boolean;
}

function Sheets(p: Props) {
  const [closed, setClosed] = useState(noticeHeld);
  // Never two dialogs at once: the notice waits while the punch or the Step out sheet is open and
  // for the one that just closed to leave the page.
  const held = useHeldBack(p.blocked || p.stepOutOpen, SHEET_EXIT_MS);
  return (
    <>
      <StepOutSheet open={p.stepOutOpen} onOpenChange={p.onStepOutOpenChange} />
      {p.notice && !closed ? (
        <PresenceConsentSheet
          open={!held}
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
