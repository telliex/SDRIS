import path from 'node:path';
import { loadLocalEnvFile, resolveDatabaseUrl } from './config';
import { createDatabase } from './connection';
import { applyScripts, MigrationError, scriptStatus, type ScriptKind } from './migrations';
import { assertDisposableLocalTarget, describeTarget, UnsafeDatabaseTargetError } from './safety';
import { SCHEMA_NAMES } from './schemas';

/**
 * `pnpm db:migrate | db:status | db:seed | db:reset`
 * Exit codes: 0 success, 1 refused or failed (unsafe target, migration error, integrity problem),
 * 2 usage error or the database is unreachable.
 */
const PACKAGE_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const DIRS: Record<ScriptKind, string> = {
  migration: path.join(PACKAGE_DIR, 'migrations'),
  seed: path.join(PACKAGE_DIR, 'seeds'),
};

const USAGE = 'Usage: db <migrate|status|seed|reset>';

function describe(url: string): string {
  const t = describeTarget(url);
  return `${t.user}@${t.host}:${t.port}/${t.database}`;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const command = argv[0];
  if (!command || !['migrate', 'status', 'seed', 'reset'].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  const url = resolveDatabaseUrl(env);

  try {
    // Destructive or data-writing local operations are checked BEFORE any connection is attempted.
    if (command === 'reset' || command === 'seed') {
      assertDisposableLocalTarget(
        url,
        command === 'reset' ? 'reset the database' : 'seed the database',
        env,
      );
    }
    console.log(`Target: ${describe(url)}`);
  } catch (error) {
    if (error instanceof UnsafeDatabaseTargetError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const connection = createDatabase(url, { max: 2 });
  try {
    try {
      await connection.pool.query('select 1');
    } catch (error) {
      const reason = error instanceof Error ? error.message || error.name : String(error);
      console.error(`Cannot connect to PostgreSQL (${reason}). Is it running? Try: pnpm db:up`);
      return 2;
    }

    if (command === 'status') {
      const statuses = await scriptStatus(connection.pool, 'migration', DIRS.migration);
      for (const s of statuses) {
        const when = s.appliedAt ? ` (${s.appliedAt.toISOString()})` : '';
        console.log(`${s.state.padEnd(9)} ${s.fileName}${when}`);
      }
      const broken = statuses.filter((s) => s.state === 'modified' || s.state === 'missing');
      if (broken.length > 0) {
        console.error(
          `Migration history problem: ${broken.map((s) => `${s.fileName} is ${s.state}`).join('; ')}`,
        );
        return 1;
      }
      return 0;
    }

    if (command === 'reset') {
      // Only the known SDRIS schemas are dropped; nothing else in the database is touched.
      for (const schema of SCHEMA_NAMES)
        await connection.pool.query(`drop schema if exists ${schema} cascade`);
      console.log(`Dropped schemas: ${SCHEMA_NAMES.join(', ')}`);
    }

    if (command === 'migrate' || command === 'reset') {
      const applied = await applyScripts(connection.pool, 'migration', DIRS.migration);
      console.log(
        applied.length === 0 ? 'No pending migrations.' : `Applied: ${applied.join(', ')}`,
      );
      return 0;
    }

    const applied = await applyScripts(connection.pool, 'seed', DIRS.seed);
    console.log(applied.length === 0 ? 'No pending seeds.' : `Seeded: ${applied.join(', ')}`);
    return 0;
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  loadLocalEnvFile(REPO_ROOT);
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
