/**
 * @sdris/database public entry point (infrastructure; consumed by application composition roots).
 * Domain modules, contracts, config and the shared kernel must not import this package.
 */
export { DEFAULT_LOCAL_DATABASE_URL, resolveDatabaseUrl, loadLocalEnvFile } from './config';
export type { Database, DatabaseConnection } from './connection';
export { createDatabase, isReachable } from './connection';
export type {
  ScriptFile,
  ScriptKind,
  ScriptState,
  ScriptStatus,
  MigrationErrorCode,
} from './migrations';
export { MigrationError, applyScripts, scriptStatus, loadScripts, checksumOf } from './migrations';
export {
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  isUniqueViolation,
  isRetryableTransactionFailure,
} from './persistence-errors';
export type { DatabaseTarget } from './safety';
export {
  UnsafeDatabaseTargetError,
  DISPOSABLE_DATABASE_NAME,
  assertDisposableLocalTarget,
  describeTarget,
} from './safety';
export type { SchemaName } from './schemas';
export { SCHEMA_OWNERSHIP, SCHEMA_NAMES } from './schemas';
export type { TransactionContext, UnitOfWork } from './unit-of-work';
export { TransactionContextError, createUnitOfWork, executorFor } from './unit-of-work';

export type { PersistenceHandle } from './persistence-handle';
export {
  UnknownPersistenceHandleError,
  createPersistenceHandle,
  unitOfWorkOf,
  executorOf,
} from './persistence-handle';
