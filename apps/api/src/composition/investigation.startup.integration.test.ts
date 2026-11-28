import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createDatabase } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import {
  SyntheticIdentityForbiddenError,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
} from './identity';
import { syntheticPrincipalsFixture } from './identity/synthetic-principals.fixtures';
import {
  composeInvestigation,
  type ComposedInvestigation,
  type ComposedSecurityEvent,
} from './investigation.composition';
import type { RequestContext } from '@sdris/investigation';
import { newEntityId, timestampFromDate, type CorrelationId } from '@sdris/shared-kernel';

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
  const options = (sink: (event: ComposedSecurityEvent) => unknown = () => undefined) => ({
    principals: syntheticPrincipalsFixture,
    securityEvents: sink,
  });
  const refuse =
    (env: Record<string, string | undefined>, sink?: (e: IssuanceRefusedEvent) => void) => () =>
      composeInvestigation(
        target.connection,
        readTrustedEnvironment(env),
        options(sink as ((event: ComposedSecurityEvent) => unknown) | undefined),
      );
  const isForbidden = (error: unknown) =>
    error instanceof SyntheticIdentityForbiddenError &&
    error.code === 'SYNTHETIC_IDENTITY_FORBIDDEN';
  const contextFor = (composed: ComposedInvestigation, key: string): RequestContext => {
    const outcome = composed.issuer.issue(key);
    assert.equal(outcome.status, 'issued');
    return {
      actor: (outcome as { handle: RequestContext['actor'] }).handle,
      correlationId: randomUUID() as CorrelationId,
    };
  };

  it('positive control: with SDRIS_ENV=test it composes, issues a handle for an ephemeral principal and one command succeeds', async () => {
    queries = 0;
    const seen: unknown[] = [];
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      options((event) => seen.push(event)),
    );
    const registered = await composed.service.registerUut(
      contextFor(composed, 'fixture-engineer'),
      {
        serialNumber: 'SN-STARTUP',
      },
    );
    assert.ok(registered.ok, 'every other dependency is present');
    assert.ok(queries > 0, 'the positive control really used the database');
    assert.deepEqual(seen, [], 'an accepted call logs nothing');
  });

  it('actual composition: a denied call is refused before any query or connection checkout and is logged once', async () => {
    const seen: ComposedSecurityEvent[] = [];
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      options((event) => seen.push(event)),
    );
    const id = newEntityId<'UUT'>();
    queries = 0;
    // no context, a forged object, a valid actor without the permission, and a malformed correlation label
    const forged = {
      actor: { permissions: ['investigation.uut.register'] },
      correlationId: randomUUID(),
    };
    const reader = contextFor(composed, 'fixture-reader');
    const badLabel = { ...contextFor(composed, 'fixture-engineer'), correlationId: 'free text' };
    const results = [
      await composed.service.registerUut(undefined as never, { serialNumber: 'X' }),
      await composed.service.registerUut(forged as never, { serialNumber: 'X' }),
      await composed.service.registerUut(reader, { serialNumber: 'X' }),
      await composed.service.registerUut(badLabel as never, { serialNumber: 'X' }),
      await composed.service.getUut(forged as never, id),
    ];
    assert.deepEqual(
      results.map((r) => (r.ok ? 'ok' : r.error.code)),
      [
        'investigation.unauthenticated',
        'investigation.unauthenticated',
        'investigation.permission_denied',
        'investigation.invalid_request_context',
        'investigation.unauthenticated',
      ],
    );
    assert.equal(queries, 0, 'no query and no connection checkout for any refusal');
    assert.equal(seen.length, 5, 'exactly one event per refused call');
    assert.equal(composed.securityLogFailures(), 0);
    assert.equal(
      (await target.connection.pool.query('select count(*)::int as n from investigation.uut'))
        .rows[0].n,
      1,
      'only the positive control stored a row',
    );
  });

  it('actual composition: a context that stops being inspectable is refused as invalid_request_context before any query (regression)', async () => {
    const seen: ComposedSecurityEvent[] = [];
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      options((event) => seen.push(event)),
    );
    const good = contextFor(composed, 'fixture-engineer');
    // The reviewer's reproduction: a real issued handle, and a context whose actor getter revokes the context
    // before returning the handle.
    const revocable = Proxy.revocable(
      {},
      {
        get(_target, property) {
          if (property === 'actor') {
            revocable.revoke();
            return good.actor;
          }
          return randomUUID();
        },
      },
    );
    queries = 0;
    const result = await composed.service.getUut(
      revocable.proxy as never,
      newEntityId<'UUT'>() as never,
    );
    assert.ok(!result.ok && result.error.code === 'investigation.invalid_request_context');
    assert.deepEqual(result.error.details, { field: 'context' });
    assert.equal(queries, 0, 'no query and no connection checkout');
    assert.equal(seen.length, 1, 'exactly one event');
    assert.deepEqual(
      Object.keys(seen[0]!).sort(),
      ['actorId', 'at', 'command', 'event', 'reason'],
      'redacted: fixed fields only, no correlation label',
    );
    assert.equal((seen[0] as { reason: string }).reason, 'invalid_context');
  });

  it('actual composition: a securityEvents getter that changes between reads is captured once and the same sink serves both consumers (regression)', async () => {
    const seen: ComposedSecurityEvent[] = [];
    const recording = (event: ComposedSecurityEvent) => seen.push(event);
    let reads = 0;
    const optionsWithGetter = {
      principals: syntheticPrincipalsFixture,
      // a callable sink on the first read, nothing afterwards
      get securityEvents() {
        reads += 1;
        return reads === 1 ? recording : undefined;
      },
    };
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      optionsWithGetter as never,
    );
    assert.equal(reads, 1, 'the property was read exactly once');
    queries = 0;
    // issuer side: an unknown principal is refused and reported through the captured sink
    assert.deepEqual(composed.issuer.issue('nobody'), {
      status: 'refused',
      reason: 'unknown_principal',
    });
    // service side: a denied operation is reported through the same captured sink
    const denied = await composed.service.getUut(undefined as never, newEntityId<'UUT'>() as never);
    assert.ok(!denied.ok && denied.error.code === 'investigation.unauthenticated');
    assert.equal(queries, 0, 'no query and no connection checkout');
    assert.deepEqual(
      seen.map((event) => event.event),
      ['security.issuance_refused', 'security.unauthenticated'],
      'both consumers delivered exactly one structured event',
    );
    assert.equal(composed.issuer.sinkFailures(), 0);
    assert.equal(composed.securityLogFailures(), 0);
    assert.equal(reads, 1, 'nothing re-read the property afterwards');
  });

  it('actual composition: every option is read exactly once and the captured values are the ones wired', async () => {
    const reads = { principals: 0, securityEvents: 0, clock: 0, reportSinkFailure: 0 };
    const seen: ComposedSecurityEvent[] = [];
    const reports: unknown[] = [];
    const instant = new Date(Date.UTC(2026, 10, 28, 9, 0, 0, 0));
    const stamped = timestampFromDate(instant);
    assert.ok(stamped.ok);
    const options = {
      get principals() {
        reads.principals += 1;
        return syntheticPrincipalsFixture;
      },
      get securityEvents() {
        reads.securityEvents += 1;
        return (event: ComposedSecurityEvent) => seen.push(event);
      },
      get clock() {
        reads.clock += 1;
        return () => stamped.value;
      },
      get reportSinkFailure() {
        reads.reportSinkFailure += 1;
        return (report: unknown) => reports.push(report);
      },
    };
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      options as never,
    );
    composed.issuer.issue('nobody');
    await composed.service.getUut(undefined as never, newEntityId<'UUT'>() as never);
    assert.deepEqual(reads, { principals: 1, securityEvents: 1, clock: 1, reportSinkFailure: 1 });
    assert.equal(seen.length, 2);
    assert.ok(
      seen.every((event) => (event as { at: string }).at === instant.toISOString()),
      'the captured clock stamped both events',
    );
    assert.deepEqual(reports, []);
  });

  it('actual composition: an asynchronously failing security sink never changes a refusal', async () => {
    const reports: unknown[] = [];
    const composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      {
        principals: syntheticPrincipalsFixture,
        securityEvents: () => Promise.reject(new Error('sink down')),
        reportSinkFailure: (report) => reports.push(report),
      },
    );
    queries = 0;
    const result = await composed.service.getCase(
      undefined as never,
      newEntityId<'InvestigationCase'>() as never,
    );
    assert.ok(!result.ok && result.error.code === 'investigation.unauthenticated');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(composed.securityLogFailures(), 1);
    assert.equal(reports.length, 1);
    assert.equal(queries, 0);
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
            options(),
          ),
        isForbidden,
      );
    } finally {
      void remote.close();
    }
  });
});
