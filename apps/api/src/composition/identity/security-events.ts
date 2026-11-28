import type { Timestamp } from '@sdris/shared-kernel';

/**
 * Issuer-level security events (specification 2.10): refusals that happen before any handle or service call
 * exists, so the Investigation service cannot log them. The event never contains the supplied principal key, a
 * credential, an environment value, a stack trace or any other caller- or environment-controlled text, and it has
 * no correlation id (no request context exists yet).
 */
export type IssuanceRefusedReason =
  'unknown_principal' | 'invalid_credential' | 'synthetic_forbidden';

export interface IssuanceRefusedEvent {
  readonly event: 'security.issuance_refused';
  readonly at: Timestamp;
  readonly origin: 'issuer';
  readonly reason: IssuanceRefusedReason;
}

/** The plain injected sink `(event) => void`; the issuer imports nothing from Investigation internals. */
export type SecurityEventSink = (event: IssuanceRefusedEvent) => void;

export interface SinkFailureReport {
  readonly event: string;
}

const toStandardError = (report: SinkFailureReport): void => {
  process.stderr.write(`security event sink failed (${report.event})\n`);
};

export interface SecurityEventEmitter {
  /**
   * Exactly one emission attempt per call, never awaited: it returns at once and never throws, so a failing,
   * rejecting or pending sink never changes or delays the caller's outcome.
   */
  refuse(reason: IssuanceRefusedReason): void;
  /** How many emission attempts the sink failed (or the clock could not stamp). */
  sinkFailures(): number;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

/**
 * The failure containment shared by every event the application composition emits (specification 2.10 and 4.7):
 * the rule that a sink failure is reported best-effort to standard error (or the injected reporter), counted, and
 * never rethrown.
 *
 * The callbacks are typed as plain functions but may be asynchronous, so both a synchronous throw and a rejected
 * promise are failures. Nothing is awaited on the refusal path: a promise only gets a rejection handler, so a late
 * rejection is counted and reported (once per attempt) without delaying the caller and without becoming an
 * unhandled rejection. A failing reporter is contained the same way and is never reported on again.
 */
export interface GuardedSink<TEvent> {
  /** One emission attempt; `build` runs inside the guard, so a failing clock is a sink failure too. */
  emit(build: () => TEvent): void;
  failures(): number;
}

export function createGuardedSink<TEvent>(options: {
  readonly sink: (event: TEvent) => unknown;
  readonly eventName: string;
  readonly reportFailure?: ((report: SinkFailureReport) => void) | undefined;
}): GuardedSink<TEvent> {
  let failures = 0;
  const report = options.reportFailure ?? toStandardError;
  const reportOnce = (): void => {
    try {
      const result: unknown = report({ event: options.eventName });
      if (isThenable(result)) result.then(undefined, () => undefined);
    } catch {
      // best effort only: no second report, no recursion
    }
  };
  return {
    emit(build) {
      // One attempt is one failure at most, however many ways it signals failure.
      let failed = false;
      const fail = (): void => {
        if (failed) return;
        failed = true;
        failures += 1;
        reportOnce();
      };
      try {
        const result: unknown = options.sink(build());
        if (isThenable(result)) result.then(undefined, fail);
      } catch {
        fail();
      }
    },
    failures: () => failures,
  };
}

/** The issuer's refusal events (specification 2.10), emitted through the shared guard. */
export function createSecurityEventEmitter(options: {
  readonly sink: SecurityEventSink;
  readonly now: () => Timestamp;
  readonly reportFailure?: ((report: SinkFailureReport) => void) | undefined;
}): SecurityEventEmitter {
  const guard = createGuardedSink<IssuanceRefusedEvent>({
    sink: options.sink,
    eventName: 'security.issuance_refused',
    reportFailure: options.reportFailure,
  });
  return {
    refuse(reason) {
      guard.emit(() =>
        Object.freeze({
          event: 'security.issuance_refused' as const,
          at: options.now(),
          origin: 'issuer' as const,
          reason,
        }),
      );
    },
    sinkFailures: guard.failures,
  };
}
