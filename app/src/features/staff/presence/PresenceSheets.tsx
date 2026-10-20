/**
 * The two presence sheets Today can open: Step out and the one-time notice. One lazy chunk with its
 * own copy catalog, loaded when either is needed (PRD 11.10 staff JS budget).
 */

import { withPresenceCopy } from './copy';
import { PresenceConsentSheet } from './PresenceConsentSheet';
import { StepOutSheet } from './StepOutSheet';

interface Props {
  stepOut: boolean;
  stepOutOpen: boolean;
  onStepOutOpenChange: (open: boolean) => void;
  notice: boolean;
  noticeOpen: boolean;
  onNoticeClose: () => void;
}

function Sheets(p: Props) {
  return (
    <>
      {p.stepOut ? (
        <StepOutSheet open={p.stepOutOpen} onOpenChange={p.onStepOutOpenChange} />
      ) : null}
      {p.notice ? (
        <PresenceConsentSheet open={p.noticeOpen} onOpenChange={(o) => o || p.onNoticeClose()} />
      ) : null}
    </>
  );
}

export const PresenceSheets = withPresenceCopy(Sheets);
