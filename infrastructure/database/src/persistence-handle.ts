import type { Database, DatabaseConnection } from './connection';
import {
  createUnitOfWork,
  executorFor,
  type TransactionContext,
  type UnitOfWork,
} from './unit-of-work';

/**
 * Opaque persistence contract handed from an application composition root to a module's composition
 * factory. It has no members: no Drizzle database, no SQL executor, no pool. Only the database package can
 * look inside it (with `unitOfWorkOf` and `executorOf`), and a module's own infrastructure adapter calls
 * those. Modules name this type only with `import type`, so there is no runtime dependency on this package
 * from a composition entrypoint.
 */
declare const persistenceHandleBrand: unique symbol;
export interface PersistenceHandle {
  readonly [persistenceHandleBrand]: 'persistence';
}

export class UnknownPersistenceHandleError extends Error {
  constructor() {
    super('Unknown persistence handle: it was not created by createPersistenceHandle.');
    this.name = 'UnknownPersistenceHandleError';
  }
}

interface Inside {
  readonly db: Database;
  readonly unitOfWork: UnitOfWork;
}
const inside = new WeakMap<object, Inside>();

/** Composition-root side: wraps an open connection. The handle does not own or close the connection. */
export function createPersistenceHandle(
  connection: Pick<DatabaseConnection, 'db'>,
): PersistenceHandle {
  const handle = Object.freeze({}) as PersistenceHandle;
  inside.set(handle, { db: connection.db, unitOfWork: createUnitOfWork(connection.db) });
  return handle;
}

function look(handle: PersistenceHandle): Inside {
  const found = inside.get(handle);
  if (!found) throw new UnknownPersistenceHandleError();
  return found;
}

/** Adapter side: the transaction boundary for this handle. */
export const unitOfWorkOf = (handle: PersistenceHandle): UnitOfWork => look(handle).unitOfWork;

/** Adapter side: the executor to query with (the transaction when `tx` is given, otherwise the pool). */
export const executorOf = (
  handle: PersistenceHandle,
  tx?: TransactionContext,
): ReturnType<typeof executorFor> => executorFor(look(handle).db, tx);
