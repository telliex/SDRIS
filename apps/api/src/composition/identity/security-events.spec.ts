import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  createSecurityEventEmitter,
  createSyntheticIssuer,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
  type SinkFailureReport,
} from './index';
import { syntheticPrincipalsFixture } from './synthetic-principals.fixtures';

/**
 * Failure containment of the security-event emitter (S0-06 WP-02, specification 2.10 and 4.7). The callback types
 * are plain functions, but a caller may hand in an async function: a rejected promise must be counted once, reported
 * once, never escape as an unhandled rejection, and never delay or change the refusal outcome. Settlement is driven
 * by explicit deferred promises and one turn of the event loop, never by sleeping.
 */
const clock = (): Timestamp => {
  const result = timestampFromDate(new Date(Date.UTC(2026, 10, 27, 9, 0, 0, 0)));
  if (!result.ok) throw new Error('bad test time');
  return result.value;
};

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
/** One full turn of the event loop: every pending microtask and the unhandled-rejection check have run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// A recording listener, not a swallowing one: a leak is asserted below, never hidden.
let leaked: unknown[];
const record = (reason: unknown) => {
  leaked.push(reason);
};
beforeEach(() => {
  leaked = [];
  process.on('unhandledRejection', record);
});
afterEach(() => {
  process.off('unhandledRejection', record);
});

const emitterWith = (
  sink: (event: IssuanceRefusedEvent) => unknown,
  reportFailure: (report: SinkFailureReport) => unknown,
) =>
  createSecurityEventEmitter({
    sink: sink as never,
    now: clock,
    reportFailure: reportFailure as never,
  });

describe('security event emitter failure containment', () => {
  it('an asynchronous sink rejection is counted once, reported once and does not escape', async () => {
    const reports: SinkFailureReport[] = [];
    const emitter = emitterWith(
      async () => {
        throw new Error('sink down');
      },
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(emitter.sinkFailures(), 1);
    assert.deepEqual(reports, [{ event: 'security.issuance_refused' }]);
    assert.deepEqual(leaked, [], 'no unhandled rejection');
  });

  it('an asynchronous reporter rejection does not escape, recurse or double-count the sink failure', async () => {
    let reporterCalls = 0;
    const emitter = emitterWith(
      () => {
        throw new Error('sink down');
      },
      async () => {
        reporterCalls += 1;
        throw new Error('reporter down');
      },
    );
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(reporterCalls, 1, 'one fallback attempt, no recursion');
    assert.equal(emitter.sinkFailures(), 1);
    assert.deepEqual(leaked, []);
  });

  it('both asynchronous: sink rejects and reporter rejects, still one failure and one attempt', async () => {
    let reporterCalls = 0;
    const emitter = emitterWith(
      () => Promise.reject(new Error('sink down')),
      () => {
        reporterCalls += 1;
        return Promise.reject(new Error('reporter down'));
      },
    );
    emitter.refuse('synthetic_forbidden');
    await settle();
    assert.equal(emitter.sinkFailures(), 1);
    assert.equal(reporterCalls, 1);
    assert.deepEqual(leaked, []);
  });

  it('keeps the synchronous behaviour unchanged: a throwing sink and a throwing reporter', async () => {
    let reporterCalls = 0;
    const emitter = emitterWith(
      () => {
        throw new Error('sink down');
      },
      () => {
        reporterCalls += 1;
        throw new Error('reporter down');
      },
    );
    emitter.refuse('unknown_principal');
    emitter.refuse('unknown_principal');
    assert.equal(emitter.sinkFailures(), 2, 'counted immediately, one per attempt');
    assert.equal(reporterCalls, 2);
    await settle();
    assert.deepEqual(leaked, []);
  });

  it('a successful asynchronous sink produces no failure and no fallback report', async () => {
    const reports: SinkFailureReport[] = [];
    const seen: IssuanceRefusedEvent[] = [];
    const emitter = emitterWith(
      async (event) => {
        seen.push(event);
      },
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(seen.length, 1);
    assert.equal(emitter.sinkFailures(), 0);
    assert.deepEqual(reports, []);
    assert.deepEqual(leaked, []);
  });

  it('a pending sink does not block the emitter and is judged only when it settles', async () => {
    const pending = deferred();
    const reports: SinkFailureReport[] = [];
    const emitter = emitterWith(
      () => pending.promise,
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    assert.equal(emitter.sinkFailures(), 0, 'returned immediately; nothing is known yet');
    await settle();
    assert.equal(emitter.sinkFailures(), 0, 'still pending, still no failure');
    pending.reject(new Error('late failure'));
    await settle();
    assert.equal(emitter.sinkFailures(), 1);
    assert.equal(reports.length, 1);
    assert.deepEqual(leaked, []);
  });

  it('a thenable that signals failure more than once is counted once', async () => {
    const reports: SinkFailureReport[] = [];
    const emitter = emitterWith(
      () => ({
        then(_onFulfilled: unknown, onRejected: (reason: unknown) => void) {
          onRejected(new Error('first'));
          onRejected(new Error('second'));
        },
      }),
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(emitter.sinkFailures(), 1);
    assert.equal(reports.length, 1);
  });

  it('a thenable whose then throws is a sink failure counted once, not an escaped error', async () => {
    const reports: SinkFailureReport[] = [];
    const emitter = emitterWith(
      () => ({
        then() {
          throw new Error('broken then');
        },
      }),
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(emitter.sinkFailures(), 1);
    assert.equal(reports.length, 1);
  });

  it('every refusal is its own attempt: two async rejections are two failures and two reports', async () => {
    const reports: SinkFailureReport[] = [];
    const emitter = emitterWith(
      () => Promise.reject(new Error('sink down')),
      (report) => reports.push(report),
    );
    emitter.refuse('unknown_principal');
    emitter.refuse('unknown_principal');
    await settle();
    assert.equal(emitter.sinkFailures(), 2);
    assert.equal(reports.length, 2);
    assert.deepEqual(leaked, []);
  });
});

describe('issuer refusals do not depend on event delivery', () => {
  const issuerWith = (
    sink: (event: IssuanceRefusedEvent) => unknown,
    report: (r: SinkFailureReport) => unknown = () => undefined,
  ) =>
    createSyntheticIssuer({
      environment: readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      clock,
      principals: syntheticPrincipalsFixture,
      securityEvents: sink as never,
      reportSinkFailure: report as never,
    });

  it('an unknown principal is refused immediately while the sink is still pending', async () => {
    const pending = deferred();
    const issuer = issuerWith(() => pending.promise);
    const outcome = issuer.issue('nobody');
    assert.deepEqual(outcome, { status: 'refused', reason: 'unknown_principal' });
    assert.equal(issuer.sinkFailures(), 0);
    pending.resolve();
    await settle();
    assert.equal(issuer.sinkFailures(), 0, 'successful delivery is not a failure');
    assert.deepEqual(leaked, []);
  });

  it('an asynchronously failing sink never changes an issuance outcome', async () => {
    const reports: SinkFailureReport[] = [];
    const issuer = issuerWith(
      () => Promise.reject(new Error('sink down')),
      (report) => reports.push(report),
    );
    assert.deepEqual(issuer.issue('nobody'), { status: 'refused', reason: 'unknown_principal' });
    assert.equal(issuer.issue('fixture-reader').status, 'issued');
    await settle();
    assert.equal(issuer.sinkFailures(), 1);
    assert.equal(reports.length, 1);
    assert.deepEqual(leaked, []);
  });

  it('the construction refusal throws SYNTHETIC_IDENTITY_FORBIDDEN while the sink is pending or rejecting', async () => {
    for (const sink of [() => deferred().promise, () => Promise.reject(new Error('sink down'))]) {
      assert.throws(
        () =>
          createSyntheticIssuer({
            environment: readTrustedEnvironment({}),
            clock,
            principals: syntheticPrincipalsFixture,
            securityEvents: sink as never,
            reportSinkFailure: () => undefined,
          }),
        (error) =>
          error instanceof SyntheticIdentityForbiddenError &&
          error.code === 'SYNTHETIC_IDENTITY_FORBIDDEN',
      );
    }
    await settle();
    assert.deepEqual(leaked, []);
  });
});
