/**
 * Applies migrations/*.sql in order, tracked in d1_migrations (same table wrangler uses), and wipes
 * every table for test resets. Preview/local only (called from /__test/reset). Owner: WP-1.
 */
const files = import.meta.glob('../../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const MIGRATIONS = Object.entries(files)
  .map(([path, sql]) => ({ name: path.split('/').pop() as string, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Split a migration into statements: drop `--` comments, split on `;`. */
export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function applyMigrations(db: D1Database): Promise<string[]> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  const done = new Set(
    (await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map(
      (r) => r.name,
    ),
  );
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    const stmts = splitSql(m.sql).map((s) => db.prepare(s));
    stmts.push(db.prepare('INSERT INTO d1_migrations (name) VALUES (?1)').bind(m.name));
    await db.batch(stmts);
    applied.push(m.name);
  }
  return applied;
}

/** Children before parents so foreign keys hold while deleting. */
export const WIPE_ORDER = [
  'adjustments',
  'payslips',
  'advance_recoveries',
  'fines',
  'payroll_runs',
  'advances',
  'leave_requests',
  'leave_ledger',
  'leave_types',
  'regularisations',
  'ot_decisions',
  'attendance_days',
  'punches',
  'offsite_duty_staff',
  'offsite_duties',
  'ot_preapprovals',
  'roster_overrides',
  'holidays',
  'blackout_days',
  'calibration_samples',
  'door_devices',
  'salon_networks',
  'sites',
  'consents',
  'notifications',
  'notification_prefs',
  'push_subscriptions',
  'audit_log',
  'exports',
  'cron_runs',
  'challenges',
  'sessions',
  'magic_links',
  'invites',
  'devices',
  'salary_history',
  'staff_profiles',
  'shift_templates',
  'users',
  'orgs',
  'app_meta',
  'idempotency_keys',
  'test_outbox',
] as const;

/** Delete every row of every app table (tables added by later migrations included). */
export async function wipeAll(db: D1Database): Promise<void> {
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
      )
      .all<{ name: string }>()
  ).results.map((r) => r.name);
  const known = WIPE_ORDER as readonly string[];
  const ordered = [
    ...tables.filter((t) => !known.includes(t)),
    ...known.filter((t) => tables.includes(t)),
  ];
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = true'),
    ...ordered.map((t) => db.prepare(`DELETE FROM "${t}"`)),
  ]);
}
