import {
  createError,
  err,
  ok,
  type EntityId,
  type Result,
  type SdrisError,
  type Timestamp,
} from '@sdris/shared-kernel';
import {
  linkTestAttempt,
  openCase,
  parseLinkRole,
  recordObservation,
  type CaseTestAttemptLink,
  type FailureObservationId,
  type InvestigationCase,
  type InvestigationCaseId,
  type InvestigationDomainError,
} from '../domain/investigation-case';
import {
  parseTestStage,
  registerTestAttempt,
  type InvalidTestStageError,
  type TestAttempt,
  type TestAttemptId,
} from '../domain/test-attempt';
import { createUut, type Uut, type UutId, type UutRef } from '../domain/uut';
import type { InvestigationRepository, RepositoryError } from './ports/investigation-repository';
import type { TransactionScope } from './ports/transaction-scope';

export type NotFoundErrorCode =
  | 'investigation.case_not_found'
  | 'investigation.uut_not_found'
  | 'investigation.attempt_not_found';

/**
 * Every operational error the service can return as a value (never thrown). Documented in section 12 of the
 * S0-05 specification. Unexpected failures (a lost connection, a bug) are thrown, not returned.
 */
export type InvestigationServiceError =
  | InvestigationDomainError
  | InvalidTestStageError
  | RepositoryError
  | SdrisError<NotFoundErrorCode, { readonly actual: string }>;

export interface LinkResult {
  /** The case version after the operation. Unchanged for an idempotent duplicate. */
  readonly version: number;
  readonly link: CaseTestAttemptLink;
  /** False when an identical link already existed: nothing was written and the version did not advance. */
  readonly created: boolean;
}

/** The application contract other layers see. Implemented by `createInvestigationService`. */
export interface InvestigationService {
  registerUut(command: {
    readonly serialNumber?: string;
    readonly hostname?: string;
  }): Promise<Result<Uut, InvestigationServiceError>>;
  getUut(id: UutId): Promise<Uut | undefined>;

  registerTestAttempt(command: {
    readonly uutId: UutId;
    /** Must be one of the controlled vocabulary (`IST`, `SAT`); validated here. */
    readonly stage: string;
    readonly externalExecutionReference?: string;
  }): Promise<Result<TestAttempt, InvestigationServiceError>>;
  getTestAttempt(id: TestAttemptId): Promise<TestAttempt | undefined>;

  openCase(command: {
    readonly uut: UutRef;
  }): Promise<Result<InvestigationCase, InvestigationServiceError>>;
  getCase(id: InvestigationCaseId): Promise<InvestigationCase | undefined>;

  /**
   * Links an attempt to a case under the given role. Idempotent for an identical (case, attempt, role); the same
   * attempt with another role is another link. Refuses an attempt of another UUT.
   */
  linkTestAttempt(command: {
    readonly caseId: InvestigationCaseId;
    readonly attemptId: TestAttemptId;
    /** Must be one of `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`; validated here. */
    readonly role: string;
  }): Promise<Result<LinkResult, InvestigationServiceError>>;

  /** TRANSITIONAL (Owner decision Q8): removed once the link-based tests replace its proofs. */
  recordObservation(command: {
    readonly caseId: InvestigationCaseId;
    readonly uut: UutRef;
    readonly description: string;
  }): Promise<Result<{ readonly version: number }, InvestigationServiceError>>;
}

export interface InvestigationServiceDependencies {
  readonly repository: InvestigationRepository;
  readonly transactions: TransactionScope;
  readonly now: () => Timestamp;
  readonly newId: <TType extends string>() => EntityId<TType>;
}

/** Thrown inside a unit of work to roll it back; never escapes the service. */
class Rollback extends Error {
  constructor(readonly failure: InvestigationServiceError) {
    super(failure.code);
  }
}

function notFound(code: NotFoundErrorCode, what: string, id: string) {
  return err(
    createError({
      code: code as NotFoundErrorCode,
      message: `No ${what} with this id exists.`,
      details: { actual: id },
    }),
  );
}

export function createInvestigationService(
  deps: InvestigationServiceDependencies,
): InvestigationService {
  /** Runs `work` in one transaction; an `err` result rolls back every write it made. */
  async function transactional<T>(
    work: (
      tx: Parameters<Parameters<TransactionScope['run']>[0]>[0],
    ) => Promise<Result<T, InvestigationServiceError>>,
  ): Promise<Result<T, InvestigationServiceError>> {
    try {
      return await deps.transactions.run(async (tx) => {
        const result = await work(tx);
        if (!result.ok) throw new Rollback(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof Rollback) return err(error.failure);
      throw error;
    }
  }

  return {
    registerUut: (command) =>
      transactional(async (tx) => {
        const created = createUut({
          id: deps.newId<'UUT'>(),
          ...(command.serialNumber === undefined ? {} : { serialNumber: command.serialNumber }),
          ...(command.hostname === undefined ? {} : { hostname: command.hostname }),
          createdAt: deps.now(),
        });
        const added = await deps.repository.addUut(created, tx);
        return added.ok ? ok(created) : err(added.error);
      }),

    getUut: (id) => deps.repository.getUut(id),

    registerTestAttempt: (command) =>
      transactional(async (tx) => {
        const stage = parseTestStage(command.stage);
        if (!stage.ok) return err(stage.error);
        const owner = await deps.repository.getUut(command.uutId, tx);
        if (!owner) return notFound('investigation.uut_not_found', 'UUT', command.uutId);
        const registered = registerTestAttempt({
          id: deps.newId<'TestAttempt'>(),
          uut: { entityType: 'UUT', id: owner.id },
          stage: stage.value,
          ...(command.externalExecutionReference === undefined
            ? {}
            : { externalExecutionReference: command.externalExecutionReference }),
          registeredAt: deps.now(),
        });
        const added = await deps.repository.addTestAttempt(registered, tx);
        return added.ok ? ok(registered) : err(added.error);
      }),

    getTestAttempt: (id) => deps.repository.getTestAttempt(id),

    openCase: (command) =>
      transactional(async (tx) => {
        const owner = await deps.repository.getUut(command.uut.id, tx);
        if (!owner) return notFound('investigation.uut_not_found', 'UUT', command.uut.id);
        const created = openCase({
          id: deps.newId<'InvestigationCase'>(),
          uut: command.uut,
          openedAt: deps.now(),
        });
        const added = await deps.repository.add(created, tx);
        return added.ok ? ok(created) : err(added.error);
      }),

    getCase: (id) => deps.repository.get(id),

    linkTestAttempt: (command) =>
      transactional<LinkResult>(async (tx) => {
        const role = parseLinkRole(command.role);
        if (!role.ok) return err(role.error);
        const current = await deps.repository.get(command.caseId, tx);
        if (!current) return notFound('investigation.case_not_found', 'case', command.caseId);
        const attempt = await deps.repository.getTestAttempt(command.attemptId, tx);
        if (!attempt) {
          return notFound('investigation.attempt_not_found', 'test attempt', command.attemptId);
        }
        const outcome = linkTestAttempt(current, attempt, role.value, deps.now());
        if (!outcome.ok) return err(outcome.error);
        if (!outcome.value.created) {
          // Idempotent duplicate: nothing is written and the version does not advance.
          return ok({
            version: current.version,
            link: outcome.value.link,
            created: false,
          });
        }
        const saved = await deps.repository.save(outcome.value.investigationCase, tx);
        return saved.ok
          ? ok({ version: saved.value.version, link: outcome.value.link, created: true })
          : err(saved.error);
      }),

    recordObservation: (command) =>
      transactional(async (tx) => {
        const current = await deps.repository.get(command.caseId, tx);
        if (!current) return notFound('investigation.case_not_found', 'case', command.caseId);
        const updated = recordObservation(current, {
          id: deps.newId<'FailureObservation'>() as FailureObservationId,
          caseId: command.caseId,
          uut: command.uut,
          description: command.description,
          observedAt: deps.now(),
        });
        if (!updated.ok) return err(updated.error);
        return deps.repository.save(updated.value, tx);
      }),
  };
}
