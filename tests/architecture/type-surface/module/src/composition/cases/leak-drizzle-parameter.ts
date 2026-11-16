import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../../application/ports/repo';
import { DrizzleRepo, makeAdapter } from '../../infrastructure/persistence/adapter';
import * as tables from '../../infrastructure/persistence/tables';
void makeAdapter;
void tables;
void DrizzleRepo;

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
export function create(_db: NodePgDatabase): Repo {
  return new DrizzleRepo();
}
