/** Worker bindings, secrets and variables (PRD 15.1, 15.3). Secrets are never logged. */
export interface Env {
  // Bindings
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  BROWSER?: Fetcher;
  EMAIL?: SendEmail;
  RL_IP?: RateLimit;
  RL_SESSION?: RateLimit;
  RL_PUNCH?: RateLimit;
  RL_DOOR?: RateLimit;

  // Variables
  ENV: 'production' | 'preview' | 'local';
  APP_ORIGIN: string;
  /** Owner host name (no scheme). Unset = one host serves everything (today's behaviour). */
  OWNER_HOST?: string;
  APP_VERSION: string;
  MIN_APP_VERSION: string;
  EMAIL_PROVIDER: 'cloudflare' | 'resend' | 'outbox';
  EMAIL_FROM: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  OWNER_BOOTSTRAP_EMAIL: string;
  WHATSAPP_TEMPLATE_NAMESPACE?: string;

  // Secrets
  SESSION_SECRET: string;
  PIN_PEPPER: string;
  TIME_SIGNING_KEY: string;
  IP_HMAC_KEY: string;
  QR_MASTER_KEY: string;
  PUNCH_ENC_PRIVATE_JWK: string;
  VAPID_PRIVATE_JWK: string;
  SETUP_TOKEN: string;
  E2E_TOKEN?: string;
  RESEND_API_KEY?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
}

/** True outside production (preview and local): test routes, response validation, fake clock. */
export function isNonProd(env: Pick<Env, 'ENV'>): boolean {
  return env.ENV !== 'production';
}
