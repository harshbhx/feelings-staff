/**
 * Registers every endpoint of the contract table on the Hono app (WP-1). For each request it:
 * checks access (role, manager permission, door, test token), parses params/query/body with the
 * contract schemas, enforces step-up, replays idempotent requests, calls the handler (or answers
 * 501 NOT_IMPLEMENTED), validates the response against the contract outside production, and sends it.
 *
 * Packages implement endpoints by exporting `Handlers` from their route module; they never edit this.
 */
import {
  ENDPOINT_KEYS,
  type EndpointKey,
  type EndpointShape,
  type Endpoints,
  endpoints,
  type OutputOf,
  type ParsedInputOf,
} from '@fs/contracts';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { isNonProd } from '../env';
import type { Ctx } from '../services/ports';
import type { AppEnv } from './app-env';
import { timingSafeEqual } from './crypto';
import { fail } from './errors';
import { requirePreview } from './preview-gate';

export type Handler<E> = (
  input: ParsedInputOf<E>,
  ctx: Ctx,
  c: Context<AppEnv>,
) => Promise<OutputOf<E> | Response>;

export type Handlers = { [K in EndpointKey]?: Handler<Endpoints[K]> };

/** Merge handler maps from several route modules; a key defined twice is a programming error. */
export function mergeHandlers(...maps: Handlers[]): Handlers {
  const out: Record<string, unknown> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      if (out[k]) throw new Error(`Endpoint ${k} is implemented twice`);
      out[k] = v;
    }
  }
  return out as Handlers;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function zodIssues(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
  };
}

function parseWith(schema: z.ZodType | undefined, value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value);
  if (!r.success) fail('VALIDATION', `Some details need fixing (${where}).`, zodIssues(r.error));
  return r.data;
}

function checkAccess(def: EndpointShape, ctx: Ctx, c: Context<AppEnv>): void {
  const access = def.access as readonly string[];
  if (access.includes('public')) return;
  if (access.includes('test')) {
    const token = c.req.header('X-E2E-Token') ?? '';
    const expected = c.env.E2E_TOKEN ?? '';
    if (isNonProd(c.env) && expected.length >= 16 && timingSafeEqual(token, expected)) return;
    fail('NOT_FOUND');
  }
  const s = ctx.session;
  if (!s) fail('UNAUTHENTICATED');
  if (s.kind === 'door') {
    if (access.includes('door')) return;
    fail('FORBIDDEN');
  }
  const u = ctx.user;
  if (!u) fail('UNAUTHENTICATED');
  if (access.includes('self')) return;
  if (access.includes('owner') && u.role === 'owner') return;
  if (access.includes('manager') && u.role === 'manager') {
    if (!def.perm || u.permissions.includes(def.perm)) return;
  }
  fail('FORBIDDEN');
}

async function readInput(def: EndpointShape, c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  if (def.params) input.params = parseWith(def.params, c.req.param(), 'path');
  if (def.query) input.query = parseWith(def.query, c.req.query(), 'query');
  if (def.body) {
    let raw: unknown;
    if (def.multipart) {
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return fail('BAD_REQUEST', 'Expected multipart form data.');
      }
      const files: Record<string, File> = {};
      for (const [name, value] of form.entries()) {
        if (name === 'payload') continue;
        if (typeof value !== 'string') {
          if (value.size > MAX_FILE_BYTES) fail('PAYLOAD_TOO_LARGE');
          files[name] = value;
        }
      }
      const payload = form.get('payload');
      try {
        raw = JSON.parse(typeof payload === 'string' ? payload : '');
      } catch {
        return fail('BAD_REQUEST', 'The payload field must be JSON.');
      }
      input.files = files;
    } else {
      try {
        raw = await c.req.json();
      } catch {
        return fail('BAD_REQUEST', 'Expected a JSON body.');
      }
    }
    input.body = parseWith(def.body, raw, 'body');
  } else if (def.multipart) {
    input.files = {};
  }
  return input;
}

async function replayIdempotent(
  key: string,
  ctx: Ctx,
  c: Context<AppEnv>,
  idemKey: string,
): Promise<Response | null> {
  const userId = ctx.user?.id;
  if (!userId || !ctx.orgId) return null;
  const row = await ctx.db.first<{
    endpoint: string;
    status: number;
    response_json: string | null;
  }>(
    'SELECT endpoint, status, response_json FROM idempotency_keys WHERE org_id = ?org AND user_id = ? AND key = ?',
    userId,
    idemKey,
  );
  if (!row) return null;
  if (row.endpoint !== key)
    fail('CONFLICT', 'This request key was already used for something else.');
  c.header('Idempotent-Replay', 'true');
  return row.response_json === null
    ? c.body(null, row.status as 200)
    : c.newResponse(row.response_json, row.status as 200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
}

async function storeIdempotent(
  key: string,
  ctx: Ctx,
  idemKey: string,
  status: number,
  body: string | null,
) {
  const userId = ctx.user?.id;
  if (!userId || !ctx.orgId) return;
  await ctx.db.run(
    'INSERT OR IGNORE INTO idempotency_keys (org_id, user_id, key, endpoint, status, response_json, created_at) VALUES (?org, ?, ?, ?, ?, ?, ?)',
    userId,
    idemKey,
    key,
    status,
    body,
    ctx.now(),
  );
}

export function registerApi(api: Hono<AppEnv>, handlers: Handlers): void {
  for (const key of ENDPOINT_KEYS) {
    const def = endpoints[key] as EndpointShape;
    const handler = handlers[key] as Handler<EndpointShape> | undefined;
    api.on(def.method, def.path, async (c) => {
      if (def.previewOnly) requirePreview(c.env);
      const ctx = c.get('ctx');
      checkAccess(def, ctx, c);
      const input = await readInput(def, c);
      if (def.stepUp) await ctx.services.stepUp.require(ctx);

      const idemKey = def.idempotent ? (c.req.header('Idempotency-Key') ?? null) : null;
      if (idemKey) {
        if (idemKey.length < 8 || idemKey.length > 100)
          fail('BAD_REQUEST', 'Idempotency-Key must be 8-100 characters.');
        const replay = await replayIdempotent(key, ctx, c, idemKey);
        if (replay) return replay;
      }

      if (!handler) return fail('NOT_IMPLEMENTED', `${def.method} ${def.path} is not built yet.`);
      const out = await handler(input as never, ctx, c);
      if (out instanceof Response) return out;

      const status = def.status ?? 200;
      if (isNonProd(c.env)) {
        const check = def.res.safeParse(out);
        if (!check.success) {
          console.error(
            JSON.stringify({
              msg: 'contract.response_mismatch',
              endpoint: key,
              requestId: ctx.requestId,
            }),
          );
          fail(
            'INTERNAL',
            `Response for ${key} does not match the contract.`,
            zodIssues(check.error),
          );
        }
      }
      const body = out === undefined ? null : JSON.stringify(out);
      if (idemKey) await storeIdempotent(key, ctx, idemKey, status, body);
      if (body === null) return c.body(null, status as 204);
      return c.newResponse(body, status as 200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
    });
  }
}

/** Typed helper for one handler, for modules that prefer defining them one by one. */
export function handler<K extends EndpointKey>(
  _key: K,
  fn: Handler<Endpoints[K]>,
): Handler<Endpoints[K]> {
  return fn;
}
