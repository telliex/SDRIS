/**
 * The synthetic identity module of the application composition root (S0-06 WP-02). Local and test only: it has no
 * production issuer and no credentials. Only code under `apps/api/src/composition/**` and recognised test files
 * may import it, and Investigation never does (it sees only `ActorHandle` and the `ActorResolver` port). The
 * fixture principals are in `*.fixtures.ts`, which the production build excludes and no production file may import.
 */
export { SyntheticIdentityForbiddenError } from './errors';
export { PERMISSIONS, isPermission, type Permission } from './permissions';
export {
  createGuardedSink,
  createSecurityEventEmitter,
  type GuardedSink,
  type SecurityEventEmitter,
} from './security-events';
export type {
  IssuanceRefusedEvent,
  IssuanceRefusedReason,
  SecurityEventSink,
  SinkFailureReport,
} from './security-events';
export {
  HANDLE_TTL_MS,
  createSyntheticIssuer,
  type IssueOutcome,
  type SyntheticIssuer,
  type SyntheticIssuerOptions,
  type SyntheticPrincipal,
} from './synthetic-issuer';
export {
  assertDisposableDatabaseTarget,
  assertSyntheticIdentityAllowed,
  isTrustedEnvironment,
  readTrustedEnvironment,
  type TrustedEnvironment,
} from './trusted-environment';
