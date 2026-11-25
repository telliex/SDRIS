import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DatabaseConnection } from '@sdris/database';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
} from './identity';
import { composeInvestigation } from './investigation.composition';

/**
 * The refusal paths of the real `composeInvestigation` (S0-06 WP-02, specification 3.2), without a database:
 * every refusal happens before the module is built and before any query, so a connection that fails the test if it
 * is touched is enough. The paired positive control and the compiled form run against PostgreSQL elsewhere.
 */
const clock = (): Timestamp => {
  const result = timestampFromDate(new Date(Date.UTC(2026, 10, 25, 9, 0, 0, 0)));
  if (!result.ok) throw new Error('bad test time');
  return result.value;
};
const touched: string[] = [];
const connectionFor = (connectionString: string | undefined): DatabaseConnection => {
  const trap = (name: string) => () => {
    touched.push(name);
    throw new Error(`the database was touched through ${name}`);
  };
  return {
    pool: { options: { connectionString }, query: trap('query'), connect: trap('connect') },
    db: new Proxy({}, { get: (_t, name) => trap(String(name)) }),
    close: trap('close'),
  } as unknown as DatabaseConnection;
};
const GOOD = 'postgresql://u:p@localhost:5432/sdris_test_ab12cd34';

const code = (error: unknown) => (error as SyntheticIdentityForbiddenError).code;
type Env = Record<string, string | undefined>;
const refusedEnvironments: Array<[string, Env]> = [
  ['unset', {}],
  ['empty SDRIS_ENV', { SDRIS_ENV: '' }],
  ['SDRIS_ENV=production', { SDRIS_ENV: 'production' }],
  ['SDRIS_ENV=prod', { SDRIS_ENV: 'prod' }],
  ['SDRIS_ENV=Test', { SDRIS_ENV: 'Test' }],
  [
    'NODE_ENV=production with SDRIS_ENV=test (conflicting)',
    { SDRIS_ENV: 'test', NODE_ENV: 'production' },
  ],
];

describe('composeInvestigation fails closed', () => {
  for (const [label, env] of refusedEnvironments) {
    it(`refuses ${label} with SYNTHETIC_IDENTITY_FORBIDDEN before building the module or touching the database`, () => {
      touched.length = 0;
      const events: IssuanceRefusedEvent[] = [];
      assert.throws(
        () =>
          composeInvestigation(connectionFor(GOOD), readTrustedEnvironment(env), {
            securityEvents: (event) => events.push(event),
            clock,
          }),
        (error) =>
          error instanceof SyntheticIdentityForbiddenError &&
          code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
      assert.deepEqual(touched, []);
      assert.deepEqual(events, [
        {
          event: 'security.issuance_refused',
          at: clock(),
          origin: 'issuer',
          reason: 'synthetic_forbidden',
        },
      ]);
    });
  }

  const targets: Array<[string, string | undefined]> = [
    ['a remote database host', 'postgresql://u:p@db.example.com:5432/sdris_test_ab12cd34'],
    ['a database name that is not disposable', 'postgresql://u:p@localhost:5432/customers'],
    ['a missing connection string', undefined],
  ];
  for (const [label, url] of targets) {
    it(`refuses a positively matched environment with ${label}`, () => {
      touched.length = 0;
      assert.throws(
        () =>
          composeInvestigation(
            connectionFor(url),
            readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
          ),
        (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
      assert.deepEqual(touched, []);
    });
  }

  it('refuses an environment that only looks trusted (a plain object or a cast), whatever it says', () => {
    for (const forged of [
      { sdrisEnv: 'test', nodeEnv: 'test' },
      { ...readTrustedEnvironment({ SDRIS_ENV: 'test' }) },
      undefined,
    ]) {
      assert.throws(
        () => composeInvestigation(connectionFor(GOOD), forged as never),
        (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
    }
  });

  it('a throwing sink never masks the refusal', () => {
    assert.throws(
      () =>
        composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), {
          securityEvents: () => {
            throw new Error('sink down');
          },
          clock,
        }),
      (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
    );
  });

  it('the refusal message carries no environment, URL or credential text', () => {
    try {
      composeInvestigation(
        connectionFor('postgresql://admin:hunter2@db.example.com:5432/prod'),
        readTrustedEnvironment({ SDRIS_ENV: 'secret-environment-name' }),
      );
      assert.fail('should have thrown');
    } catch (error) {
      const text = `${(error as Error).message}${(error as Error).stack}`;
      assert.ok(
        !text.includes('hunter2') &&
          !text.includes('secret-environment-name') &&
          !text.includes('db.example.com'),
      );
    }
  });
});
