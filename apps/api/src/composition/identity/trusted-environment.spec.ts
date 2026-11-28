import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  assertDisposableDatabaseTarget,
  assertSyntheticIdentityAllowed,
  createSyntheticIssuer,
  isTrustedEnvironment,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
} from './index';
import { syntheticPrincipalsFixture } from './synthetic-principals.fixtures';

/** Environment matrix and fail-closed construction (S0-06 WP-02, specification 3.2 and 2.10 tests 3 and 4). */
const clock = (): Timestamp => {
  const result = timestampFromDate(new Date(Date.UTC(2026, 10, 25, 9, 0, 0, 0)));
  if (!result.ok) throw new Error('bad test time');
  return result.value;
};
type Env = Record<string, string | undefined>;

const allowed: Array<[string, Env]> = [
  ['SDRIS_ENV=test, NODE_ENV=test', { SDRIS_ENV: 'test', NODE_ENV: 'test' }],
  ['SDRIS_ENV=local, NODE_ENV unset', { SDRIS_ENV: 'local' }],
  ['SDRIS_ENV=local, NODE_ENV=development', { SDRIS_ENV: 'local', NODE_ENV: 'development' }],
];
const forbidden: Array<[string, Env]> = [
  ['everything unset', {}],
  ['SDRIS_ENV unset, NODE_ENV=test', { NODE_ENV: 'test' }],
  ['SDRIS_ENV empty', { SDRIS_ENV: '', NODE_ENV: 'test' }],
  ['SDRIS_ENV whitespace', { SDRIS_ENV: ' ', NODE_ENV: 'test' }],
  ['SDRIS_ENV=production', { SDRIS_ENV: 'production' }],
  ['SDRIS_ENV=prod', { SDRIS_ENV: 'prod' }],
  ['SDRIS_ENV=Test (case differs)', { SDRIS_ENV: 'Test' }],
  ['SDRIS_ENV=LOCAL (case differs)', { SDRIS_ENV: 'LOCAL' }],
  ['SDRIS_ENV=test with trailing space', { SDRIS_ENV: 'test ' }],
  ['SDRIS_ENV=staging', { SDRIS_ENV: 'staging' }],
  [
    'conflicting: SDRIS_ENV=test but NODE_ENV=production',
    { SDRIS_ENV: 'test', NODE_ENV: 'production' },
  ],
  [
    'conflicting: SDRIS_ENV=local but NODE_ENV=Production',
    { SDRIS_ENV: 'local', NODE_ENV: 'Production' },
  ],
  ['conflicting: NODE_ENV=production with spaces', { SDRIS_ENV: 'test', NODE_ENV: ' production ' }],
];

describe('trusted environment', () => {
  it('is created only by readTrustedEnvironment and is frozen', () => {
    const environment = readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' });
    assert.ok(isTrustedEnvironment(environment));
    assert.ok(Object.isFrozen(environment));
  });

  it('a look-alike is not trusted: a plain object, a spread copy and a cast all fail at runtime', () => {
    const real = readTrustedEnvironment({ SDRIS_ENV: 'test' });
    const lookalikes: unknown[] = [
      { sdrisEnv: 'test', nodeEnv: 'test' },
      { ...real },
      Object.freeze({ sdrisEnv: 'test', nodeEnv: undefined }),
      Object.create(real),
      'test',
      undefined,
      null,
    ];
    for (const value of lookalikes) {
      assert.equal(isTrustedEnvironment(value), false);
      assert.throws(
        () => assertSyntheticIdentityAllowed(value),
        (error) => {
          return error instanceof SyntheticIdentityForbiddenError;
        },
      );
    }
  });

  for (const [label, env] of allowed) {
    it(`allows ${label}`, () => {
      assert.doesNotThrow(() => assertSyntheticIdentityAllowed(readTrustedEnvironment(env)));
    });
  }
  for (const [label, env] of forbidden) {
    it(`refuses ${label}`, () => {
      assert.throws(
        () => assertSyntheticIdentityAllowed(readTrustedEnvironment(env)),
        (error) => {
          return (
            error instanceof SyntheticIdentityForbiddenError &&
            (error as SyntheticIdentityForbiddenError).code === 'SYNTHETIC_IDENTITY_FORBIDDEN'
          );
        },
      );
    });
  }

  it('reads the real process environment only when called without an argument, and not the caller strings', () => {
    const saved = { sdris: process.env.SDRIS_ENV, node: process.env.NODE_ENV };
    try {
      process.env.SDRIS_ENV = 'test';
      process.env.NODE_ENV = 'test';
      assert.doesNotThrow(() => assertSyntheticIdentityAllowed(readTrustedEnvironment()));
      process.env.SDRIS_ENV = 'prod';
      assert.throws(() => assertSyntheticIdentityAllowed(readTrustedEnvironment()));
    } finally {
      for (const [key, value] of [
        ['SDRIS_ENV', saved.sdris],
        ['NODE_ENV', saved.node],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('synthetic issuer construction fails closed', () => {
  const construct = (
    env: Env | unknown,
    sink: (event: IssuanceRefusedEvent) => void,
    reports?: unknown[],
  ) =>
    createSyntheticIssuer({
      environment: (typeof env === 'object' && env !== null && isTrustedEnvironment(env)
        ? env
        : readTrustedEnvironment(env as Env)) as never,
      clock,
      principals: syntheticPrincipalsFixture,
      securityEvents: sink,
      reportSinkFailure: reports ? (report) => reports.push(report) : () => undefined,
    });

  for (const [label, env] of forbidden) {
    it(`throws SYNTHETIC_IDENTITY_FORBIDDEN and emits exactly one synthetic_forbidden event: ${label}`, () => {
      const events: IssuanceRefusedEvent[] = [];
      assert.throws(
        () => construct(env, (event) => events.push(event)),
        (error) => {
          return (
            error instanceof SyntheticIdentityForbiddenError &&
            (error as SyntheticIdentityForbiddenError).code === 'SYNTHETIC_IDENTITY_FORBIDDEN'
          );
        },
      );
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        event: 'security.issuance_refused',
        at: clock(),
        origin: 'issuer',
        reason: 'synthetic_forbidden',
      });
      // no environment text anywhere in the event
      const serialized = JSON.stringify(events);
      for (const value of Object.values(env)) {
        if (value && value.trim() !== '') assert.ok(!serialized.includes(value.trim()));
      }
    });
  }

  it('the positive control passes in the identical setup: only the environment differs', () => {
    for (const [label, env] of allowed) {
      const events: IssuanceRefusedEvent[] = [];
      const issuer = construct(env, (event) => events.push(event));
      assert.equal(issuer.issue('fixture-reader').status, 'issued', label);
      assert.equal(events.length, 0, label);
    }
  });

  it('a forged environment object is refused and counted as one attempt', () => {
    const events: IssuanceRefusedEvent[] = [];
    assert.throws(
      () =>
        createSyntheticIssuer({
          environment: { sdrisEnv: 'test', nodeEnv: 'test' } as never,
          clock,
          principals: syntheticPrincipalsFixture,
          securityEvents: (event) => events.push(event),
        }),
      SyntheticIdentityForbiddenError,
    );
    assert.equal(events.length, 1);
  });

  it('a throwing sink never masks the throw: still SYNTHETIC_IDENTITY_FORBIDDEN, one attempt and one stderr report each', () => {
    for (const [, env] of forbidden) {
      let attempts = 0;
      const reports: unknown[] = [];
      assert.throws(
        () =>
          construct(
            env,
            () => {
              attempts += 1;
              throw new Error('sink down');
            },
            reports,
          ),
        (error) =>
          (error as SyntheticIdentityForbiddenError).code === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
      assert.equal(attempts, 1);
      assert.equal(reports.length, 1);
    }
  });

  it('every forbidden attempt is its own event: no coalescing', () => {
    const events: IssuanceRefusedEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      assert.throws(() => construct({}, (event) => events.push(event)));
    }
    assert.equal(events.length, 4);
  });

  it('the error message is fixed text without environment or URL content', () => {
    try {
      construct({ SDRIS_ENV: 'super-secret-value' }, () => undefined);
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof SyntheticIdentityForbiddenError);
      assert.ok(!error.message.includes('super-secret-value'));
      assert.ok(!String(error.stack).includes('super-secret-value'));
    }
  });
});

describe('database target', () => {
  const test = readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' });
  it('accepts a disposable local target', () => {
    assert.doesNotThrow(() =>
      assertDisposableDatabaseTarget(test, 'postgresql://u:p@localhost:5432/sdris_test_ab12cd34'),
    );
    assert.doesNotThrow(() =>
      assertDisposableDatabaseTarget(test, 'postgresql://u:p@127.0.0.1:5432/sdris_local'),
    );
  });

  const refused: Array<[string, unknown]> = [
    ['a remote host', 'postgresql://u:p@db.example.com:5432/sdris_test_ab12cd34'],
    ['a non-disposable database name', 'postgresql://u:p@localhost:5432/production'],
    [
      'a redirecting parameter',
      'postgresql://u:p@localhost:5432/sdris_test_x?host=evil.example.com',
    ],
    ['an unsupported protocol', 'mysql://u:p@localhost:3306/sdris_test_x'],
    ['an empty URL', ''],
    ['no URL', undefined],
    ['a non-string', 7],
  ];
  for (const [label, url] of refused) {
    it(`refuses ${label} with SYNTHETIC_IDENTITY_FORBIDDEN and no URL text`, () => {
      try {
        assertDisposableDatabaseTarget(test, url);
        assert.fail('should have thrown');
      } catch (error) {
        assert.ok(error instanceof SyntheticIdentityForbiddenError);
        assert.equal(error.code, 'SYNTHETIC_IDENTITY_FORBIDDEN');
        if (typeof url === 'string' && url !== '') assert.ok(!error.message.includes(url));
      }
    });
  }

  it('refuses even a disposable target when NODE_ENV is production', () => {
    const production = readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'production' });
    assert.throws(
      () =>
        assertDisposableDatabaseTarget(production, 'postgresql://u:p@localhost:5432/sdris_test_x'),
      SyntheticIdentityForbiddenError,
    );
  });
});
