import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
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
import {
  LINK_ROLES,
  type CaseTestAttemptLink,
  type InvestigationCase,
  type InvestigationCaseId,
  type LinkRole,
} from '../../domain/investigation-case';
import { parseTestStage, type TestAttempt, type TestAttemptId } from '../../domain/test-attempt';
import type { Uut, UutId, UutRef } from '../../domain/uut';
import type {
  InvestigationRepository,
  RepositoryError,
} from '../../application/ports/investigation-repository';
import type { TransactionToken } from '../../application/ports/transaction-scope';
import { caseTestAttemptLink, investigationCase, testAttempt, uut as uutTable } from './schema';

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

/**
 * Retrieval order of roles (Owner decision Q9), expressed in SQL so the database orders the rows. Built from
 * constants only, never from input.
 */
const roleOrder: SQL = sql`case ${caseTestAttemptLink.role} ${sql.join(
  LINK_ROLES.map((role, index) => sql`when ${role} then ${sql.raw(String(index))}`),
  sql` `,
)} end`;

/** PostgreSQL adapter for the Investigation repository port. Drizzle never leaves this file. */
export class DrizzleInvestigationRepository implements InvestigationRepository {
  constructor(private readonly persistence: PersistenceHandle) {}

  private executor(tx?: TransactionToken) {
    return executorOf(this.persistence, tx as unknown as TransactionContext | undefined);
  }

  async addUut(entity: Uut, tx: TransactionToken): Promise<Result<void, RepositoryError>> {
    const inserted = await this.executor(tx)
      .insert(uutTable)
      .values({
        id: entity.id,
        serialNumber: entity.serialNumber ?? null,
        hostname: entity.hostname ?? null,
        createdAt: new Date(entity.createdAt),
      })
      .onConflictDoNothing()
      .returning({ id: uutTable.id });
    return inserted.length === 0
      ? err(
          createError({
            code: 'investigation.uut_already_exists' as const,
            message: 'A UUT with this id already exists.',
          }),
        )
      : ok(undefined);
  }

  async getUut(id: UutId, tx?: TransactionToken): Promise<Uut | undefined> {
    const [row] = await this.executor(tx).select().from(uutTable).where(eq(uutTable.id, id));
    if (!row) return undefined;
    return Object.freeze({
      id: stored(parseEntityId<'UUT'>(row.id, 'id'), 'uut id'),
      ...(row.serialNumber === null ? {} : { serialNumber: row.serialNumber }),
      ...(row.hostname === null ? {} : { hostname: row.hostname }),
      createdAt: stored(timestampFromDate(row.createdAt, 'created_at'), 'created_at'),
    });
  }

  async addTestAttempt(
    entity: TestAttempt,
    tx: TransactionToken,
  ): Promise<Result<void, RepositoryError>> {
    const inserted = await this.executor(tx)
      .insert(testAttempt)
      .values({
        id: entity.id,
        uutId: entity.uut.id,
        stage: entity.stage,
        externalExecutionReference: entity.externalExecutionReference ?? null,
        registeredAt: new Date(entity.registeredAt),
      })
      .onConflictDoNothing()
      .returning({ id: testAttempt.id });
    return inserted.length === 0
      ? err(
          createError({
            code: 'investigation.attempt_already_exists' as const,
            message: 'A test attempt with this id already exists.',
          }),
        )
      : ok(undefined);
  }

  async getTestAttempt(id: TestAttemptId, tx?: TransactionToken): Promise<TestAttempt | undefined> {
    const [row] = await this.executor(tx).select().from(testAttempt).where(eq(testAttempt.id, id));
    if (!row) return undefined;
    return Object.freeze({
      id: stored(parseEntityId<'TestAttempt'>(row.id, 'id'), 'attempt id'),
      uut: uutRef(row.uutId),
      stage: stored(parseTestStage(row.stage), 'stage'),
      ...(row.externalExecutionReference === null
        ? {}
        : { externalExecutionReference: row.externalExecutionReference }),
      registeredAt: stored(timestampFromDate(row.registeredAt, 'registered_at'), 'registered_at'),
    });
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
    if (created.links.length > 0) {
      const failure = await this.insertLinks(created.links, tx);
      if (failure) return failure;
    }
    return ok(undefined);
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
    const linkRows = await executor
      .select({ link: caseTestAttemptLink })
      .from(caseTestAttemptLink)
      .innerJoin(testAttempt, eq(caseTestAttemptLink.attemptId, testAttempt.id))
      .where(eq(caseTestAttemptLink.caseId, id))
      // Explicit and total: never rely on implicit row order (Owner decision Q9).
      .orderBy(asc(testAttempt.registeredAt), asc(caseTestAttemptLink.attemptId), roleOrder);
    const caseId = stored(parseEntityId<'InvestigationCase'>(row.id, 'id'), 'case id');
    return Object.freeze({
      id: caseId,
      uut: uutRef(row.uutId),
      openedAt: stored(timestampFromDate(row.openedAt, 'opened_at'), 'opened_at'),
      version: row.version,
      links: Object.freeze(
        linkRows.map(({ link }) =>
          Object.freeze({
            caseId,
            attemptId: stored(
              parseEntityId<'TestAttempt'>(link.attemptId, 'attempt_id'),
              'attempt id',
            ),
            uut: uutRef(link.uutId),
            role: link.role as LinkRole,
            linkedAt: stored(timestampFromDate(link.linkedAt, 'linked_at'), 'linked_at'),
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
    // Optimistic concurrency: one atomic UPDATE; only the writer that still holds the stored version advances it.
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
    const storedLinks = new Set(
      (
        await executor
          .select({ attemptId: caseTestAttemptLink.attemptId, role: caseTestAttemptLink.role })
          .from(caseTestAttemptLink)
          .where(eq(caseTestAttemptLink.caseId, changed.id))
      ).map((row) => `${row.attemptId}/${row.role}`),
    );
    const freshLinks = changed.links.filter(
      (link) => !storedLinks.has(`${link.attemptId}/${link.role}`),
    );
    if (freshLinks.length > 0) {
      const failure = await this.insertLinks(freshLinks, tx);
      if (failure) return failure;
    }
    return ok({ version: bumped.version });
  }

  /**
   * Appends links. The composite foreign keys are the database-level same-UUT rejection: a link whose UUT differs
   * from its case's or its attempt's cannot be stored. Existence of both sides is checked by the application first.
   */
  private async insertLinks(
    links: readonly CaseTestAttemptLink[],
    tx: TransactionToken,
  ): Promise<Result<never, RepositoryError> | undefined> {
    try {
      await this.executor(tx)
        .insert(caseTestAttemptLink)
        .values(
          links.map((link) => ({
            caseId: link.caseId,
            attemptId: link.attemptId,
            uutId: link.uut.id,
            role: link.role,
            linkedAt: new Date(link.linkedAt),
          })),
        );
      return undefined;
    } catch (error) {
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
        return err(
          createError({
            code: 'investigation.uut_mismatch' as const,
            message: 'A link names a different UUT than its case or attempt; storage refused it.',
          }),
        );
      }
      throw error;
    }
  }
}
