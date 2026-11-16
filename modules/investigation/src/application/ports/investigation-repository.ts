import type { Result, SdrisError } from '@sdris/shared-kernel';
import type {
  CaseTestAttemptLink,
  InvestigationCase,
  InvestigationCaseId,
  NewCaseTestAttemptLink,
  NewInvestigationCase,
} from '../../domain/investigation-case';
import type { NewTestAttempt, TestAttempt, TestAttemptId } from '../../domain/test-attempt';
import type { NewUut, Uut, UutId } from '../../domain/uut';
import type { TransactionToken } from './transaction-scope';

export type RepositoryErrorCode =
  | 'investigation.case_already_exists'
  | 'investigation.uut_already_exists'
  | 'investigation.attempt_already_exists'
  | 'investigation.concurrency_conflict'
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
  /**
   * Stores a new UUT and returns it as stored. PostgreSQL generates `created_at`; callers cannot supply it.
   * Fails if the id already exists. UUTs are immutable: there is no update.
   */
  addUut(uut: NewUut, tx: TransactionToken): Promise<Result<Uut, RepositoryError>>;
  getUut(id: UutId, tx?: TransactionToken): Promise<Uut | undefined>;

  /** Stores a new TestAttempt (its UUT must exist); PostgreSQL generates `registered_at`. Immutable: no update. */
  addTestAttempt(
    attempt: NewTestAttempt,
    tx: TransactionToken,
  ): Promise<Result<TestAttempt, RepositoryError>>;
  getTestAttempt(id: TestAttemptId, tx?: TransactionToken): Promise<TestAttempt | undefined>;

  /** Stores a newly opened case (the UUT must exist); PostgreSQL generates `opened_at`. Fails if the id exists. */
  add(
    investigationCase: NewInvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<InvestigationCase, RepositoryError>>;

  /**
   * Loads the case with its links in retrieval order (registered_at, attempt id, role). The case and its links are
   * read by ONE statement, so the version and the links come from the same snapshot.
   */
  get(id: InvestigationCaseId, tx?: TransactionToken): Promise<InvestigationCase | undefined>;

  /**
   * Stores a new link and advances the case version, atomically, if and only if the stored version still equals
   * `investigationCase.version` (optimistic concurrency, one atomic UPDATE). Returns the new version and the link as
   * stored (PostgreSQL generates `linked_at`), or a concurrency conflict. The repository never retries: the caller
   * re-reads and re-evaluates. Only a violation of the two same-UUT keys becomes `uut_mismatch`; any other database
   * failure is thrown, not converted into a result.
   */
  addLink(
    investigationCase: InvestigationCase,
    link: NewCaseTestAttemptLink,
    tx: TransactionToken,
  ): Promise<
    Result<{ readonly version: number; readonly link: CaseTestAttemptLink }, RepositoryError>
  >;
}
