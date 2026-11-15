import { and, asc, eq, sql } from 'drizzle-orm';
import {
  executorOf,
  pgErrorCode,
  type PersistenceHandle,
  type TransactionContext,
} from '@sdris/database';
import {
  createEntityRef,
  createError,
  err,
  ok,
  parseEntityId,
  timestampFromDate,
  type Result,
} from '@sdris/shared-kernel';
import type {
  FailureObservation,
  InvestigationCase,
  InvestigationCaseId,
  UutRef,
} from '../../domain/investigation-case';
import type {
  InvestigationRepository,
  RepositoryError,
} from '../../application/ports/investigation-repository';
import type { TransactionToken } from '../../application/ports/transaction-scope';
import { failureObservation, investigationCase } from './schema';

const PG_FOREIGN_KEY_VIOLATION = '23503';

/** Unwraps a Result that can only fail if stored data is corrupt, which is a bug, not a domain outcome. */
function stored<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) throw new Error(`Corrupt ${what} in storage: ${result.error.message}`);
  return result.value;
}

function uutRef(id: string): UutRef {
  const parsed = stored(parseEntityId<'UUT'>(id, 'uut_id'), 'uut_id');
  return stored(createEntityRef('UUT', parsed), 'uut reference');
}

/** PostgreSQL adapter for the Investigation repository port. Drizzle never leaves this file. */
export class DrizzleInvestigationRepository implements InvestigationRepository {
  constructor(private readonly persistence: PersistenceHandle) {}

  private executor(tx?: TransactionToken) {
    return executorOf(this.persistence, tx as unknown as TransactionContext | undefined);
  }

  async add(
    created: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<void, RepositoryError>> {
    const inserted = await this.executor(tx)
      .insert(investigationCase)
      .values({
        id: created.id,
        uutId: created.uut.id,
        openedAt: new Date(created.openedAt),
        version: 1,
      })
      .onConflictDoNothing()
      .returning({ id: investigationCase.id });
    if (inserted.length === 0) {
      return err(
        createError({
          code: 'investigation.case_already_exists' as const,
          message: 'A case with this id already exists.',
        }),
      );
    }
    return created.observations.length === 0
      ? ok(undefined)
      : ((await this.insertObservations(created, created.observations, tx)) ?? ok(undefined));
  }

  async get(
    id: InvestigationCaseId,
    tx?: TransactionToken,
  ): Promise<InvestigationCase | undefined> {
    const executor = this.executor(tx);
    const [row] = await executor
      .select()
      .from(investigationCase)
      .where(eq(investigationCase.id, id));
    if (!row) return undefined;
    const observations = await executor
      .select()
      .from(failureObservation)
      .where(eq(failureObservation.caseId, id))
      .orderBy(asc(failureObservation.observedAt), asc(failureObservation.id));
    const caseId = stored(parseEntityId<'InvestigationCase'>(row.id, 'id'), 'case id');
    return Object.freeze({
      id: caseId,
      uut: uutRef(row.uutId),
      openedAt: stored(timestampFromDate(row.openedAt, 'opened_at'), 'opened_at'),
      version: row.version,
      observations: Object.freeze(
        observations.map((o) =>
          Object.freeze({
            id: stored(parseEntityId<'FailureObservation'>(o.id, 'id'), 'observation id'),
            caseId,
            uut: uutRef(o.uutId),
            description: o.description,
            observedAt: stored(timestampFromDate(o.observedAt, 'observed_at'), 'observed_at'),
          }),
        ),
      ),
    });
  }

  async save(
    changed: InvestigationCase,
    tx: TransactionToken,
  ): Promise<Result<{ readonly version: number }, RepositoryError>> {
    const executor = this.executor(tx);
    // Optimistic concurrency: only the writer that still holds the stored version may advance it.
    const [bumped] = await executor
      .update(investigationCase)
      .set({ version: sql`${investigationCase.version} + 1` })
      .where(
        and(eq(investigationCase.id, changed.id), eq(investigationCase.version, changed.version)),
      )
      .returning({ version: investigationCase.version });
    if (!bumped) {
      return err(
        createError({
          code: 'investigation.concurrency_conflict' as const,
          message: 'The case was changed by someone else (or does not exist); reload and retry.',
          details: { expectedVersion: changed.version },
        }),
      );
    }
    const existing = new Set(
      (
        await executor
          .select({ id: failureObservation.id })
          .from(failureObservation)
          .where(eq(failureObservation.caseId, changed.id))
      ).map((row) => row.id),
    );
    const fresh = changed.observations.filter((observation) => !existing.has(observation.id));
    if (fresh.length > 0) {
      const failure = await this.insertObservations(changed, fresh, tx);
      if (failure) return failure;
    }
    return ok({ version: bumped.version });
  }

  /** Appends observations. Returns a failure result, or undefined when all were stored. */
  private async insertObservations(
    owner: InvestigationCase,
    observations: readonly FailureObservation[],
    tx: TransactionToken,
  ): Promise<Result<never, RepositoryError> | undefined> {
    try {
      const inserted = await this.executor(tx)
        .insert(failureObservation)
        .values(
          observations.map((o) => ({
            id: o.id,
            caseId: owner.id,
            uutId: o.uut.id,
            description: o.description,
            observedAt: new Date(o.observedAt),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: failureObservation.id });
      if (inserted.length !== observations.length) {
        return err(
          createError({
            code: 'investigation.observation_id_in_use' as const,
            message: 'An observation id is already used by another case.',
          }),
        );
      }
      return undefined;
    } catch (error) {
      // The composite foreign key (case_id, uut_id) is the database-level cross-UUT rejection.
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
        return err(
          createError({
            code: 'investigation.uut_mismatch' as const,
            message: 'An observation names a different UUT than its case; storage refused it.',
          }),
        );
      }
      throw error;
    }
  }
}
