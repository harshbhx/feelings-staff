/**
 * The rotating door code (PRD 4.5). The token is `doorToken(secret, doorStep(serverNow))` from the
 * engine (HMAC-SHA256 over the 30 s step, Crockford base32, 10 chars); the server accepts the
 * current and the previous step. The QR holds `https://<host>/q/<siteId>/<token>`.
 */
import { fromBase64Url } from '@fs/contracts';
import { DOOR_STEP_MS, doorStep, doorToken } from '@fs/engine';

export interface DoorCode {
  token: string;
  url: string;
  /** Whole seconds until the code changes (30 down to 1). */
  secondsLeft: number;
}

export function doorUrl(origin: string, siteId: string, token: string): string {
  return `${origin}/q/${siteId}/${token}`;
}

export async function currentDoorCode(
  secretB64: string,
  siteId: string,
  serverNow: number,
  origin: string,
): Promise<DoorCode> {
  const step = doorStep(serverNow);
  const token = await doorToken(fromBase64Url(secretB64), step);
  const left = DOOR_STEP_MS - (serverNow - step * DOOR_STEP_MS);
  return {
    token,
    url: doorUrl(origin, siteId, token),
    secondsLeft: Math.max(1, Math.ceil(left / 1000)),
  };
}
