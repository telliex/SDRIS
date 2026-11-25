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
  type CaseTestAttemptLink,
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
  | InvalidExpectedVersionError
  | VersionExhaustedError
  | RepositoryError
  | SdrisError<NotFoundErrorCode, { readonly actual: string }>;

/** Smallest and largest case version a caller may name: the PostgreSQL `integer` column starts at 1 (S0-06 FU-3). */
const MIN_EXPECTED_VERSION = 1;
const MAX_EXPECTED_VERSION = 2147483647;

/**
 * `linkAttempt` received an `expectedVersion` that is not a native safe integer from 1 to 2147483647 (S0-06 FU-3,
 * specification 7.4.2). Returned as a value. `details` carries only these four keys: the raw input is never echoed,
 * including finite numbers (Owner direction C12); `actualType` is the `typeof` tag, with `null` reported as `'null'`.
 */
export type InvalidExpectedVersionError = SdrisError<
  'investigation.invalid_expected_version',
  {
    readonly reason: 'not_a_number' | 'not_a_safe_integer' | 'out_of_range';
    readonly minimum: 1;
    readonly maximum: 2147483647;
    readonly actualType:
      | 'number'
      | 'string'
      | 'bigint'
      | 'boolean'
      | 'object'
      | 'undefined'
      | 'symbol'
      | 'function'
      | 'null';
  }
>;

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
   * Links an attempt to a case under the given role, for a caller that last saw the case at `expectedVersion`
   * (Owner decision Q6, mandatory). In this order:
   *
   * 1. the case and the attempt must exist and belong to the same UUT (`case_not_found`, `attempt_not_found`,
   *    `uut_mismatch`);
   * 2. the authoritative version is compared with `expectedVersion`; a difference is a `concurrency_conflict`, **even
   *    when the identical link already exists** (Expected Version takes precedence over idempotency);
   * 3. when the versions match and the identical (case, attempt, role) link exists, the existing link is returned and
   *    nothing is written (`created: false`, version unchanged);
   * 4. when the versions match and the link is new, it is stored and the version is incremented atomically.
   *
   * The service never retries: after a conflict the caller re-reads the case and decides again. The same attempt with
   * another role is another link.
   */
  linkAttempt(command: {
    readonly caseId: InvestigationCaseId;
    readonly attemptId: TestAttemptId;
    /** Must be one of `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`; validated here. */
    readonly role: string;
    /** The case version the caller based this request on. Required. */
    readonly expectedVersion: number;
  }): Promise<Result<LinkResult, InvestigationServiceError>>;
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

/**
 * A new link needs `version + 1` but the case is already at the largest storable version (S0-06 FU-3, specification
 * 7.4.3). Returned as a value, before any write, so the repository never evaluates an increment past the `integer`
 * maximum. A matching duplicate (no increment) and a stale request (a conflict) never produce it.
 */
export type VersionExhaustedError = SdrisError<
  'investigation.version_exhausted',
  { readonly actualVersion: 2147483647; readonly maximumVersion: 2147483647 }
>;

/**
 * Runtime validation of the caller's `expectedVersion` (the type system does not protect a JavaScript caller). No
 * coercion: only a native number that is a safe integer in [1, 2147483647] is valid. The reason is evaluated in order:
 * not a number, then not a safe integer (NaN, infinities, fractions, unsafe integers), then out of range.
 */
function validateExpectedVersion(value: unknown): InvalidExpectedVersionError | undefined {
  const actualType = value === null ? 'null' : typeof value;
  const reject = (reason: NonNullable<InvalidExpectedVersionError['details']>['reason']) =>
    createError({
      code: 'investigation.invalid_expected_version' as const,
      message: 'expectedVersion must be an integer from 1 to 2147483647.',
      details: {
        reason,
        minimum: MIN_EXPECTED_VERSION,
        maximum: MAX_EXPECTED_VERSION,
        actualType,
      } as const,
    });
  if (typeof value !== 'number') return reject('not_a_number');
  if (!Number.isSafeInteger(value)) return reject('not_a_safe_integer');
  if (value < MIN_EXPECTED_VERSION || value > MAX_EXPECTED_VERSION) return reject('out_of_range');
  return undefined;
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

    linkAttempt: (command) =>
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
        // FU-3 step 5: runtime validation, after existence and same-UUT, before the version comparison.
        const invalid = validateExpectedVersion(command.expectedVersion);
        if (invalid) return err(invalid);
        // Expected Version takes precedence over duplicate-link idempotency (Owner decision Q6).
        if (current.version !== command.expectedVersion) {
          return err(
            createError({
              code: 'investigation.concurrency_conflict' as const,
              message:
                'The case is not at the version the request was based on; re-read the case and decide again.',
              details: { expectedVersion: command.expectedVersion, actualVersion: current.version },
            }),
          );
        }
        if (!outcome.value.created) {
          // Versions match and the identical link exists: nothing is written and the version does not advance.
          return ok({
            version: current.version,
            link: outcome.value.link,
            created: false,
          });
        }
        // FU-3 step 8: a new link needs version + 1. At the largest storable version that is refused explicitly,
        // before any write; the column stays `integer` (C9).
        if (current.version >= MAX_EXPECTED_VERSION) {
          return err(
            createError({
              code: 'investigation.version_exhausted' as const,
              message: 'The case is at the largest storable version; no further link can be added.',
              details: {
                actualVersion: MAX_EXPECTED_VERSION,
                maximumVersion: MAX_EXPECTED_VERSION,
              } as const,
            }),
          );
        }
        const saved = await deps.repository.save(outcome.value.investigationCase, tx);
        return saved.ok
          ? ok({ version: saved.value.version, link: outcome.value.link, created: true })
          : err(saved.error);
      }),
  };
}
