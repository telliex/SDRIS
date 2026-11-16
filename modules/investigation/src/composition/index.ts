import type { PersistenceHandle } from '@sdris/database';
import { newEntityId, type EntityId } from '@sdris/shared-kernel';
import {
  createInvestigationService,
  type InvestigationService,
} from '../application/investigation-service';
import { DrizzleInvestigationRepository } from '../infrastructure/persistence/drizzle-investigation-repository';
import { PersistenceTransactionScope } from '../infrastructure/persistence/persistence-transaction-scope';

/**
 * `@sdris/investigation/composition`: the one entrypoint an approved application composition root uses to
 * obtain a working Investigation module. It exposes a factory and contracts only. The persistence adapter,
 * its Drizzle tables and every ORM or driver type stay private to `src/infrastructure`.
 */
export interface InvestigationModule {
  readonly service: InvestigationService;
}

export interface InvestigationModuleOptions {
  /** Identifier generator override, mainly for tests. */
  readonly newId?: <TType extends string>() => EntityId<TType>;
}

export function createInvestigationModule(
  persistence: PersistenceHandle,
  options: InvestigationModuleOptions = {},
): InvestigationModule {
  return {
    service: createInvestigationService({
      repository: new DrizzleInvestigationRepository(persistence),
      transactions: new PersistenceTransactionScope(persistence),
      newId: options.newId ?? newEntityId,
    }),
  };
}
