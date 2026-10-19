/**
 * Notification permission during join (PRD 4.1.4 step 5, 11.8, S-15.2): asked only from a tap.
 * WP-8 owns push subscriptions (`app/src/pwa/push.ts`); once its `enablePush(api)` is on main, the
 * join step calls that instead, which asks for permission and subscribes in one go.
 */
export function canAskForNotifications(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'default';
}

export async function askForNotifications(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
