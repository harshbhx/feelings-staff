/** Shared inbox screen and header bell (PRD 5, S-15). Owner: WP-8. */
import { Placeholder } from '../../app/placeholder';

export function InboxScreen() {
  return <Placeholder titleKey="staff:screens.inbox" />;
}

/** Header bell with the unread count. WP-8 builds it; shells render it. */
export function InboxBell() {
  return null;
}
