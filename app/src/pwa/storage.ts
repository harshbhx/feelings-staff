/**
 * Ask the browser to keep this origin's storage (PRD 11.8: call after install, so the device key
 * and queued punches survive storage pressure). Owner: WP-7. Never throws.
 */
export async function ensurePersisted(): Promise<boolean> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
