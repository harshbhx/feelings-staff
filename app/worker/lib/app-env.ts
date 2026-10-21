import type { Env } from '../env';
import type { Ctx } from '../services/ports';

/** Hono generics for the whole Worker. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    ctx: Ctx;
    /** Verified Cloudflare Access e-mail (lower case); set only when the Access gate ran and passed. */
    accessEmail?: string | undefined;
  };
};
