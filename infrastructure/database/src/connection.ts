import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type Database = NodePgDatabase;

export interface DatabaseConnection {
  readonly pool: Pool;
  readonly db: Database;
  close(): Promise<void>;
}

/** Opens a pooled connection. Drizzle types stay inside infrastructure code. */
export function createDatabase(
  connectionString: string,
  options: { max?: number } = {},
): DatabaseConnection {
  const pool = new Pool({ connectionString, max: options.max ?? 10 });
  return { pool, db: drizzle(pool), close: () => pool.end() };
}

/** True when a trivial query succeeds; used for readiness reporting. */
export async function isReachable(pool: Pool): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
