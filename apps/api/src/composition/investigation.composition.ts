import { createPersistenceHandle, type DatabaseConnection } from '@sdris/database';
import {
  createInvestigationModule,
  type InvestigationModule,
  type SecurityEvent,
} from '@sdris/investigation/composition';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  assertDisposableDatabaseTarget,
  assertSyntheticIdentityAllowed,
  createGuardedSink,
  createSecurityEventEmitter,
  createSyntheticIssuer,
  type IssuanceRefusedEvent,
  type SinkFailureReport,
  type SyntheticIssuer,
  type SyntheticPrincipal,
  type TrustedEnvironment,
} from './identity';

/** Every security event the composition can emit: issuer refusals (2.10) and service rejections (4.7). */
export type ComposedSecurityEvent = IssuanceRefusedEvent | SecurityEvent;

export interface ComposeInvestigationOptions {
  /** The synthetic principal table. Required: the issuer has no built-in principals (specification 3.2). */
  readonly principals: readonly SyntheticPrincipal[];
  /**
   * The one security-event sink: it receives issuer refusals and the service's rejections. Required, so no
   * composition can forget to log. Failures of the sink, synchronous or asynchronous, are contained and counted.
   */
  readonly securityEvents: (event: ComposedSecurityEvent) => unknown;
  /** The trusted clock for events and handle lifetimes; defaults to the system clock. */
  readonly clock?: (() => Timestamp) | undefined;
  /** Test seam for the standard-error fallback used when the sink fails. */
  readonly reportSinkFailure?: ((report: SinkFailureReport) => void) | undefined;
}

/** The Investigation module plus the application's synthetic issuer that its service trusts. */
export interface ComposedInvestigation extends InvestigationModule {
  /** Issues the handles this service accepts. Local and test only; there is no production issuer. */
  readonly issuer: SyntheticIssuer;
  /** How many service-rejection events the sink failed to take (a failing sink never changes a result). */
  securityLogFailures(): number;
}

const systemNow = (): Timestamp => {
  const result = timestampFromDate(new Date());
  if (!result.ok) throw new Error('System clock produced an invalid timestamp.');
  return result.value;
};

/**
 * Application composition root for the Investigation context (the only approved importer of
 * `@sdris/investigation/composition`, see dependency-matrix.json). It turns an open database connection
 * into an opaque persistence handle, builds the synthetic issuer whose resolver the service trusts, wires the
 * security log, and asks the module for its service. It never sees the module's persistence adapter or any ORM type.
 *
 * **Fail closed (S0-06 WP-02, specification 3.2).** S0-06 has no production issuer, so composing Investigation is
 * permitted only on a positive match: a genuine `TrustedEnvironment` with `SDRIS_ENV` exactly `local` or `test`,
 * `NODE_ENV` not `production`, and a disposable local database target. Anything else throws
 * `SyntheticIdentityForbiddenError` (`code = 'SYNTHETIC_IDENTITY_FORBIDDEN'`) before any module or issuer is built and
 * before any query, after one `synthetic_forbidden` event.
 *
 * **Authentication wiring (WP-03).** The service receives the issuer's resolver and a security log backed by the
 * same sink; every command and read then authenticates and authorizes before its transaction.
 */
export function composeInvestigation(
  connection: DatabaseConnection,
  environment: TrustedEnvironment,
  options: ComposeInvestigationOptions,
): ComposedInvestigation {
  // Every option is read from the caller's object exactly once and only the captured outcome is used below: an
  // accessor can answer differently on each read, so the value that is validated is the value that is wired.
  // `securityEvents` is captured eagerly and a lookup that throws counts as "no sink", so a bad options object can
  // never turn the forbidden-environment refusal into another error. The other options are captured on first use and
  // a lookup that throws is not swallowed on the allowed path; on the forbidden path it only costs the report.
  const captured = <T>(read: () => T): (() => T) => {
    let outcome: { value: T } | { error: unknown } | undefined;
    return () => {
      if (outcome === undefined) {
        try {
          outcome = { value: read() };
        } catch (error) {
          outcome = { error };
        }
      }
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    };
  };
  let securityEvents: ComposeInvestigationOptions['securityEvents'] | undefined;
  try {
    securityEvents = options?.securityEvents;
  } catch {
    securityEvents = undefined;
  }
  const clockOption = captured(() => options?.clock);
  const reportSinkFailure = captured(() => options?.reportSinkFailure);
  const principals = captured(() => options?.principals);

  try {
    assertSyntheticIdentityAllowed(environment);
    assertDisposableDatabaseTarget(environment, connection?.pool?.options?.connectionString);
  } catch (error) {
    // Reporting is best effort and must never replace the refusal. Without a callable sink there is nothing to
    // deliver to, and nothing is claimed as delivered.
    try {
      if (typeof securityEvents === 'function') {
        createSecurityEventEmitter({
          sink: securityEvents,
          now: clockOption() ?? systemNow,
          reportFailure: reportSinkFailure(),
        }).refuse('synthetic_forbidden');
      }
    } catch {
      // the refusal below stands
    }
    throw error instanceof SyntheticIdentityForbiddenError
      ? error
      : new SyntheticIdentityForbiddenError();
  }
  // The compile-time `securityEvents` property proves nothing to a JavaScript caller. Without a callable sink the
  // service would run with a log that fails on its first event, so composition is refused here, before the issuer
  // or the service exist, and not left to surface as a counted sink failure later. A forbidden environment has
  // already been refused above and keeps its own error.
  if (typeof securityEvents !== 'function') {
    throw new TypeError(
      'composeInvestigation requires options.securityEvents, a function that receives security events.',
    );
  }
  const clock = clockOption() ?? systemNow;
  const issuer = createSyntheticIssuer({
    environment,
    clock,
    principals: principals() as readonly SyntheticPrincipal[],
    securityEvents,
    reportSinkFailure: reportSinkFailure(),
  });
  const log = createGuardedSink<SecurityEvent>({
    sink: securityEvents,
    eventName: 'investigation.security_event',
    reportFailure: reportSinkFailure(),
  });
  const module = createInvestigationModule(createPersistenceHandle(connection), {
    actorResolver: issuer.resolver,
    securityLog: { record: (event) => log.emit(() => event) },
    ...(clockOption() === undefined ? {} : { now: clock }),
  });
  return { ...module, issuer, securityLogFailures: log.failures };
}
