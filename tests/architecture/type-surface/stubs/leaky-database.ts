// A PersistenceHandle that is not opaque: it exposes a Drizzle database. Must be caught by descent.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
export interface PersistenceHandle {
  readonly db: NodePgDatabase;
}
