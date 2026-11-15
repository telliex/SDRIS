import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { applyScripts, MigrationError, scriptStatus } from './migrations';
import { SCHEMA_NAMES, SCHEMA_OWNERSHIP } from './schemas';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';

const run = promisify(execFile);
const MIGRATIONS = path.resolve(__dirname, '..', 'migrations');
const SEEDS = path.resolve(__dirname, '..', 'seeds');

/** Copies the committed migrations to a scratch dir so a test can add or tamper with files. */
const scratchMigrations = (extra: Record<string, string> = {}): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdris-it-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  for (const [name, body] of Object.entries(extra)) writeFileSync(path.join(dir, name), body);
  return dir;
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error instanceof MigrationError ? error.code : `other: ${error}`;
  }
  return 'no error';
};

describe('migrations against real PostgreSQL', () => {
  let target: IsolatedDatabase;
  const q = async (text: string, values: unknown[] = []) =>
    (await target.connection.pool.query(text, values)).rows;
  before(async () => {
    target = await createIsolatedDatabase();
  });
  after(async () => {
    await target.drop();
  });

  it('applies the baseline to a fresh database and creates every owned schema', async () => {
    const applied = await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    assert.deepEqual(applied, ['0001_create_bounded_context_schemas.sql']);
    const rows = await q(
      `select nspname, obj_description(oid, 'pg_namespace') as description from pg_namespace where nspname = any($1)`,
      [SCHEMA_NAMES],
    );
    assert.deepEqual(rows.map((r) => r.nspname).sort(), [...SCHEMA_NAMES].sort());
    for (const row of rows)
      assert.equal(row.description, SCHEMA_OWNERSHIP[row.nspname as keyof typeof SCHEMA_OWNERSHIP]);
  });

  it('creates no business tables: only the system tracking table exists', async () => {
    const rows = await q(
      `select table_schema, table_name from information_schema.tables where table_schema = any($1)`,
      [SCHEMA_NAMES],
    );
    assert.deepEqual(rows, [{ table_schema: 'system', table_name: 'schema_migrations' }]);
  });

  it('is repeatable: re-running applies nothing and duplicates nothing', async () => {
    const before = await q(`select count(*)::int as n from pg_namespace where nspname = any($1)`, [
      SCHEMA_NAMES,
    ]);
    assert.deepEqual(await applyScripts(target.connection.pool, 'migration', MIGRATIONS), []);
    assert.deepEqual(await applyScripts(target.connection.pool, 'migration', MIGRATIONS), []);
    const after = await q(`select count(*)::int as n from pg_namespace where nspname = any($1)`, [
      SCHEMA_NAMES,
    ]);
    assert.deepEqual(after, before);
    assert.equal((await q('select count(*)::int as n from system.schema_migrations'))[0].n, 1);
  });

  it('makes applied versions observable with a checksum', async () => {
    const status = await scriptStatus(target.connection.pool, 'migration', MIGRATIONS);
    assert.equal(status.length, 1);
    assert.equal(status[0]!.state, 'applied');
    assert.ok(status[0]!.appliedAt instanceof Date);
    const [row] = await q('select version, name, checksum from system.schema_migrations');
    assert.equal(row.version, '0001');
    assert.match(row.checksum, /^[0-9a-f]{64}$/);
  });

  it('applies a newly added migration exactly once', async () => {
    const dir = scratchMigrations({ '0002_add_probe_schema.sql': 'create schema probe_a; ' });
    assert.deepEqual(await applyScripts(target.connection.pool, 'migration', dir), [
      '0002_add_probe_schema.sql',
    ]);
    assert.deepEqual(await applyScripts(target.connection.pool, 'migration', dir), []);
    assert.equal(
      (await q(`select count(*)::int as n from pg_namespace where nspname='probe_a'`))[0].n,
      1,
    );
    await q('drop schema probe_a');
    await q(`delete from system.schema_migrations where version = '0002'`);
  });

  it('rejects an edited applied migration and changes nothing', async () => {
    const dir = scratchMigrations();
    const file = path.join(dir, '0001_create_bounded_context_schemas.sql');
    writeFileSync(file, readFileSync(file, 'utf8') + '\ncreate schema tampered_schema;\n');
    assert.equal(
      await codeOf(applyScripts(target.connection.pool, 'migration', dir)),
      'CHECKSUM_MISMATCH',
    );
    assert.equal(
      (await q(`select count(*)::int as n from pg_namespace where nspname='tampered_schema'`))[0].n,
      0,
    );
    const status = await scriptStatus(target.connection.pool, 'migration', dir);
    assert.equal(status[0]!.state, 'modified');
  });

  it('rejects a recorded migration whose file has disappeared', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sdris-it-'));
    assert.equal(
      await codeOf(applyScripts(target.connection.pool, 'migration', dir)),
      'MISSING_FILE',
    );
  });

  it('rejects a new migration numbered below one already applied', async () => {
    await q(
      `insert into system.schema_migrations (version, name, checksum) values ('0005', 'later', 'x')`,
    );
    const dir = scratchMigrations({ '0003_late.sql': 'create schema late_schema;' });
    // 0005 has no file here, so supply a file for it to isolate the ordering rule.
    writeFileSync(path.join(dir, '0005_later.sql'), 'x');
    await q(`update system.schema_migrations set checksum = $1 where version = '0005'`, [
      (await import('./migrations')).checksumOf('x'),
    ]);
    assert.equal(
      await codeOf(applyScripts(target.connection.pool, 'migration', dir)),
      'OUT_OF_ORDER',
    );
    await q(`delete from system.schema_migrations where version = '0005'`);
  });

  it('rolls back a failing migration, records nothing, and reports the file', async () => {
    const dir = scratchMigrations({
      '0002_half_done.sql': 'create schema half_done; select * from table_that_does_not_exist;',
    });
    try {
      await applyScripts(target.connection.pool, 'migration', dir);
      assert.fail('expected failure');
    } catch (error) {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, 'SCRIPT_FAILED');
      assert.equal(error.file, '0002_half_done.sql');
      assert.match(error.message, /table_that_does_not_exist/);
    }
    assert.equal(
      (await q(`select count(*)::int as n from pg_namespace where nspname='half_done'`))[0].n,
      0,
    );
    assert.equal(
      (await q(`select count(*)::int as n from system.schema_migrations where version='0002'`))[0]
        .n,
      0,
    );
  });

  it('runs each script inside one explicit transaction together with its tracking row', async () => {
    // VACUUM is rejected inside a transaction block even as a lone statement, so this only fails
    // if the runner really wraps the script (and its tracking insert) in BEGIN ... COMMIT.
    const dir = scratchMigrations({ '0002_needs_no_transaction.sql': 'vacuum;' });
    try {
      await applyScripts(target.connection.pool, 'migration', dir);
      assert.fail('expected the script to be rejected inside a transaction block');
    } catch (error) {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, 'SCRIPT_FAILED');
      assert.match(error.message, /transaction block/);
    }
    assert.equal(
      (await q(`select count(*)::int as n from system.schema_migrations where version='0002'`))[0]
        .n,
      0,
    );
  });

  it('serialises concurrent runners: each script is applied exactly once', async () => {
    const fresh = await createIsolatedDatabase();
    try {
      const dir = scratchMigrations({ '0002_probe_b.sql': 'create schema probe_b;' });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => applyScripts(fresh.connection.pool, 'migration', dir)),
      );
      assert.equal(results.flat().length, 2, 'two scripts applied in total across all runners');
      const { rows } = await fresh.connection.pool.query(
        'select count(*)::int as n from system.schema_migrations',
      );
      assert.equal(rows[0].n, 2);
    } finally {
      await fresh.drop();
    }
  });

  it('tracks seeds separately and applies them once', async () => {
    assert.deepEqual(await applyScripts(target.connection.pool, 'seed', SEEDS), [
      '0001_synthetic_baseline.sql',
    ]);
    assert.deepEqual(await applyScripts(target.connection.pool, 'seed', SEEDS), []);
    assert.equal((await q('select count(*)::int as n from system.schema_seeds'))[0].n, 1);
  });
});

describe('db CLI against real PostgreSQL', () => {
  let target: IsolatedDatabase;
  before(async () => {
    target = await createIsolatedDatabase();
  });
  after(async () => {
    await target.drop();
  });

  const cli = async (command: string, url: string, env: Record<string, string> = {}) => {
    try {
      const { stdout, stderr } = await run('pnpm', ['exec', 'tsx', 'src/cli.ts', command], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development', ...env },
      });
      return { code: 0, out: stdout + stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };
  const hasSchema = async (name: string) =>
    (await target.connection.pool.query(`select 1 from pg_namespace where nspname = $1`, [name]))
      .rowCount === 1;

  it('migrate, status and seed succeed and are repeatable', async () => {
    assert.equal((await cli('migrate', target.url)).code, 0);
    assert.equal((await cli('migrate', target.url)).code, 0);
    const status = await cli('status', target.url);
    assert.equal(status.code, 0);
    assert.match(status.out, /applied\s+0001_create_bounded_context_schemas\.sql/);
    assert.equal((await cli('seed', target.url)).code, 0);
  });

  it('reset drops and recreates SDRIS schemas on an allowed target', async () => {
    await target.connection.pool.query('create schema untouched_foreign_schema');
    const result = await cli('reset', target.url);
    assert.equal(result.code, 0, result.out);
    assert.ok(await hasSchema('investigation'));
    assert.ok(await hasSchema('untouched_foreign_schema'), 'reset must only drop SDRIS schemas');
    await target.connection.pool.query('drop schema untouched_foreign_schema');
  });

  it('reset and seed are refused for non-development targets, before any connection', async () => {
    const attempts = [
      'postgresql://u:p@db.example.com:5432/sdris_local',
      'postgresql://u:p@localhost:5432/sdris_prod',
      'postgresql://u:p@localhost:5432/postgres',
    ];
    for (const url of attempts) {
      for (const command of ['reset', 'seed']) {
        const result = await cli(command, url);
        assert.equal(result.code, 1, `${command} ${url}: ${result.out}`);
        assert.match(result.out, /Refusing to/);
      }
    }
    const production = await cli('reset', target.url, { NODE_ENV: 'production' });
    assert.equal(production.code, 1);
    assert.match(production.out, /production/);
    assert.ok(await hasSchema('investigation'), 'refused reset must leave the database intact');
  });

  it('migration failure exits non-zero with an actionable message', async () => {
    const broken = await createIsolatedDatabase();
    try {
      await broken.connection.pool.query('create schema system');
      await broken.connection.pool.query(
        `create table system.schema_migrations (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`,
      );
      await broken.connection.pool.query(
        `insert into system.schema_migrations (version, name, checksum) values ('0001', 'create_bounded_context_schemas', 'not-the-real-checksum')`,
      );
      const result = await cli('migrate', broken.url);
      assert.equal(result.code, 1);
      assert.match(result.out, /CHECKSUM_MISMATCH.*0001_create_bounded_context_schemas\.sql/s);
      assert.equal((await cli('status', broken.url)).code, 1);
    } finally {
      await broken.drop();
    }
  });

  it('reports an unreachable database with exit code 2', async () => {
    const result = await cli('migrate', 'postgresql://u:p@127.0.0.1:1/sdris_local');
    assert.equal(result.code, 2);
    assert.match(result.out, /pnpm db:up/);
  });
});
