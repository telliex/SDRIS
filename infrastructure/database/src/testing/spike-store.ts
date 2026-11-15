/**
 * TEST-ONLY persistence spike. These tables live in a throw-away schema created by the integration
 * tests; they are NOT part of any migration and model no SDRIS business entity. They exist to prove
 * transaction, optimistic-concurrency, idempotency and atomic domain+audit+outbox capabilities.
 *
 * The `*Store` interfaces play the role of application ports: they mention no ORM types.
 * The `Drizzle*` classes are the infrastructure adapters that implement them.
 */
import { and, eq, sql } from 'drizzle-orm';
import { integer, pgSchema, primaryKey, serial, text } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { err, ok, type Result } from '@sdris/shared-kernel';
import type { Database } from '../connection';
import { executorFor, type TransactionContext, type UnitOfWork } from '../unit-of-work';

export const SPIKE_SCHEMA = 'spike_s0_04';
const spike = pgSchema(SPIKE_SCHEMA);

export const versionRecord = spike.table('version_record', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
  version: integer('version').notNull().default(1),
});
export const idempotencyRecord = spike.table(
  'idempotency_record',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);
export const domainRecord = spike.table('domain_record', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
});
export const auditRecord = spike.table('audit_record', {
  id: serial('id').primaryKey(),
  domainId: text('domain_id').notNull(),
  action: text('action').notNull(),
});
export const outboxRecord = spike.table('outbox_record', {
  id: serial('id').primaryKey(),
  domainId: text('domain_id').notNull(),
  eventType: text('event_type').notNull(),
});

export async function createSpikeTables(pool: Pool): Promise<void> {
  await pool.query(`
    create schema if not exists ${SPIKE_SCHEMA};
    create table ${SPIKE_SCHEMA}.version_record (id text primary key, value text not null, version integer not null default 1);
    create table ${SPIKE_SCHEMA}.idempotency_record (scope text not null, key text not null, request_hash text not null, primary key (scope, key));
    create table ${SPIKE_SCHEMA}.domain_record (id text primary key, state text not null);
    create table ${SPIKE_SCHEMA}.audit_record (id serial primary key, domain_id text not null, action text not null);
    create table ${SPIKE_SCHEMA}.outbox_record (id serial primary key, domain_id text not null, event_type text not null);
  `);
}

// ---- Optimistic concurrency -------------------------------------------------------------------

export interface VersionedRecord {
  readonly id: string;
  readonly value: string;
  readonly version: number;
}
export interface VersionConflict {
  readonly kind: 'version-conflict';
  readonly id: string;
  readonly expectedVersion: number;
}

export interface VersionedRecordStore {
  insert(id: string, value: string, tx?: TransactionContext): Promise<void>;
  get(id: string, tx?: TransactionContext): Promise<VersionedRecord | undefined>;
  /** Succeeds only if the stored version still equals `expectedVersion`; never overwrites silently. */
  updateIfVersion(
    id: string,
    expectedVersion: number,
    value: string,
    tx?: TransactionContext,
  ): Promise<Result<{ version: number }, VersionConflict>>;
}

export class DrizzleVersionedRecordStore implements VersionedRecordStore {
  constructor(private readonly db: Database) {}

  async insert(id: string, value: string, tx?: TransactionContext): Promise<void> {
    await executorFor(this.db, tx).insert(versionRecord).values({ id, value });
  }

  async get(id: string, tx?: TransactionContext): Promise<VersionedRecord | undefined> {
    const rows = await executorFor(this.db, tx)
      .select()
      .from(versionRecord)
      .where(eq(versionRecord.id, id));
    return rows[0];
  }

  async updateIfVersion(
    id: string,
    expectedVersion: number,
    value: string,
    tx?: TransactionContext,
  ) {
    const rows = await executorFor(this.db, tx)
      .update(versionRecord)
      .set({ value, version: sql`${versionRecord.version} + 1` })
      .where(and(eq(versionRecord.id, id), eq(versionRecord.version, expectedVersion)))
      .returning({ version: versionRecord.version });
    const row = rows[0];
    return row
      ? ok({ version: row.version })
      : err({ kind: 'version-conflict' as const, id, expectedVersion });
  }
}

// ---- Idempotency ------------------------------------------------------------------------------

export type IdempotencyOutcome =
  | { readonly kind: 'created' }
  | { readonly kind: 'replayed' } // same scope+key and same request hash: a safe repeat
  | { readonly kind: 'conflict' }; // same scope+key but a different request hash: key reuse

export interface IdempotencyStore {
  claim(
    scope: string,
    key: string,
    requestHash: string,
    tx?: TransactionContext,
  ): Promise<IdempotencyOutcome>;
}

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async claim(
    scope: string,
    key: string,
    requestHash: string,
    tx?: TransactionContext,
  ): Promise<IdempotencyOutcome> {
    const executor = executorFor(this.db, tx);
    // A concurrent claimer blocks here until the first inserter commits, then this is a no-op.
    const inserted = await executor
      .insert(idempotencyRecord)
      .values({ scope, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyRecord.key });
    if (inserted.length === 1) return { kind: 'created' };
    const existing = await executor
      .select({ requestHash: idempotencyRecord.requestHash })
      .from(idempotencyRecord)
      .where(and(eq(idempotencyRecord.scope, scope), eq(idempotencyRecord.key, key)));
    return existing[0]?.requestHash === requestHash ? { kind: 'replayed' } : { kind: 'conflict' };
  }
}

// ---- Atomic domain state + audit + outbox -----------------------------------------------------

export interface AtomicChangeWriter {
  /** Writes domain state, an audit row and an outbox row in one transaction. */
  record(id: string, state: string, options?: { failAfterAudit?: boolean }): Promise<void>;
}

export class DrizzleAtomicChangeWriter implements AtomicChangeWriter {
  constructor(
    private readonly db: Database,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async record(
    id: string,
    state: string,
    options: { failAfterAudit?: boolean } = {},
  ): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      const executor = executorFor(this.db, tx);
      await executor.insert(domainRecord).values({ id, state });
      await executor.insert(auditRecord).values({ domainId: id, action: 'state-recorded' });
      if (options.failAfterAudit) throw new Error('injected failure after audit write');
      await executor.insert(outboxRecord).values({ domainId: id, eventType: 'state-recorded' });
    });
  }
}
