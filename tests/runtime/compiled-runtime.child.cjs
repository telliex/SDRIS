'use strict';
/**
 * Runs in a plain `node` process: no tsx, no loader flags, no custom export conditions. It loads the
 * COMPILED apps/api composition root and drives it against a real PostgreSQL database.
 * Prints one line, `RESULT <json>`, and exits non-zero on any failure.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const repo = path.resolve(__dirname, '..', '..');
const apiRequire = createRequire(path.join(repo, 'apps', 'api', 'package.json'));
const checks = {};
const check = (name, condition) => {
  assert.ok(condition, `check failed: ${name}`);
  checks[name] = true;
};

// ---- 0. This really is plain Node, with no TypeScript runtime
check('no tsx or loader flags', process.execArgv.length === 0);
check('no NODE_OPTIONS', (process.env.NODE_OPTIONS ?? '') === '');
check('no .ts extension handler registered', require.extensions['.ts'] === undefined);

// ---- 1. Package names resolve to compiled JavaScript
const resolved = {
  kernel: apiRequire.resolve('@sdris/shared-kernel'),
  database: apiRequire.resolve('@sdris/database'),
  testing: apiRequire.resolve('@sdris/database/testing'),
  investigationPublic: apiRequire.resolve('@sdris/investigation'),
  composition: apiRequire.resolve('@sdris/investigation/composition'),
};
for (const [name, file] of Object.entries(resolved)) {
  check(
    `${name} resolves to dist JavaScript`,
    /[\\/]dist[\\/].+\.js$/.test(file) && !file.endsWith('.d.ts'),
  );
}

const caseCount = async (pool, table) =>
  (await pool.query(`select count(*)::int as n from investigation.${table}`)).rows[0].n;
const causedBy = (error, pattern) => {
  for (let e = error, depth = 0; e && depth < 5; depth += 1, e = e.cause) {
    if (pattern.test(String(e.message ?? ''))) return true;
  }
  return false;
};

(async () => {
  const kernel = apiRequire('@sdris/shared-kernel');
  const database = apiRequire('@sdris/database');
  const testing = apiRequire('@sdris/database/testing');
  // The compiled composition root of apps/api, which itself requires the compiled Investigation composition.
  const { composeInvestigation } = require(
    path.join(repo, 'apps', 'api', 'dist', 'composition', 'investigation.composition.js'),
  );
  const uut = () => {
    const ref = kernel.createEntityRef('UUT', kernel.newEntityId());
    assert.ok(ref.ok);
    return ref.value;
  };

  const target = await testing.createIsolatedDatabase();
  try {
    const pool = target.connection.pool;
    await database.applyScripts(
      pool,
      'migration',
      path.join(repo, 'infrastructure', 'database', 'migrations'),
    );
    const { service } = composeInvestigation(target.connection);
    check('composition returns a service', typeof service.openCase === 'function');

    // open + read back
    const opened = await service.openCase({ uut: uut() });
    check('open case', opened.ok);
    const loaded = await service.getCase(opened.value.id);
    check('round trip', loaded && loaded.id === opened.value.id && loaded.version === 1);

    // commit: version bump and observation together
    const recorded = await service.recordObservation({
      caseId: opened.value.id,
      uut: opened.value.uut,
      description: 'compiled path',
    });
    check('record observation', recorded.ok && recorded.value.version === 2);
    check('commit persisted both writes', (await caseCount(pool, 'failure_observation')) === 1);

    // cross-UUT rejection stores nothing and does not advance the version
    const crossUut = await service.recordObservation({
      caseId: opened.value.id,
      uut: uut(),
      description: 'other unit',
    });
    check(
      'cross-UUT rejected',
      !crossUut.ok && crossUut.error.code === 'investigation.uut_mismatch',
    );
    check(
      'cross-UUT stored nothing',
      (await caseCount(pool, 'failure_observation')) === 1 &&
        (await service.getCase(opened.value.id)).version === 2,
    );

    // database-level cross-UUT protection (composite foreign key)
    await assert.rejects(
      pool.query(
        `insert into investigation.failure_observation (id, case_id, uut_id, description, observed_at) values ($1, $2, $3, 'forged', now())`,
        [kernel.newEntityId(), opened.value.id, kernel.newEntityId()],
      ),
      (error) => database.pgErrorCode(error) === '23503',
    );
    check('database composite foreign key rejects cross-UUT rows', true);

    // rollback: a database failure after the version bump leaves nothing behind
    await pool.query(
      `create function investigation.reject_insert() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`,
    );
    await pool.query(
      'create trigger reject_observation before insert on investigation.failure_observation for each row execute function investigation.reject_insert()',
    );
    try {
      await assert.rejects(
        service.recordObservation({
          caseId: opened.value.id,
          uut: opened.value.uut,
          description: 'will fail',
        }),
        (error) => causedBy(error, /injected failure/),
      );
    } finally {
      await pool.query('drop trigger reject_observation on investigation.failure_observation');
      await pool.query('drop function investigation.reject_insert()');
    }
    check('rollback restored the version', (await service.getCase(opened.value.id)).version === 2);
    check('rollback stored nothing', (await caseCount(pool, 'failure_observation')) === 1);

    // optimistic concurrency, deterministically: a writer that read v2 must lose to a writer that reached v3
    const other = await pool.connect();
    try {
      await other.query('begin');
      await other.query(
        'update investigation.investigation_case set version = version + 1 where id = $1',
        [opened.value.id],
      );
      const stale = service.recordObservation({
        caseId: opened.value.id,
        uut: opened.value.uut,
        description: 'decided on v2',
      });
      for (let waited = 0; ; waited += 10) {
        const blocked = await pool.query(
          "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
        );
        if (blocked.rows[0].n >= 1) break;
        assert.ok(waited < 5000, 'the stale writer never reached the row lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await other.query('commit');
      const result = await stale;
      check(
        'stale writer gets a concurrency conflict',
        !result.ok && result.error.code === 'investigation.concurrency_conflict',
      );
    } finally {
      other.release();
    }
    const final = await service.getCase(opened.value.id);
    check('stale writer stored nothing', final.version === 3 && final.observations.length === 1);

    // ---- 2. Nothing but compiled JavaScript was loaded from this repository
    const fromRepo = Object.keys(require.cache).filter(
      (f) => f.startsWith(repo) && f !== __filename,
    );
    check(
      'no TypeScript source was loaded',
      Object.keys(require.cache).every((f) => !/\.[cm]?tsx?$/.test(f)),
    );
    check(
      'workspace code came from dist',
      fromRepo
        .filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`))
        .every((f) => f.includes(`${path.sep}dist${path.sep}`)),
    );
    check(
      'no tsx module is loaded',
      Object.keys(require.cache).every((f) => !/[\\/]tsx[\\/]/.test(f)),
    );
    console.log(`RESULT ${JSON.stringify({ nodeVersion: process.version, resolved, checks })}`);
  } finally {
    await target.drop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
