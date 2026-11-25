import { createPersistenceHandle, type DatabaseConnection } from '@sdris/database';
import {
  createInvestigationModule,
  type InvestigationModule,
} from '@sdris/investigation/composition';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  SyntheticIdentityForbiddenError,
  createSecurityEventEmitter,
  assertDisposableDatabaseTarget,
  assertSyntheticIdentityAllowed,
  type SecurityEventSink,
  type TrustedEnvironment,
} from './identity';

export interface ComposeInvestigationOptions {
  /** The same security-event sink the composition root gives the Investigation security log (WP-03). */
  readonly securityEvents?: SecurityEventSink | undefined;
  /** The trusted clock for the refusal event; defaults to the system clock. */
  readonly clock?: (() => Timestamp) | undefined;
}

const systemNow = (): Timestamp => {
  const result = timestampFromDate(new Date());
  if (!result.ok) throw new Error('System clock produced an invalid timestamp.');
  return result.value;
};

/**
 * Application composition root for the Investigation context (the only approved importer of
 * `@sdris/investigation/composition`, see dependency-matrix.json). It turns an open database connection
 * into an opaque persistence handle and asks the module for its service. It never sees the module's
 * persistence adapter or any ORM type.
 *
 * **Fail closed (S0-06 WP-02, specification 3.2).** S0-06 has no production issuer, so composing Investigation is
 * permitted only on a positive match: a genuine `TrustedEnvironment` with `SDRIS_ENV` exactly `local` or `test`,
 * `NODE_ENV` not `production`, and a disposable local database target. Anything else throws
 * `SyntheticIdentityForbiddenError` (`code = 'SYNTHETIC_IDENTITY_FORBIDDEN'`) before any module is built and before
 * any query, after one `synthetic_forbidden` event when a sink is supplied.
 */
export function composeInvestigation(
  connection: DatabaseConnection,
  environment: TrustedEnvironment,
  options: ComposeInvestigationOptions = {},
): InvestigationModule {
  try {
    assertSyntheticIdentityAllowed(environment);
    assertDisposableDatabaseTarget(environment, connection?.pool?.options?.connectionString);
  } catch (error) {
    if (options.securityEvents !== undefined) {
      createSecurityEventEmitter({
        sink: options.securityEvents,
        now: options.clock ?? systemNow,
      }).refuse('synthetic_forbidden');
    }
    throw error instanceof SyntheticIdentityForbiddenError
      ? error
      : new SyntheticIdentityForbiddenError();
  }
  return createInvestigationModule(createPersistenceHandle(connection));
}
