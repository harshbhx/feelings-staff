/**
 * Org-scoped data access (PRD 8.1, 10.8). Owner: WP-1.
 *
 * Every statement that touches a tenant table must contain the `?org` placeholder, which is bound
 * to the session's org id; `OrgDb` refuses SQL without it. Anonymous `?` placeholders keep working
 * (they are renumbered). Raw `env.DB.prepare` is banned outside this folder (scripts/check-arch.mjs).
 *
 *   const rows = await ctx.db.all<PunchRow>(
 *     'SELECT * FROM punches WHERE org_id = ?org AND user_id = ? AND work_date = ?', userId, date);
 *   await ctx.db.batch([ctx.db.insert('punches', row), ctx.audit.stmt(ctx, entry)]);
 */
export type Bindable = string | number | null | ArrayBuffer | Uint8Array;

/** Tables without org_id: the only ones `OrgDb` lets through without `?org`. */
const GLOBAL_TABLES = new Set([
  'orgs',
  'app_meta',
  'magic_links',
  'notification_prefs',
  'd1_migrations',
]);

/**
 * Rewrite SQL so `?org` becomes ?1 and every anonymous `?` becomes ?2, ?3, ... in order.
 * Quoted strings and `--` comments are left alone.
 */
export function rewritePlaceholders(sql: string): { sql: string; usesOrg: boolean } {
  let out = '';
  let n = 1;
  let usesOrg = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string;
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '?') {
      if (sql.startsWith('?org', i) && !/[A-Za-z0-9_]/.test(sql[i + 4] ?? '')) {
        out += '?1';
        usesOrg = true;
        i += 3;
        continue;
      }
      if (/\d/.test(sql[i + 1] ?? ''))
        throw new Error('Use anonymous ? or ?org placeholders, not ?N');
      n += 1;
      out += `?${n}`;
      continue;
    }
    out += ch;
  }
  return { sql: out, usesOrg };
}

function touchesOnlyGlobalTables(sql: string): boolean {
  const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map((m) =>
    (m[1] as string).toLowerCase(),
  );
  return tables.length > 0 && tables.every((t) => GLOBAL_TABLES.has(t));
}

export class OrgDb {
  constructor(
    readonly raw: D1Database,
    readonly orgId: string,
  ) {}

  /** Prepared statement with `?org` bound. Use with `batch`. */
  stmt(sql: string, ...params: Bindable[]): D1PreparedStatement {
    const { sql: rewritten, usesOrg } = rewritePlaceholders(sql);
    if (usesOrg) return this.raw.prepare(rewritten).bind(this.orgId, ...params);
    if (!touchesOnlyGlobalTables(sql)) {
      throw new Error(`OrgDb: statement must filter by org_id = ?org: ${sql.slice(0, 120)}`);
    }
    return this.raw.prepare(sql).bind(...params);
  }

  async first<T>(sql: string, ...params: Bindable[]): Promise<T | null> {
    return (await this.stmt(sql, ...params).first<T>()) ?? null;
  }

  async all<T>(sql: string, ...params: Bindable[]): Promise<T[]> {
    return (await this.stmt(sql, ...params).all<T>()).results;
  }

  async run(sql: string, ...params: Bindable[]): Promise<D1Result> {
    return this.stmt(sql, ...params).run();
  }

  /** Commit several statements atomically (PRD 13.2 step 4). */
  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    return stmts.length === 0 ? [] : this.raw.batch(stmts);
  }

  /** INSERT with org_id filled in. Column names come from code, never from input. */
  insert(table: string, row: Record<string, Bindable | boolean | undefined>): D1PreparedStatement {
    const entries = Object.entries(row).filter(([, v]) => v !== undefined) as [
      string,
      Bindable | boolean,
    ][];
    const cols = ['org_id', ...entries.map(([k]) => k)];
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (?org${', ?'.repeat(entries.length)})`;
    return this.stmt(sql, ...values);
  }

  /** UPDATE ... SET ... WHERE org_id = ?org AND (<where>). */
  update(
    table: string,
    set: Record<string, Bindable | boolean | undefined>,
    where: string,
    ...whereParams: Bindable[]
  ): D1PreparedStatement {
    const entries = Object.entries(set).filter(([, v]) => v !== undefined) as [
      string,
      Bindable | boolean,
    ][];
    if (entries.length === 0) throw new Error('OrgDb.update: nothing to set');
    const assignments = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    return this.stmt(
      `UPDATE ${table} SET ${assignments} WHERE org_id = ?org AND (${where})`,
      ...values,
      ...whereParams,
    );
  }
}

/**
 * Unscoped access for the few lookups that happen before the org is known: session by token hash,
 * invite by code hash, magic link by token, door pairing code, payslip verify token, and setup.
 * Every use should be visible in review; prefer OrgDb as soon as the org id is known.
 */
export class SystemDb {
  constructor(readonly raw: D1Database) {}

  stmt(sql: string, ...params: Bindable[]): D1PreparedStatement {
    if (sql.includes('?org')) throw new Error('SystemDb: ?org is only for OrgDb');
    return this.raw.prepare(sql).bind(...params);
  }

  async first<T>(sql: string, ...params: Bindable[]): Promise<T | null> {
    return (await this.stmt(sql, ...params).first<T>()) ?? null;
  }

  async all<T>(sql: string, ...params: Bindable[]): Promise<T[]> {
    return (await this.stmt(sql, ...params).all<T>()).results;
  }

  async run(sql: string, ...params: Bindable[]): Promise<D1Result> {
    return this.stmt(sql, ...params).run();
  }

  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    return stmts.length === 0 ? [] : this.raw.batch(stmts);
  }

  forOrg(orgId: string): OrgDb {
    return new OrgDb(this.raw, orgId);
  }
}

/** Convert D1 0/1 integers to booleans. */
export const bool = (v: unknown): boolean => v === 1 || v === true;

/** Parse a JSON column, falling back when null. */
export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
