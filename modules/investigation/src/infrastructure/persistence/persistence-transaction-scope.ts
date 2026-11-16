import { unitOfWorkOf, type PersistenceHandle } from '@sdris/database';
import type { TransactionScope, TransactionToken } from '../../application/ports/transaction-scope';

/**
 * Implements this context's transaction port on top of the database package's unit of work. The
 * database's opaque transaction context is handed to the application as an equally opaque token.
 */
export class PersistenceTransactionScope implements TransactionScope {
  constructor(private readonly persistence: PersistenceHandle) {}

  run<T>(work: (tx: TransactionToken) => Promise<T>): Promise<T> {
    return unitOfWorkOf(this.persistence).run((context) =>
      work(context as unknown as TransactionToken),
    );
  }
}
