import type { PersistenceHandle } from '@sdris/database';
import type { Repo } from '../application/ports/repo';
import { DrizzleRepo } from '../infrastructure/persistence/adapter';
export interface InvestigationModule {
  readonly repo: Repo;
}
export function createInvestigationModule(_persistence: PersistenceHandle): InvestigationModule {
  return { repo: new DrizzleRepo() };
}
import type * as Api from '@sdris/api';
export type A = typeof Api;
