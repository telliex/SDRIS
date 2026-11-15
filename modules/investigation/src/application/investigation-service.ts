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
  openCase,
  recordObservation,
  type FailureObservationId,
  type InvestigationCase,
  type InvestigationCaseId,
  type InvestigationDomainError,
  type UutRef,
} from '../domain/investigation-case';
import type { InvestigationRepository, RepositoryError } from './ports/investigation-repository';
import type { TransactionScope } from './ports/transaction-scope';

export type InvestigationServiceError =
  | InvestigationDomainError
  | RepositoryError
  | SdrisError<'investigation.case_not_found', { readonly actual: string }>;

/** The application contract other layers see. Implemented by `createInvestigationService`. */
export interface InvestigationService {
  openCase(command: {
    readonly uut: UutRef;
  }): Promise<Result<InvestigationCase, InvestigationServiceError>>;
  recordObservation(command: {
    readonly caseId: InvestigationCaseId;
    readonly uut: UutRef;
    readonly description: string;
  }): Promise<Result<{ readonly version: number }, InvestigationServiceError>>;
  getCase(id: InvestigationCaseId): Promise<InvestigationCase | undefined>;
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
    openCase: (command) =>
      transactional(async (tx) => {
        const created = openCase({
          id: deps.newId<'InvestigationCase'>(),
          uut: command.uut,
          openedAt: deps.now(),
        });
        const added = await deps.repository.add(created, tx);
        return added.ok ? ok(created) : err(added.error);
      }),

    recordObservation: (command) =>
      transactional(async (tx) => {
        const current = await deps.repository.get(command.caseId, tx);
        if (!current) {
          return err(
            createError({
              code: 'investigation.case_not_found' as const,
              message: 'No investigation case with this id exists.',
              details: { actual: command.caseId },
            }),
          );
        }
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

    getCase: (id) => deps.repository.get(id),
  };
}
