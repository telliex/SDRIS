import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../../application/ports/repo';
import { DrizzleRepo, makeAdapter } from '../../infrastructure/persistence/adapter';
import * as tables from '../../infrastructure/persistence/tables';
void makeAdapter;
void tables;
void DrizzleRepo;

export interface M {
  readonly repo: DrizzleRepo;
}
export function create(_p: PersistenceHandle): M {
  return { repo: new DrizzleRepo() };
}
