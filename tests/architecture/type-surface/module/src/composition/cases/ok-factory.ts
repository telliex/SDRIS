import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../../application/ports/repo';
import { DrizzleRepo, makeAdapter } from '../../infrastructure/persistence/adapter';
import * as tables from '../../infrastructure/persistence/tables';
void makeAdapter;
void tables;
void DrizzleRepo;

export interface InvestigationModule {
  readonly repo: Repo;
}
export function createInvestigationModule(_p: PersistenceHandle): InvestigationModule {
  return { repo: new DrizzleRepo() };
}
