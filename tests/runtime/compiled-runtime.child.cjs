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
  // The compiled identity module (S0-06 WP-02). Its fixtures are excluded from the build, so the principals of this
  // process are created here with random ids; no fixture file is needed or present in dist.
  const identity = require(
    path.join(repo, 'apps', 'api', 'dist', 'composition', 'identity', 'index.js'),
  );
  const environmentOf = (record) => identity.readTrustedEnvironment(record);
  const target = await testing.createIsolatedDatabase();
  try {
    const pool = target.connection.pool;
    await database.applyScripts(
      pool,
      'migration',
      path.join(repo, 'infrastructure', 'database', 'migrations'),
    );
    // Paired startup verification (specification 3.2): the positive control, then the same code, database and
    // principal list with only the environment changed. A refusal must carry code SYNTHETIC_IDENTITY_FORBIDDEN
    // and happen before any query or connection checkout.
    const { service } = composeInvestigation(
      target.connection,
      environmentOf({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
    );
    check('composition returns a service', typeof service.linkAttempt === 'function');
    const principal = {
      key: 'compiled-runtime-principal',
      actor: { entityType: 'Actor', id: kernel.newEntityId() },
      actorKind: 'SYSTEM',
      permissions: ['investigation.read'],
    };
    const issuerFor = (record) =>
      identity.createSyntheticIssuer({
        environment: environmentOf(record),
        clock: () => kernel.timestampFromDate(new Date()).value,
        principals: [principal],
        securityEvents: () => undefined,
      });
    const positiveIssuer = issuerFor({ SDRIS_ENV: 'test', NODE_ENV: 'test' });
    const issued = positiveIssuer.issue(principal.key);
    check(
      'positive control: an ephemeral principal obtains a handle that resolves',
      issued.status === 'issued' &&
        positiveIssuer.resolver.resolve(issued.handle).status === 'valid',
    );
    let counted = 0;
    const realQuery = pool.query.bind(pool);
    const realConnect = pool.connect.bind(pool);
    pool.query = (...args) => ((counted += 1), realQuery(...args));
    pool.connect = (...args) => ((counted += 1), realConnect(...args));
    const forbiddenEnvironments = [
      { NODE_ENV: 'production', SDRIS_ENV: 'test' },
      { NODE_ENV: 'test' },
      { NODE_ENV: 'test', SDRIS_ENV: '' },
      { NODE_ENV: 'test', SDRIS_ENV: 'prod' },
      { NODE_ENV: 'test', SDRIS_ENV: 'Test' },
      { NODE_ENV: 'production', SDRIS_ENV: 'local' },
    ];
    for (const record of forbiddenEnvironments) {
      let compose;
      let issuer;
      try {
        composeInvestigation(target.connection, environmentOf(record));
      } catch (error) {
        compose = error;
      }
      try {
        issuerFor(record);
      } catch (error) {
        issuer = error;
      }
      check(
        `negative control ${JSON.stringify(record)}: compose and issuer refuse with SYNTHETIC_IDENTITY_FORBIDDEN`,
        compose?.code === 'SYNTHETIC_IDENTITY_FORBIDDEN' &&
          issuer?.code === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
    }
    check('every refusal happened before any query or connection checkout', counted === 0);
    pool.query = realQuery;
    pool.connect = realConnect;

    const registerUut = async () => {
      const result = await service.registerUut({ serialNumber: ' SN-SYNTHETIC ' });
      assert.ok(result.ok);
      return result.value;
    };
    const refOf = (u) => {
      const ref = kernel.createEntityRef('UUT', u.id);
      assert.ok(ref.ok);
      return ref.value;
    };

    // UUT, TestAttempt, case: register, open and read back
    const unit = await registerUut();
    check(
      'register UUT keeps the serial number as given',
      (await service.getUut(unit.id)).serialNumber === ' SN-SYNTHETIC ',
    );
    const attempt = await service.registerTestAttempt({ uutId: unit.id, stage: 'IST' });
    check(
      'register test attempt',
      attempt.ok && (await service.getTestAttempt(attempt.value.id)).stage === 'IST',
    );
    const badStage = await service.registerTestAttempt({ uutId: unit.id, stage: 'ist' });
    check(
      'invalid stage rejected',
      !badStage.ok && badStage.error.code === 'investigation.invalid_test_stage',
    );
    const opened = await service.openCase({ uut: refOf(unit) });
    check('open case', opened.ok);
    const loaded = await service.getCase(opened.value.id);
    check('round trip', loaded && loaded.id === opened.value.id && loaded.version === 1);

    // commit: version bump and link together
    const linked = await service.linkAttempt({
      caseId: opened.value.id,
      attemptId: attempt.value.id,
      role: 'INITIAL_FAILURE',
      expectedVersion: 1,
    });
    check('link test attempt', linked.ok && linked.value.version === 2 && linked.value.created);
    check('commit persisted both writes', (await caseCount(pool, 'case_test_attempt_link')) === 1);

    // idempotency: an identical repeat writes nothing and does not advance the version
    const again = await service.linkAttempt({
      caseId: opened.value.id,
      attemptId: attempt.value.id,
      role: 'INITIAL_FAILURE',
      expectedVersion: 2,
    });
    check(
      'identical link is idempotent',
      again.ok && !again.value.created && again.value.version === 2,
    );
    check(
      'idempotent repeat changed nothing',
      (await caseCount(pool, 'case_test_attempt_link')) === 1 &&
        (await service.getCase(opened.value.id)).version === 2,
    );

    // Expected Version beats idempotency: the same request at the old version 1 is a conflict although the link exists
    const staleDuplicate = await service.linkAttempt({
      caseId: opened.value.id,
      attemptId: attempt.value.id,
      role: 'INITIAL_FAILURE',
      expectedVersion: 1,
    });
    check(
      'stale version beats idempotency',
      !staleDuplicate.ok && staleDuplicate.error.code === 'investigation.concurrency_conflict',
    );

    // cross-UUT rejection stores nothing and does not advance the version
    const foreign = await service.registerTestAttempt({
      uutId: (await registerUut()).id,
      stage: 'SAT',
    });
    const crossUut = await service.linkAttempt({
      caseId: opened.value.id,
      attemptId: foreign.value.id,
      role: 'SUPPORTING',
      expectedVersion: 2,
    });
    check(
      'cross-UUT rejected',
      !crossUut.ok && crossUut.error.code === 'investigation.uut_mismatch',
    );
    check(
      'cross-UUT stored nothing',
      (await caseCount(pool, 'case_test_attempt_link')) === 1 &&
        (await service.getCase(opened.value.id)).version === 2,
    );

    // database-level cross-UUT protection (composite foreign keys)
    await assert.rejects(
      pool.query(
        `insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, 'CONTEXT', now())`,
        [opened.value.id, foreign.value.id, unit.id],
      ),
      (error) => database.pgErrorCode(error) === '23503',
    );
    check('database composite foreign keys reject cross-UUT rows', true);

    // rollback: a database failure after the version bump leaves nothing behind
    await pool.query(
      `create function investigation.reject_insert() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`,
    );
    await pool.query(
      'create trigger reject_link before insert on investigation.case_test_attempt_link for each row execute function investigation.reject_insert()',
    );
    try {
      await assert.rejects(
        service.linkAttempt({
          caseId: opened.value.id,
          attemptId: attempt.value.id,
          role: 'RETEST',
          expectedVersion: 2,
        }),
        (error) => causedBy(error, /injected failure/),
      );
    } finally {
      await pool.query('drop trigger reject_link on investigation.case_test_attempt_link');
      await pool.query('drop function investigation.reject_insert()');
    }
    check('rollback restored the version', (await service.getCase(opened.value.id)).version === 2);
    check('rollback stored nothing', (await caseCount(pool, 'case_test_attempt_link')) === 1);

    // optimistic concurrency, deterministically: a writer that read v2 must lose to a writer that reached v3
    const other = await pool.connect();
    try {
      await other.query('begin');
      await other.query(
        'update investigation.investigation_case set version = version + 1 where id = $1',
        [opened.value.id],
      );
      const stale = service.linkAttempt({
        caseId: opened.value.id,
        attemptId: attempt.value.id,
        role: 'RETEST',
        expectedVersion: 2,
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
    check('stale writer stored nothing', final.version === 3 && final.links.length === 1);

    // deterministic retrieval order: registered_at, attempt id, role
    const second = await service.registerTestAttempt({ uutId: unit.id, stage: 'SAT' });
    let nextVersion = 3;
    for (const role of ['CONTEXT', 'RETEST', 'INITIAL_FAILURE']) {
      const result = await service.linkAttempt({
        caseId: opened.value.id,
        attemptId: second.value.id,
        role,
        expectedVersion: nextVersion,
      });
      assert.ok(result.ok);
      nextVersion = result.value.version;
    }
    const ordered = (await service.getCase(opened.value.id)).links.map((l) => l.role);
    check(
      'links are returned in the approved order',
      JSON.stringify(ordered) ===
        JSON.stringify(['INITIAL_FAILURE', 'INITIAL_FAILURE', 'RETEST', 'CONTEXT']),
    );

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
