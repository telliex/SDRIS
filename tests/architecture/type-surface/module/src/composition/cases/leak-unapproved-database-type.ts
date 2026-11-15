import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../../application/ports/repo';
import { DrizzleRepo, makeAdapter } from '../../infrastructure/persistence/adapter';
import * as tables from '../../infrastructure/persistence/tables';
void makeAdapter;
void tables;
void DrizzleRepo;

import type { UnitOfWork } from '@sdris/database';
export function create(_u: UnitOfWork): Repo {
  return new DrizzleRepo();
}
