import type { Result, SdrisError } from '@sdris/shared-kernel';
import type { InvestigationCase, InvestigationCaseId } from '../../domain/investigation-case';
import type { TestAttempt, TestAttemptId } from '../../domain/test-attempt';
import type { Uut, UutId } from '../../domain/uut';
import type { TransactionToken } from './transaction-scope';

export type RepositoryErrorCode =
  | 'investigation.case_already_exists'
  | 'investigation.uut_already_exists'
  | 'investigation.attempt_already_exists'
  | 'investigation.concurrency_conflict'
  | 'investigation.observation_id_in_use'
  | 'investigation.uut_mismatch';

export type RepositoryError = SdrisError<
  RepositoryErrorCode,
  { readonly expectedVersion?: number }
>;

/**
 * Persistence port for the Investigation context. Implemented by this context's infrastructure adapter.
 * Every mutating call takes the transaction token of the surrounding unit of work.
 */
export interface InvestigationRepository {
  /** Stores a new UUT. Fails if the id already exists. UUTs are immutable: there is no update. */
  addUut(uut: Uut, tx: TransactionToken): Promise<Result<void, RepositoryError>>;
  getUut(id: UutId, tx?: TransactionToken): Promise<Uut | undefined>;

  /** Stores a new TestAttempt (its UUT must exist). Fails if the id already exists. Immutable: no update. */
  addTestAttempt(
    attempt: TestAttempt,
    tx: TransactionToken,
  ): Promise<Result<void, RepositoryError>>;
  getTestAttempt(id: TestAttemptId, tx?: TransactionToken): Promise<TestAttempt | undefined>;

  /** Stores a newly opened case (the UUT must exist). Fails if the id already exists. */
  add(
    investigationCase: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<void, RepositoryError>>;

  /** Loads the case with its links in retrieval order (registered_at, attempt id, role). */
  get(id: InvestigationCaseId, tx?: TransactionToken): Promise<InvestigationCase | undefined>;

  /**
   * Persists the links (and transitional observations) that are not stored yet if, and only if, the stored
   * version still equals `investigationCase.version`. The check is one atomic UPDATE in PostgreSQL. Returns the
   * new stored version, or a concurrency conflict. The repository never retries: the caller re-reads and
   * re-evaluates. Stored links are never rewritten.
   */
  save(
    investigationCase: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<{ readonly version: number }, RepositoryError>>;
}
