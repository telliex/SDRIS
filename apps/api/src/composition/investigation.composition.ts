import { createPersistenceHandle, type DatabaseConnection } from '@sdris/database';
import {
  createInvestigationModule,
  type InvestigationModule,
} from '@sdris/investigation/composition';

/**
 * Application composition root for the Investigation context (the only approved importer of
 * `@sdris/investigation/composition`, see dependency-matrix.json). It turns an open database connection
 * into an opaque persistence handle and asks the module for its service. It never sees the module's
 * persistence adapter or any ORM type.
 */
export function composeInvestigation(connection: DatabaseConnection): InvestigationModule {
  return createInvestigationModule(createPersistenceHandle(connection));
}
