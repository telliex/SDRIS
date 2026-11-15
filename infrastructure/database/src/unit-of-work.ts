import type { Database } from './connection';

/**
 * Transaction boundary that carries no ORM types.
 *
 * Application code receives an opaque `TransactionContext` and hands it back to repositories;
 * only infrastructure adapters can turn it into a Drizzle executor with `executorFor`. This lets a
 * use case span several repositories atomically without importing Drizzle.
 *
 * Where the port itself should live (per owning module vs. shared) is a pending Owner decision;
 * see docs/architecture/persistence.md.
 */
declare const transactionContextBrand: unique symbol;
export interface TransactionContext {
  readonly [transactionContextBrand]: true;
}

export interface UnitOfWork {
  /** Runs `work` in one transaction: commits if it resolves, rolls back and rethrows if it rejects. */
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];

export class TransactionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionContextError';
  }
}

interface Handle {
  executor: Executor;
  active: boolean;
}
const handles = new WeakMap<object, Handle>();

export function createUnitOfWork(db: Database): UnitOfWork {
  return {
    async run(work) {
      return db.transaction(async (executor) => {
        const context = Object.freeze({}) as TransactionContext;
        const handle: Handle = { executor, active: true };
        handles.set(context, handle);
        try {
          return await work(context);
        } finally {
          handle.active = false; // a leaked context cannot be reused after commit/rollback
        }
      });
    },
  };
}

/** Adapter-side: the executor to use, i.e. the transaction if one is given, else the pool. */
export function executorFor(db: Database, tx?: TransactionContext): Database | Executor {
  if (tx === undefined) return db;
  const handle = handles.get(tx);
  if (!handle) throw new TransactionContextError('Unknown transaction context.');
  if (!handle.active) throw new TransactionContextError('Transaction context is no longer active.');
  return handle.executor;
}
