import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createDatabase, type DatabaseConnection } from './connection';
import { applyScripts, MigrationError } from './migrations';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';
import { generateScript, mulberry32 } from './testing/script-generator';

const OFF = 'set standard_conforming_strings = off;';
const withOption = (url: string, option: string): string => {
  const u = new URL(url);
  u.searchParams.set('options', option);
  return u.toString();
};
const dirWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdris-inv-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
};
const outcome = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'applied';
  } catch (error) {
    return error instanceof MigrationError ? error.code : `other: ${error}`;
  }
};

/**
 * The runner pins standard_conforming_strings = on for every script (SET LOCAL at the start of its
 * transaction), because the transaction-control scanner reads strings that way. Whatever the session
 * default is (connection option, database default, a role default, or a previous migration), the outcome
 * for a script must be all-or-nothing: either it is applied with its ledger row, or nothing it did is
 * visible. Role-level defaults reach the session the same way as the database and connection defaults
 * tested here, and are not altered because the role is shared with the developer's local database.
 */
describe('runner invariant under session-setting drift (real PostgreSQL)', () => {
  let normal: IsolatedDatabase;
  let dbOff: IsolatedDatabase;
  let dbOffPool: DatabaseConnection;
  before(async () => {
    normal = await createIsolatedDatabase();
    dbOff = await createIsolatedDatabase();
    await dbOff.connection.pool.query(
      `alter database "${dbOff.name}" set standard_conforming_strings = off`,
    );
    dbOffPool = createDatabase(dbOff.url, { max: 4 }); // new connections pick up the database default
  });
  after(async () => {
    await dbOffPool.close();
    await normal.drop();
    await dbOff.drop();
  });

  const exists = async (pool: DatabaseConnection['pool'], schema: string) =>
    (await pool.query('select 1 from pg_namespace where nspname = $1', [schema])).rowCount === 1;
  const ledger = async (pool: DatabaseConnection['pool']) => {
    // A script rejected by the pre-scan never reaches the database, so the ledger table may not exist yet.
    if (
      (await pool.query("select to_regclass('system.schema_migrations') as t")).rows[0].t === null
    )
      return [];
    return (
      await pool.query('select version from system.schema_migrations order by version')
    ).rows.map((r) => r.version);
  };
  const reset = async (pool: DatabaseConnection['pool'], schemas: string[]) => {
    for (const s of schemas) await pool.query(`drop schema if exists ${s} cascade`);
    await pool.query('drop table if exists system.schema_migrations');
  };

  it('is a real drift: the session defaults used below are actually off', async () => {
    const viaOption = createDatabase(withOption(normal.url, '-c standard_conforming_strings=off'), {
      max: 1,
    });
    try {
      assert.equal(
        (await viaOption.pool.query('show standard_conforming_strings')).rows[0]
          .standard_conforming_strings,
        'off',
      );
      assert.equal(
        (await dbOffPool.pool.query('show standard_conforming_strings')).rows[0]
          .standard_conforming_strings,
        'off',
      );
    } finally {
      await viaOption.close();
    }
  });

  // The review's exact scenario, and its variants for each way a session can start with the setting off.
  const reviewScript = [
    'create schema atomicity_probe;',
    "select 'a\\'';",
    'COMMIT;',
    "select 'x';",
    'select * from no_such_review_table;',
  ].join('\n');

  const scenarios: { name: string; pool: () => Promise<DatabaseConnection>; prior?: string }[] = [
    {
      name: 'a previous migration turned the setting off',
      pool: async () => normal.connection,
      prior: OFF,
    },
    { name: 'the database default is off', pool: async () => dbOffPool },
    {
      name: 'the connection was opened with the setting off',
      pool: async () =>
        createDatabase(withOption(normal.url, '-c standard_conforming_strings=off'), { max: 2 }),
    },
    {
      name: 'every source is off at once',
      pool: async () =>
        createDatabase(withOption(dbOff.url, '-c standard_conforming_strings=off'), { max: 2 }),
      prior: OFF,
    },
  ];

  for (const scenario of scenarios) {
    it(`leaves no schema, data or ledger row from a rejected script when ${scenario.name}`, async () => {
      const connection = await scenario.pool();
      try {
        const files: Record<string, string> = { '0002_escape.sql': reviewScript };
        if (scenario.prior) files['0001_settings.sql'] = scenario.prior;
        const result = await outcome(applyScripts(connection.pool, 'migration', dirWith(files)));
        assert.notEqual(result, 'applied');
        assert.equal(
          await exists(connection.pool, 'atomicity_probe'),
          false,
          'partial schema was committed',
        );
        assert.ok(!(await ledger(connection.pool)).includes('0002'));
      } finally {
        await reset(connection.pool, ['atomicity_probe']);
        if (connection !== normal.connection && connection !== dbOffPool) await connection.close();
      }
    });

    it(`still applies a later valid migration, whose meaning needs the setting on, when ${scenario.name}`, async () => {
      const connection = await scenario.pool();
      try {
        // `'a\'` is a complete string only when standard_conforming_strings is on.
        const files: Record<string, string> = {
          '0002_needs_standard_strings.sql': "create schema needs_on; select 'a\\';",
          '0003_next.sql': 'create schema after_it;',
        };
        if (scenario.prior) files['0001_settings.sql'] = scenario.prior;
        assert.equal(
          await outcome(applyScripts(connection.pool, 'migration', dirWith(files))),
          'applied',
        );
        assert.equal(await exists(connection.pool, 'needs_on'), true);
        assert.equal(await exists(connection.pool, 'after_it'), true);
        assert.deepEqual(
          await ledger(connection.pool),
          scenario.prior ? ['0001', '0002', '0003'] : ['0002', '0003'],
        );
      } finally {
        await reset(connection.pool, ['needs_on', 'after_it']);
        if (connection !== normal.connection && connection !== dbOffPool) await connection.close();
      }
    });
  }

  it('recovers across files: after a rejected script is removed, the next migration applies', async () => {
    const bad = dirWith({ '0001_settings.sql': OFF, '0002_escape.sql': reviewScript });
    assert.notEqual(
      await outcome(applyScripts(normal.connection.pool, 'migration', bad)),
      'applied',
    );
    const good = dirWith({
      '0001_settings.sql': OFF,
      '0003_ok.sql': "create schema recovered; select 'a\\';",
    });
    assert.equal(await outcome(applyScripts(normal.connection.pool, 'migration', good)), 'applied');
    assert.equal(await exists(normal.connection.pool, 'recovered'), true);
    await reset(normal.connection.pool, ['recovered', 'atomicity_probe']);
  });

  it('keeps every generated script all-or-nothing, whatever the session default was', async () => {
    const random = mulberry32(Number(process.env.SDRIS_FUZZ_SEED ?? 20261115) + 1);
    const iterations = Number(process.env.SDRIS_FUZZ_ITERATIONS ?? 300);
    const stats = { applied: 0, rejected: 0 };
    for (let n = 0; n < iterations; n += 1) {
      const { sql, marker } = generateScript(random, n);
      const scenario = scenarios[n % scenarios.length]!;
      const connection = await scenario.pool();
      try {
        const files: Record<string, string> = { '0002_generated.sql': sql };
        if (scenario.prior) files['0001_settings.sql'] = scenario.prior;
        const result = await outcome(applyScripts(connection.pool, 'migration', dirWith(files)));
        const visible = await exists(connection.pool, marker);
        const recorded = (await ledger(connection.pool)).includes('0002');
        assert.equal(
          visible,
          recorded,
          `${scenario.name}: script ${result}, marker visible=${visible}, ledger recorded=${recorded}\n${JSON.stringify(sql)}`,
        );
        if (result === 'applied') stats.applied += 1;
        else stats.rejected += 1;
      } finally {
        await connection.pool.query(`drop schema if exists ${marker} cascade`);
        await connection.pool.query('drop schema public cascade; create schema public');
        await connection.pool.query('drop table if exists system.schema_migrations');
        if (connection !== normal.connection && connection !== dbOffPool) await connection.close();
      }
    }
    assert.ok(stats.applied >= iterations * 0.05, `no applied coverage: ${JSON.stringify(stats)}`);
    assert.ok(stats.rejected >= iterations * 0.3, `no rejected coverage: ${JSON.stringify(stats)}`);
  });
});
