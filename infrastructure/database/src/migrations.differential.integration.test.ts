import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { findTransactionControl } from './migrations';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';
import { generateScript, mulberry32 } from './testing/script-generator';

/**
 * Differential test of the scanner alone: real PostgreSQL is the ground truth for "did any part of this
 * script commit?". The script creates a marker schema first; after it runs (or fails) and the test rolls
 * back, a surviving marker proves a commit happened. On success a `SET LOCAL` sentinel that vanished also
 * proves the transaction ended. Scripts that raise an error are NOT skipped: a commit followed by an error
 * is exactly the partial-commit case. Every escaping script must be flagged; control-free scripts must not
 * be. The scanner assumes standard_conforming_strings = on; this test pins it, and the runner enforces it
 * per script (see migrations.invariant.integration.test.ts for drifting settings).
 */
describe('transaction-control scanner vs PostgreSQL (differential)', () => {
  let target: IsolatedDatabase;
  before(async () => {
    target = await createIsolatedDatabase();
  });
  after(async () => {
    await target.drop();
  });

  it('flags every generated script that commits or ends its transaction, including commit-then-error', async () => {
    const random = mulberry32(Number(process.env.SDRIS_FUZZ_SEED ?? 20261115));
    const iterations = Number(process.env.SDRIS_FUZZ_ITERATIONS ?? 700);
    const client = await target.connection.pool.connect();
    const stats = { escaped: 0, escapedThenError: 0, rejectedWithoutEffect: 0, clean: 0 };
    try {
      await client.query('set standard_conforming_strings = on');
      for (let n = 0; n < iterations; n += 1) {
        const { sql, marker, hasControl } = generateScript(random, n);
        const flagged = findTransactionControl(sql) !== undefined;
        let failed = false;
        let errorCode: string | undefined;
        let sentinelLost = false;
        try {
          await client.query('begin');
          await client.query("select set_config('sdris.probe', 'inside', true)");
          await client.query(sql);
          sentinelLost =
            (await client.query("select current_setting('sdris.probe', true) as v")).rows[0].v !==
            'inside';
        } catch (error) {
          failed = true;
          errorCode = (error as { code?: string }).code;
        }
        await client.query('rollback').catch(() => undefined);
        const committed =
          (await client.query('select 1 from pg_namespace where nspname = $1', [marker]))
            .rowCount === 1;
        const escaped = committed || sentinelLost;
        if (escaped) {
          stats.escaped += 1;
          if (failed) stats.escapedThenError += 1;
          assert.ok(
            flagged,
            `PostgreSQL let this script ${committed ? 'commit part of itself' : 'end its transaction'}` +
              `${failed ? ' and then raise an error' : ''}, but the scanner did not flag it:\n${JSON.stringify(sql)}`,
          );
        } else if (failed) {
          stats.rejectedWithoutEffect += 1;
        }
        // A script PostgreSQL cannot even parse (42601) may be refused by the scanner too; that is safe.
        if (!hasControl && errorCode !== '42601') {
          stats.clean += 1;
          assert.ok(
            !flagged,
            `scanner rejected a script with no transaction control:\n${JSON.stringify(sql)}`,
          );
        }
        await client.query(`drop schema if exists ${marker} cascade`);
        await client.query('drop schema public cascade; create schema public');
      }
    } finally {
      client.release();
    }
    assert.ok(stats.escaped >= iterations * 0.2, `generator too weak: ${JSON.stringify(stats)}`);
    assert.ok(
      stats.escapedThenError >= iterations * 0.03,
      `no commit-then-error coverage: ${JSON.stringify(stats)}`,
    );
    assert.ok(stats.clean >= iterations * 0.14, `generator too weak: ${JSON.stringify(stats)}`);
  });
});
