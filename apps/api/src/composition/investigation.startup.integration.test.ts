import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createDatabase } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import {
  SyntheticIdentityForbiddenError,
  createSyntheticIssuer,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
} from './identity';
import { syntheticPrincipalsFixture } from './identity/synthetic-principals.fixtures';
import { composeInvestigation } from './investigation.composition';
import { timestampFromDate } from '@sdris/shared-kernel';

/**
 * Paired startup verification against real PostgreSQL (S0-06 WP-02, specification 3.2, logic level; the compiled
 * form is in tests/runtime). The positive control runs in the identical setup as every negative case: same
 * database connection, same principal list, same code; only the environment changes. So a refusal cannot be
 * explained by a missing dependency.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../../infrastructure/database/migrations');

describe('composeInvestigation startup (real PostgreSQL, isolated database)', () => {
  let target: IsolatedDatabase;
  let queries: number;
  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    // Count every query or checkout from now on, to prove a refusal happens before any database work.
    const pool = target.connection.pool;
    const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    const originalConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
    pool.query = ((...args: unknown[]) => {
      queries += 1;
      return originalQuery(...args);
    }) as never;
    pool.connect = ((...args: unknown[]) => {
      queries += 1;
      return originalConnect(...args);
    }) as never;
  });
  after(async () => {
    await target.drop();
  });

  const events = (): IssuanceRefusedEvent[] => [];
  const refuse =
    (env: Record<string, string | undefined>, sink?: (e: IssuanceRefusedEvent) => void) => () =>
      composeInvestigation(target.connection, readTrustedEnvironment(env), {
        ...(sink ? { securityEvents: sink } : {}),
      });
  const isForbidden = (error: unknown) =>
    error instanceof SyntheticIdentityForbiddenError &&
    error.code === 'SYNTHETIC_IDENTITY_FORBIDDEN';

  it('positive control: with SDRIS_ENV=test it composes, issues a handle for an ephemeral principal and one command succeeds', async () => {
    queries = 0;
    const environment = readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' });
    const { service } = composeInvestigation(target.connection, environment);
    const issued: IssuanceRefusedEvent[] = [];
    const issuer = createSyntheticIssuer({
      environment,
      clock: () => {
        const result = timestampFromDate(new Date());
        if (!result.ok) throw new Error('clock');
        return result.value;
      },
      principals: syntheticPrincipalsFixture,
      securityEvents: (event) => issued.push(event),
    });
    const outcome = issuer.issue('fixture-engineer');
    assert.equal(outcome.status, 'issued');
    assert.equal(
      issuer.resolver.resolve(outcome.status === 'issued' ? outcome.handle : undefined).status,
      'valid',
    );
    const registered = await service.registerUut({ serialNumber: 'SN-STARTUP' });
    assert.ok(registered.ok, 'every other dependency is present');
    assert.ok(queries > 0, 'the positive control really used the database');
    assert.deepEqual(issued, []);
  });

  const environments: Array<[string, Record<string, string | undefined>]> = [
    ['NODE_ENV=production', { SDRIS_ENV: 'test', NODE_ENV: 'production' }],
    ['SDRIS_ENV unset', { NODE_ENV: 'test' }],
    ['SDRIS_ENV empty', { SDRIS_ENV: '', NODE_ENV: 'test' }],
    ['SDRIS_ENV=prod', { SDRIS_ENV: 'prod', NODE_ENV: 'test' }],
    ['SDRIS_ENV=Test', { SDRIS_ENV: 'Test', NODE_ENV: 'test' }],
    [
      'conflicting: SDRIS_ENV=local and NODE_ENV=production',
      { SDRIS_ENV: 'local', NODE_ENV: 'production' },
    ],
  ];
  for (const [label, env] of environments) {
    it(`negative control, same database and code, only the environment changed: ${label}`, () => {
      queries = 0;
      const seen = events();
      assert.throws(
        refuse(env, (event) => seen.push(event)),
        isForbidden,
      );
      assert.equal(queries, 0, 'refused before any query or connection checkout');
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.reason, 'synthetic_forbidden');
    });
  }

  it('a connection that is not a disposable local database is refused even in a matching environment', () => {
    const remote = createDatabase('postgresql://u:p@db.example.com:5432/sdris_test_ab12cd34');
    try {
      assert.throws(
        () =>
          composeInvestigation(
            remote,
            readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
          ),
        isForbidden,
      );
    } finally {
      void remote.close();
    }
  });
});
