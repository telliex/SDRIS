import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DatabaseConnection } from '@sdris/database';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
} from './identity';
import { syntheticPrincipalsFixture } from './identity/synthetic-principals.fixtures';
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
const OPTIONS = { principals: syntheticPrincipalsFixture, securityEvents: () => undefined };
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
            principals: syntheticPrincipalsFixture,
            securityEvents: (event) => events.push(event as IssuanceRefusedEvent),
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
            OPTIONS,
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
        () => composeInvestigation(connectionFor(GOOD), forged as never, OPTIONS),
        (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
    }
  });

  it('a pending or rejecting asynchronous sink neither delays nor changes the refusal, and nothing is touched', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      for (const sink of [
        () => new Promise<void>(() => undefined),
        () => Promise.reject(new Error('sink down')),
      ]) {
        touched.length = 0;
        assert.throws(
          () =>
            composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), {
              principals: syntheticPrincipalsFixture,
              securityEvents: sink as never,
              clock,
            }),
          (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
        );
        assert.deepEqual(touched, []);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  describe('the required security event sink is validated at composition (regression)', () => {
    const allowed = () => readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' });
    // A principal table the issuer would reject: if the sink check really comes first, this is never reached.
    const poisoned = [{ key: '' }] as never;
    const invalidSinks: Array<[string, unknown]> = [
      ['missing', undefined],
      ['null', null],
      ['a string', 'sink'],
      ['a number', 7],
      ['an object', {}],
      ['an object with a record method', { record: () => undefined }],
    ];
    for (const [label, sink] of invalidSinks) {
      it(`refuses an allowed environment whose securityEvents is ${label} before the issuer, the service or any query`, () => {
        touched.length = 0;
        assert.throws(
          () =>
            composeInvestigation(connectionFor(GOOD), allowed(), {
              principals: poisoned,
              securityEvents: sink as never,
            }),
          (error) => {
            // not a forbidden-environment error, and not the issuer's principal error: the sink check came first
            return (
              error instanceof TypeError &&
              !(error instanceof SyntheticIdentityForbiddenError) &&
              /securityEvents/.test(error.message)
            );
          },
        );
        assert.deepEqual(touched, []);
      });
    }

    it('a securityEvents getter that throws on a forbidden environment never replaces the forbidden refusal (regression)', () => {
      touched.length = 0;
      let reads = 0;
      const options = {
        principals: syntheticPrincipalsFixture,
        get securityEvents(): never {
          reads += 1;
          throw new Error('getter down');
        },
      };
      assert.throws(
        () =>
          composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), options as never),
        (error) =>
          error instanceof SyntheticIdentityForbiddenError &&
          code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
      assert.equal(reads, 1, 'the property is looked up once');
      assert.deepEqual(touched, [], 'nothing was constructed or touched');
    });

    it('the same throwing getter on an allowed environment is an invalid sink, not an escaped getter error', () => {
      touched.length = 0;
      const options = {
        principals: syntheticPrincipalsFixture,
        get securityEvents(): never {
          throw new Error('getter down');
        },
      };
      assert.throws(
        () => composeInvestigation(connectionFor(GOOD), allowed(), options as never),
        (error) => error instanceof TypeError && /securityEvents/.test(error.message),
      );
      assert.deepEqual(touched, []);
    });

    it('a sink getter on a forbidden environment that is callable is still used to report, once', () => {
      touched.length = 0;
      const seen: IssuanceRefusedEvent[] = [];
      let reads = 0;
      const options = {
        principals: syntheticPrincipalsFixture,
        clock,
        get securityEvents() {
          reads += 1;
          return (event: IssuanceRefusedEvent) => seen.push(event);
        },
      };
      assert.throws(
        () =>
          composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), options as never),
        (error) => code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
      assert.equal(reads, 1);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.reason, 'synthetic_forbidden');
    });

    it('also refuses when the whole options object is missing', () => {
      assert.throws(
        () => composeInvestigation(connectionFor(GOOD), allowed(), undefined as never),
        (error) => error instanceof TypeError && /securityEvents/.test(error.message),
      );
    });

    for (const [label, sink] of invalidSinks) {
      it(`keeps the forbidden-environment error when the sink is ${label}`, () => {
        touched.length = 0;
        const reports: unknown[] = [];
        assert.throws(
          () =>
            composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), {
              principals: poisoned,
              securityEvents: sink as never,
              reportSinkFailure: (report) => reports.push(report),
            }),
          (error) =>
            error instanceof SyntheticIdentityForbiddenError &&
            code(error) === 'SYNTHETIC_IDENTITY_FORBIDDEN',
        );
        assert.deepEqual(touched, []);
      });
    }
  });

  it('a throwing sink never masks the refusal', () => {
    assert.throws(
      () =>
        composeInvestigation(connectionFor(GOOD), readTrustedEnvironment({}), {
          principals: syntheticPrincipalsFixture,
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
        OPTIONS,
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
