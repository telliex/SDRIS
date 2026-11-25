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
  readonly event: IssuanceRefusedEvent['event'];
}

const toStandardError = (report: SinkFailureReport): void => {
  process.stderr.write(`security event sink failed (${report.event})\n`);
};

export interface SecurityEventEmitter {
  /** Exactly one emission attempt per call. Never throws: a failing sink never changes the caller's outcome. */
  refuse(reason: IssuanceRefusedReason): void;
  /** How many emission attempts the sink failed (or the clock could not stamp). */
  sinkFailures(): number;
}

/**
 * Wraps the sink with the rule of 4.7: the refusal stands, a sink failure is reported best-effort to standard
 * error (or the injected reporter) and counted, and it is never rethrown.
 */
export function createSecurityEventEmitter(options: {
  readonly sink: SecurityEventSink;
  readonly now: () => Timestamp;
  readonly reportFailure?: ((report: SinkFailureReport) => void) | undefined;
}): SecurityEventEmitter {
  let failures = 0;
  const report = options.reportFailure ?? toStandardError;
  return {
    refuse(reason) {
      try {
        options.sink(
          Object.freeze({
            event: 'security.issuance_refused' as const,
            at: options.now(),
            origin: 'issuer' as const,
            reason,
          }),
        );
      } catch {
        failures += 1;
        try {
          report({ event: 'security.issuance_refused' });
        } catch {
          // best effort only
        }
      }
    },
    sinkFailures: () => failures,
  };
}
