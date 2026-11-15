import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../../application/ports/repo';
import { DrizzleRepo, makeAdapter } from '../../infrastructure/persistence/adapter';
import * as tables from '../../infrastructure/persistence/tables';
void makeAdapter;
void tables;
void DrizzleRepo;

export function create(): Promise<DrizzleRepo> {
  return Promise.resolve(new DrizzleRepo());
}
