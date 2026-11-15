import type { Result, SdrisError } from '@sdris/shared-kernel';
import type { InvestigationCase, InvestigationCaseId } from '../../domain/investigation-case';
import type { TransactionToken } from './transaction-scope';

export type RepositoryErrorCode =
  | 'investigation.case_already_exists'
  | 'investigation.concurrency_conflict'
  | 'investigation.observation_id_in_use';

export type RepositoryError = SdrisError<
  RepositoryErrorCode,
  { readonly expectedVersion?: number }
>;

/**
 * Persistence port for the Investigation aggregate. Implemented by this context's infrastructure adapter.
 * Every mutating call takes the transaction token of the surrounding unit of work.
 */
export interface InvestigationRepository {
  /** Stores a newly opened case. Fails if the id already exists. */
  add(
    investigationCase: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<void, RepositoryError>>;

  get(id: InvestigationCaseId, tx?: TransactionToken): Promise<InvestigationCase | undefined>;

  /**
   * Persists new observations if, and only if, the stored version still equals `investigationCase.version`
   * (optimistic concurrency). Returns the new stored version, or a concurrency conflict. Observations are
   * append-only; existing ones are never rewritten.
   */
  save(
    investigationCase: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<{ readonly version: number }, RepositoryError>>;
}
