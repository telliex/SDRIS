import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Database } from './connection';
import {
  UnknownPersistenceHandleError,
  createPersistenceHandle,
  executorOf,
  unitOfWorkOf,
  type PersistenceHandle,
} from './persistence-handle';

const fakeConnection = () => ({ db: { marker: 'db' } as unknown as Database });

describe('PersistenceHandle', () => {
  it('is opaque: it has no own members to read a database or executor from', () => {
    const handle = createPersistenceHandle(fakeConnection());
    assert.deepEqual(Object.keys(handle), []);
    assert.deepEqual(Object.getOwnPropertyNames(handle), []);
    assert.ok(Object.isFrozen(handle));
    assert.equal(JSON.stringify(handle), '{}');
  });

  it('gives the owning package access to the pool executor and a unit of work', () => {
    const connection = fakeConnection();
    const handle = createPersistenceHandle(connection);
    assert.equal(executorOf(handle), connection.db);
    assert.equal(typeof unitOfWorkOf(handle).run, 'function');
    assert.equal(unitOfWorkOf(handle), unitOfWorkOf(handle));
  });

  it('keeps handles independent', () => {
    const a = createPersistenceHandle(fakeConnection());
    const b = createPersistenceHandle(fakeConnection());
    assert.notEqual(executorOf(a), executorOf(b));
  });

  it('rejects a handle it did not create, including a forged or structurally similar object', () => {
    for (const forged of [{}, Object.freeze({}), { db: {}, unitOfWork: {} }, Object.create(null)]) {
      assert.throws(() => unitOfWorkOf(forged as PersistenceHandle), UnknownPersistenceHandleError);
      assert.throws(() => executorOf(forged as PersistenceHandle), UnknownPersistenceHandleError);
    }
  });
});
