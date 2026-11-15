import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { loadLocalEnvFile, resolveDatabaseUrl } from '../config';
import { createDatabase, type DatabaseConnection } from '../connection';
import { assertDisposableLocalTarget } from '../safety';

/**
 * Integration-test support: each caller gets its own freshly created database `sdris_test_<hex>`
 * on the local server, dropped afterwards. A developer's normal database (`sdris_local`) is never
 * touched. Every database created or dropped here passes `assertDisposableLocalTarget` first.
 */
export interface IsolatedDatabase {
  readonly url: string;
  readonly name: string;
  readonly connection: DatabaseConnection;
  drop(): Promise<void>;
}

const withDatabase = (url: string, database: string): string => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  loadLocalEnvFile(path.resolve(__dirname, '..', '..', '..', '..'));
  const base = resolveDatabaseUrl();
  const name = `sdris_test_${randomBytes(4).toString('hex')}`;
  const url = withDatabase(base, name);
  assertDisposableLocalTarget(url, 'create a test database');

  // Maintenance connection: same local server and credentials, database `postgres`.
  const admin = createDatabase(withDatabase(base, 'postgres'), { max: 1 });
  try {
    await admin.pool.query(`create database "${name}"`);
  } catch (error) {
    throw new Error(
      `Cannot create an isolated test database (${error instanceof Error ? error.message : error}). ` +
        'Is PostgreSQL running? Try: pnpm db:up',
    );
  } finally {
    await admin.close();
  }
  const connection = createDatabase(url, { max: 20 });
  return {
    url,
    name,
    connection,
    async drop() {
      await connection.close();
      assertDisposableLocalTarget(url, 'drop a test database');
      const dropper = createDatabase(withDatabase(base, 'postgres'), { max: 1 });
      try {
        await dropper.pool.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.close();
      }
    },
  };
}
