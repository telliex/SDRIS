import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { isUniqueViolation } from './persistence-errors';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';
import {
  createSpikeTables,
  domainRecord,
  auditRecord,
  outboxRecord,
  DrizzleAtomicChangeWriter,
  DrizzleIdempotencyStore,
  DrizzleVersionedRecordStore,
  versionRecord,
} from './testing/spike-store';
import { applyScripts } from './migrations';
import {
  executorFor,
  TransactionContextError,
  createUnitOfWork,
  type TransactionContext,
} from './unit-of-work';
import path from 'node:path';

describe('persistence capabilities against real PostgreSQL', () => {
  let target: IsolatedDatabase;
  const db = () => target.connection.db;
  const count = async (
    table: typeof domainRecord | typeof auditRecord | typeof outboxRecord | typeof versionRecord,
  ) =>
    (
      await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
    )[0]!.n;

  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(
      target.connection.pool,
      'migration',
      path.resolve(__dirname, '..', 'migrations'),
    );
    await createSpikeTables(target.connection.pool);
  });
  after(async () => {
    await target.drop();
  });

  describe('transactions', () => {
    it('commits multiple writes together', async () => {
      const uow = createUnitOfWork(db());
      const store = new DrizzleVersionedRecordStore(db());
      await uow.run(async (tx) => {
        await store.insert('commit-a', 'a', tx);
        await store.insert('commit-b', 'b', tx);
      });
      assert.equal((await store.get('commit-a'))?.value, 'a');
      assert.equal((await store.get('commit-b'))?.value, 'b');
    });

    it('rolls back every write when the unit of work fails, and propagates the error', async () => {
      const uow = createUnitOfWork(db());
      const store = new DrizzleVersionedRecordStore(db());
      await assert.rejects(
        uow.run(async (tx) => {
          await store.insert('rollback-a', 'a', tx);
          await store.insert('rollback-b', 'b', tx);
          throw new Error('domain failure');
        }),
        /domain failure/,
      );
      assert.equal(await store.get('rollback-a'), undefined);
      assert.equal(await store.get('rollback-b'), undefined);
    });

    it('rolls back earlier writes when a later statement fails in the database', async () => {
      const uow = createUnitOfWork(db());
      const store = new DrizzleVersionedRecordStore(db());
      await store.insert('dup', 'original');
      await assert.rejects(
        uow.run(async (tx) => {
          await store.insert('before-dup', 'x', tx);
          await store.insert('dup', 'again', tx); // primary-key violation
        }),
        (error) => isUniqueViolation(error),
      );
      assert.equal(await store.get('before-dup'), undefined);
      assert.equal((await store.get('dup'))?.value, 'original');
    });

    it('does not see uncommitted writes from another transaction', async () => {
      const uow = createUnitOfWork(db());
      const store = new DrizzleVersionedRecordStore(db());
      let seenInside: unknown;
      await uow.run(async (tx) => {
        await store.insert('isolated', 'x', tx);
        seenInside = await store.get('isolated'); // reads through the pool, a different connection
      });
      assert.equal(seenInside, undefined);
      assert.ok(await store.get('isolated'));
    });

    it('invalidates a transaction context once the unit of work has finished', async () => {
      const uow = createUnitOfWork(db());
      let leaked: TransactionContext | undefined;
      await uow.run(async (tx) => {
        leaked = tx;
      });
      assert.throws(() => executorFor(db(), leaked), TransactionContextError);
      assert.throws(() => executorFor(db(), {} as TransactionContext), TransactionContextError);
    });

    it('writes domain state, audit and outbox atomically', async () => {
      const writer = new DrizzleAtomicChangeWriter(db(), createUnitOfWork(db()));
      await writer.record('atomic-ok', 'recorded');
      const rows = await Promise.all([
        count(domainRecord),
        count(auditRecord),
        count(outboxRecord),
      ]);
      assert.deepEqual(rows, [1, 1, 1]);
    });

    it('leaves no domain, audit or outbox row when the unit fails midway', async () => {
      const writer = new DrizzleAtomicChangeWriter(db(), createUnitOfWork(db()));
      await assert.rejects(
        writer.record('atomic-fail', 'recorded', { failAfterAudit: true }),
        /injected failure/,
      );
      const rows = await Promise.all([
        count(domainRecord),
        count(auditRecord),
        count(outboxRecord),
      ]);
      assert.deepEqual(rows, [1, 1, 1], 'counts unchanged from the successful record above');
      const leaked = await db()
        .select()
        .from(domainRecord)
        .where(sql`${domainRecord.id} = 'atomic-fail'`);
      assert.deepEqual(leaked, []);
    });
  });

  describe('optimistic concurrency', () => {
    it('succeeds when the expected version matches and increments it', async () => {
      const store = new DrizzleVersionedRecordStore(db());
      await store.insert('occ-1', 'v1');
      const result = await store.updateIfVersion('occ-1', 1, 'v2');
      assert.ok(result.ok && result.value.version === 2);
      assert.deepEqual(await store.get('occ-1'), { id: 'occ-1', value: 'v2', version: 2 });
    });

    it('rejects a stale version as a conflict and does not change the row', async () => {
      const store = new DrizzleVersionedRecordStore(db());
      await store.insert('occ-2', 'v1');
      await store.updateIfVersion('occ-2', 1, 'v2');
      const stale = await store.updateIfVersion('occ-2', 1, 'stale-write');
      assert.ok(!stale.ok);
      assert.deepEqual(stale.error, { kind: 'version-conflict', id: 'occ-2', expectedVersion: 1 });
      assert.deepEqual(await store.get('occ-2'), { id: 'occ-2', value: 'v2', version: 2 });
    });

    it('treats a missing row as a conflict, not a success', async () => {
      const store = new DrizzleVersionedRecordStore(db());
      assert.ok(!(await store.updateIfVersion('does-not-exist', 1, 'x')).ok);
    });

    it('lets exactly one of many simultaneous updaters win', async () => {
      const store = new DrizzleVersionedRecordStore(db());
      await store.insert('occ-race', 'start');
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => store.updateIfVersion('occ-race', 1, `writer-${i}`)),
      );
      const winners = results.filter((r) => r.ok);
      assert.equal(winners.length, 1);
      assert.equal(results.filter((r) => !r.ok).length, 11);
      const row = await store.get('occ-race');
      assert.equal(row?.version, 2);
      assert.equal(row?.value, `writer-${results.findIndex((r) => r.ok)}`);
    });

    it('loses no update when competing writers retry on conflict', async () => {
      const store = new DrizzleVersionedRecordStore(db());
      await store.insert('occ-counter', '0');
      const writers = 8;
      const incrementsEach = 5;
      const increment = async () => {
        for (let done = 0; done < incrementsEach;) {
          const current = await store.get('occ-counter');
          const result = await store.updateIfVersion(
            'occ-counter',
            current!.version,
            String(Number(current!.value) + 1),
          );
          if (result.ok) done += 1; // on conflict: re-read and retry
        }
      };
      await Promise.all(Array.from({ length: writers }, increment));
      const final = await store.get('occ-counter');
      assert.equal(final?.value, String(writers * incrementsEach));
      assert.equal(final?.version, 1 + writers * incrementsEach);
    });
  });

  describe('idempotency', () => {
    it('creates once, then recognises a repeat of the same request', async () => {
      const store = new DrizzleIdempotencyStore(db());
      assert.deepEqual(await store.claim('scope-a', 'key-1', 'hash-1'), { kind: 'created' });
      assert.deepEqual(await store.claim('scope-a', 'key-1', 'hash-1'), { kind: 'replayed' });
    });

    it('flags key reuse with a different payload as a conflict', async () => {
      const store = new DrizzleIdempotencyStore(db());
      await store.claim('scope-b', 'key-1', 'hash-1');
      assert.deepEqual(await store.claim('scope-b', 'key-1', 'hash-2'), { kind: 'conflict' });
    });

    it('scopes keys: the same key in another scope is independent', async () => {
      const store = new DrizzleIdempotencyStore(db());
      await store.claim('scope-c1', 'shared-key', 'h');
      assert.deepEqual(await store.claim('scope-c2', 'shared-key', 'other'), { kind: 'created' });
    });

    it('enforces uniqueness in the database itself, not just in application code', async () => {
      await db().execute(
        sql`insert into spike_s0_04.idempotency_record values ('scope-d', 'k', 'h')`,
      );
      await assert.rejects(
        db().execute(sql`insert into spike_s0_04.idempotency_record values ('scope-d', 'k', 'h')`),
        (error) => isUniqueViolation(error),
      );
    });

    it('commits exactly one record when many identical requests race', async () => {
      const store = new DrizzleIdempotencyStore(db());
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () => store.claim('scope-e', 'race', 'h')),
      );
      assert.equal(outcomes.filter((o) => o.kind === 'created').length, 1);
      assert.equal(outcomes.filter((o) => o.kind === 'replayed').length, 11);
      const rows = await db().execute(
        sql`select count(*)::int as n from spike_s0_04.idempotency_record where scope = 'scope-e'`,
      );
      assert.equal(rows.rows[0]!.n, 1);
    });

    it('separates the winner from conflicting payloads when requests race', async () => {
      const store = new DrizzleIdempotencyStore(db());
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, (_, i) => store.claim('scope-f', 'race', `hash-${i % 2}`)),
      );
      assert.equal(outcomes.filter((o) => o.kind === 'created').length, 1);
      assert.ok(outcomes.some((o) => o.kind === 'conflict'));
      const rows = await db().execute(
        sql`select count(*)::int as n from spike_s0_04.idempotency_record where scope = 'scope-f'`,
      );
      assert.equal(rows.rows[0]!.n, 1);
    });
  });
});
