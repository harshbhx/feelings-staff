/** The alerts pre-permission sheet, driven by `usePush()`: ask, denied, needs install, unsupported. */
import { useEffect } from 'react';
import type { usePush } from '../../pwa/push';
import { openGuide } from './bus';
import { PermissionSheet, type PermissionView } from './PermissionCard';

type Push = ReturnType<typeof usePush>;

function viewOf(state: Push['state']): PermissionView {
  if (state === 'denied') return 'denied';
  if (state === 'needs-install') return 'needs-install';
  if (state === 'unsupported') return 'unsupported';
  return 'ask';
}

export function NotificationSheet({
  push,
  open,
  onOpenChange,
}: {
  push: Push;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Once alerts are on, the sheet has done its job.
  useEffect(() => {
    if (open && push.state === 'granted-subscribed') onOpenChange(false);
  }, [open, push.state, onOpenChange]);
  return (
    <PermissionSheet
      kind="notifications"
      view={viewOf(push.state)}
      open={open}
      onOpenChange={onOpenChange}
      busy={push.busy}
      onAllow={() => push.enable().catch(() => undefined)}
      onShowInstall={() => {
        onOpenChange(false);
        openGuide('install');
      }}
    />
  );
}
