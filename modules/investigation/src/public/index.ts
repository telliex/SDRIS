/**
 * @sdris/investigation public entrypoint: framework-independent contracts only. It does not expose
 * adapters, ORM types or the composition factory (that is `@sdris/investigation/composition`).
 */
export type {
  CaseTestAttemptLink,
  FailureObservation,
  FailureObservationId,
  InvestigationCase,
  InvestigationCaseId,
  InvestigationDomainError,
  InvestigationDomainErrorCode,
  LinkRole,
} from '../domain/investigation-case';
export { LINK_ROLES } from '../domain/investigation-case';
export type { TestAttempt, TestAttemptId, TestStage } from '../domain/test-attempt';
export { TEST_STAGES } from '../domain/test-attempt';
export type { Uut, UutId, UutRef } from '../domain/uut';
export type {
  InvestigationService,
  InvestigationServiceError,
  LinkResult,
} from '../application/investigation-service';
