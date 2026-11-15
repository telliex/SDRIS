import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import {
  createPersistenceHandle,
  executorOf,
  unitOfWorkOf,
  type PersistenceHandle,
} from './persistence-handle';
import { TransactionContextError } from './unit-of-work';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';

describe('PersistenceHandle against real PostgreSQL', () => {
  let target: IsolatedDatabase;
  let handle: PersistenceHandle;
  const count = async () =>
    Number(
      (
        (await executorOf(handle).execute(sql`select count(*)::int as n from handle_probe`))
          .rows[0] as { n: number }
      ).n,
    );

  before(async () => {
    target = await createIsolatedDatabase();
    await target.connection.pool.query('create table handle_probe (id int primary key)');
    handle = createPersistenceHandle(target.connection);
  });
  after(async () => {
    await target.drop();
  });

  it('commits writes made through the executor of a unit of work', async () => {
    await unitOfWorkOf(handle).run(async (tx) => {
      await executorOf(handle, tx).execute(sql`insert into handle_probe values (1), (2)`);
    });
    assert.equal(await count(), 2);
  });

  it('rolls back everything when the unit of work fails', async () => {
    await assert.rejects(
      unitOfWorkOf(handle).run(async (tx) => {
        await executorOf(handle, tx).execute(sql`insert into handle_probe values (10)`);
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(await count(), 2);
  });

  it('refuses to use a transaction context after the unit of work ended', async () => {
    let leaked: Parameters<typeof executorOf>[1];
    await unitOfWorkOf(handle).run(async (tx) => {
      leaked = tx;
    });
    assert.throws(() => executorOf(handle, leaked), TransactionContextError);
  });
});
