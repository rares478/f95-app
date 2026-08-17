import Database from '@tauri-apps/plugin-sql';

// Dev builds use a separate file so migrations from `tauri dev` do not touch
// the release database. Keep in sync with `sqlite_db_url()` in src-tauri/src/lib.rs.
const DB_FILE = import.meta.env.DEV ? 'f95app-dev.db' : 'f95app.db';
const DB_URL = `sqlite:${DB_FILE}`;

let cached: Database | null = null;
let pending: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (cached) return cached;
  if (!pending) {
    pending = Database.load(DB_URL).then((db) => {
      cached = db;
      return db;
    });
  }
  return pending;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, values);
}

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export async function execute(
  sql: string,
  values: unknown[] = [],
): Promise<ExecuteResult> {
  const db = await getDb();
  return db.execute(sql, values);
}
