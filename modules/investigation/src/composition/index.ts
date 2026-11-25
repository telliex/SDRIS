import type { PersistenceHandle } from '@sdris/database';
import {
  newEntityId,
  timestampFromDate,
  type EntityId,
  type Timestamp,
} from '@sdris/shared-kernel';
import {
  createInvestigationService,
  type InvestigationService,
} from '../application/investigation-service';
export type {
  ActorHandle,
  ActorResolution,
  ActorResolver,
  VerifiedActor,
} from '../application/ports/actor-resolver';
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
  /** Clock override, mainly for tests. */
  readonly now?: () => Timestamp;
  /** Identifier generator override, mainly for tests. */
  readonly newId?: <TType extends string>() => EntityId<TType>;
}

function systemNow(): Timestamp {
  const result = timestampFromDate(new Date());
  if (!result.ok)
    throw new Error(`System clock produced an invalid timestamp: ${result.error.message}`);
  return result.value;
}

export function createInvestigationModule(
  persistence: PersistenceHandle,
  options: InvestigationModuleOptions = {},
): InvestigationModule {
  return {
    service: createInvestigationService({
      repository: new DrizzleInvestigationRepository(persistence),
      transactions: new PersistenceTransactionScope(persistence),
      now: options.now ?? systemNow,
      newId: options.newId ?? newEntityId,
    }),
  };
}
