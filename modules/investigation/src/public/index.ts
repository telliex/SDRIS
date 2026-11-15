/**
 * @sdris/investigation public entrypoint: framework-independent contracts only. It does not expose
 * adapters, ORM types or the composition factory (that is `@sdris/investigation/composition`).
 */
export type {
  FailureObservation,
  FailureObservationId,
  InvestigationCase,
  InvestigationCaseId,
  InvestigationDomainError,
  InvestigationDomainErrorCode,
  UutRef,
} from '../domain/investigation-case';
export type {
  InvestigationService,
  InvestigationServiceError,
} from '../application/investigation-service';
