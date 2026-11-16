import type { PersistenceHandle } from '@sdris/database';
export interface Exposed {
  readonly handle: PersistenceHandle;
}
