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
import {
  createAccessGuard,
  type AccessError,
  type RequestContext,
  type SecurityLog,
} from './access-control';
import type { ActorResolver } from './ports/actor-resolver';
import type { InvestigationRepository, RepositoryError } from './ports/investigation-repository';
import type { TransactionScope } from './ports/transaction-scope';

export type NotFoundErrorCode =
  | 'investigation.case_not_found'
  | 'investigation.uut_not_found'
  | 'investigation.attempt_not_found';

/**
 * Every operational error the service can return as a value (never thrown). Documented in section 12 of the
 * S0-05 specification, extended by S0-06 FU-3 (specification 7): `investigation.invalid_expected_version` (the caller's
 * `expectedVersion` is not a native safe integer from 1 to 2147483647) and `investigation.version_exhausted` (a new
 * link needs a version past 2147483647). `investigation.concurrency_conflict` has two shapes, both unchanged: from the
 * service's version comparison `details` is `{ expectedVersion, actualVersion }`; from the repository's atomic
 * compare-and-save race it is `{ expectedVersion }` only, so a consumer must not assume `actualVersion` is present.
 * Unexpected failures (a lost connection, a bug) are thrown, not returned.
 */
export type InvestigationServiceError =
  | InvestigationDomainError
  | InvalidTestStageError
  | InvalidExpectedVersionError
  | VersionExhaustedError
  | AccessError
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

/**
 * The application contract other layers see. Implemented by `createInvestigationService`.
 *
 * **Every command and read takes a `RequestContext` first** (S0-06 Stage 2, specification 2.6 to 2.9 and 3.3) and
 * checks, in this order and before any transaction or repository access: authentication of the actor handle
 * (`unauthenticated`), the context and the correlation label (`invalid_request_context`), and the permission the
 * operation needs (`permission_denied`); each refusal is returned as a value and logged once. Only then do the
 * operation's own validation, transaction and storage run. A direct call is checked exactly like any other: a
 * JavaScript caller that omits or forges the context is refused at runtime.
 */
export interface InvestigationService {
  /** Needs `investigation.uut.register`. */
  registerUut(
    context: RequestContext,
    command: {
      readonly serialNumber?: string;
      readonly hostname?: string;
    },
  ): Promise<Result<Uut, InvestigationServiceError>>;
  /**
   * Needs `investigation.read`. Absence is a successful answer, `ok(undefined)`: "not found" is not an access error,
   * and a refusal is never reported as "not found".
   */
  getUut(context: RequestContext, id: UutId): Promise<Result<Uut | undefined, AccessError>>;

  /** Needs `investigation.attempt.register`. */
  registerTestAttempt(
    context: RequestContext,
    command: {
      readonly uutId: UutId;
      /** Must be one of the controlled vocabulary (`IST`, `SAT`); validated here. */
      readonly stage: string;
      readonly externalExecutionReference?: string;
    },
  ): Promise<Result<TestAttempt, InvestigationServiceError>>;
  /** Needs `investigation.read`; absence is `ok(undefined)`. */
  getTestAttempt(
    context: RequestContext,
    id: TestAttemptId,
  ): Promise<Result<TestAttempt | undefined, AccessError>>;

  /** Needs `investigation.case.open`. */
  openCase(
    context: RequestContext,
    command: {
      readonly uut: UutRef;
    },
  ): Promise<Result<InvestigationCase, InvestigationServiceError>>;
  /** Needs `investigation.read`; absence is `ok(undefined)`. */
  getCase(
    context: RequestContext,
    id: InvestigationCaseId,
  ): Promise<Result<InvestigationCase | undefined, AccessError>>;

  /**
   * Links an attempt to a case under the given role, for a caller that last saw the case at `expectedVersion`
   * (Owner decision Q6, mandatory). Needs `investigation.case.link_attempt`. After the access checks above, in this
   * order:
   *
   * 1. the role must be in the vocabulary (`invalid_link_role`), checked before the transaction opens;
   * 2. the case and the attempt must exist and belong to the same UUT (`case_not_found`, `attempt_not_found`,
   *    `uut_mismatch`);
   * 3. `expectedVersion` is validated at runtime, with no coercion: only a native safe integer from 1 to 2147483647 is
   *    accepted (`invalid_expected_version`; its `details` never contain the raw input);
   * 4. the authoritative version is compared with `expectedVersion`; a difference is a `concurrency_conflict`, **even
   *    when the identical link already exists** (Expected Version takes precedence over idempotency);
   * 5. when the versions match and the identical (case, attempt, role) link exists, the existing link is returned and
   *    nothing is written (`created: false`, version unchanged), also at the largest version;
   * 6. when the versions match and the link is new but the case is already at 2147483647, nothing is written
   *    (`version_exhausted`);
   * 7. otherwise the link is stored and the version is incremented atomically; a concurrent writer that wins the
   *    atomic update makes this one a `concurrency_conflict` (repository shape, no `actualVersion`).
   *
   * The service never retries: after a conflict the caller re-reads the case and decides again. The same attempt with
   * another role is another link.
   */
  linkAttempt(
    context: RequestContext,
    command: {
      readonly caseId: InvestigationCaseId;
      readonly attemptId: TestAttemptId;
      /** Must be one of `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`; validated here. */
      readonly role: string;
      /**
       * The case version the caller based this request on. Required. Validated at runtime: a JavaScript caller that
       * omits it or sends anything but a native safe integer from 1 to 2147483647 gets `invalid_expected_version`.
       */
      readonly expectedVersion: number;
    },
  ): Promise<Result<LinkResult, InvestigationServiceError>>;
}

export interface InvestigationServiceDependencies {
  /** Verifies actor handles. Required: the factory refuses to build a service that could skip authentication. */
  readonly actorResolver: ActorResolver;
  /** Receives one event per rejected call. Required: every rejection is recorded. */
  readonly securityLog: SecurityLog;
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
  const guard = createAccessGuard({
    actorResolver: deps.actorResolver,
    securityLog: deps.securityLog,
    now: deps.now,
  });
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
    registerUut: async (context, command) => {
      const access = guard.authorize(context, 'registerUut');
      if (!access.ok) return err(access.error);
      return transactional(async (tx) => {
        const created = createUut({
          id: deps.newId<'UUT'>(),
          ...(command.serialNumber === undefined ? {} : { serialNumber: command.serialNumber }),
          ...(command.hostname === undefined ? {} : { hostname: command.hostname }),
          createdAt: deps.now(),
        });
        const added = await deps.repository.addUut(created, tx);
        return added.ok ? ok(created) : err(added.error);
      });
    },

    getUut: async (context, id) => {
      const access = guard.authorize(context, 'getUut');
      if (!access.ok) return err(access.error);
      return ok(await deps.repository.getUut(id));
    },

    registerTestAttempt: async (context, command) => {
      const access = guard.authorize(context, 'registerTestAttempt');
      if (!access.ok) return err(access.error);
      // D: pure domain validation, before the transaction opens (specification 2.7).
      const stage = parseTestStage(command.stage);
      if (!stage.ok) return err(stage.error);
      return transactional(async (tx) => {
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
      });
    },

    getTestAttempt: async (context, id) => {
      const access = guard.authorize(context, 'getTestAttempt');
      if (!access.ok) return err(access.error);
      return ok(await deps.repository.getTestAttempt(id));
    },

    openCase: async (context, command) => {
      const access = guard.authorize(context, 'openCase');
      if (!access.ok) return err(access.error);
      return transactional(async (tx) => {
        const owner = await deps.repository.getUut(command.uut.id, tx);
        if (!owner) return notFound('investigation.uut_not_found', 'UUT', command.uut.id);
        const created = openCase({
          id: deps.newId<'InvestigationCase'>(),
          uut: command.uut,
          openedAt: deps.now(),
        });
        const added = await deps.repository.add(created, tx);
        return added.ok ? ok(created) : err(added.error);
      });
    },

    getCase: async (context, id) => {
      const access = guard.authorize(context, 'getCase');
      if (!access.ok) return err(access.error);
      return ok(await deps.repository.get(id));
    },

    linkAttempt: async (context, command) => {
      const access = guard.authorize(context, 'linkAttempt');
      if (!access.ok) return err(access.error);
      // D: pure domain validation, before the transaction opens (specification 2.7).
      const role = parseLinkRole(command.role);
      if (!role.ok) return err(role.error);
      return transactional<LinkResult>(async (tx) => {
        const current = await deps.repository.get(command.caseId, tx);
        if (!current) return notFound('investigation.case_not_found', 'case', command.caseId);
        const attempt = await deps.repository.getTestAttempt(command.attemptId, tx);
        if (!attempt) {
          return notFound('investigation.attempt_not_found', 'test attempt', command.attemptId);
        }
        const outcome = linkTestAttempt(current, attempt, role.value, deps.now());
        if (!outcome.ok) return err(outcome.error);
        // FU-3 step 5: runtime validation, after existence and same-UUT, before the version comparison.
        // Read once: a JavaScript accessor can answer differently on each read, so the value that is validated is the
        // value that is compared and reported.
        const expectedVersion = command.expectedVersion;
        const invalid = validateExpectedVersion(expectedVersion);
        if (invalid) return err(invalid);
        // Expected Version takes precedence over duplicate-link idempotency (Owner decision Q6).
        if (current.version !== expectedVersion) {
          return err(
            createError({
              code: 'investigation.concurrency_conflict' as const,
              message:
                'The case is not at the version the request was based on; re-read the case and decide again.',
              details: { expectedVersion, actualVersion: current.version },
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
      });
    },
  };
}
