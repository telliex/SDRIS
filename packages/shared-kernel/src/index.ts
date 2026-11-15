/**
 * @sdris/shared-kernel public entry point.
 *
 * Minimal, framework-independent technical primitives only. No business entities, no universal
 * status enums, no cross-context logic. Anything not exported here is internal.
 */
export type { Ok, Err, Result } from './result';
export { ok, err, isOk, isErr } from './result';

export type { SdrisError, CreateErrorInput } from './error';
export { createError, isErrorCode } from './error';

export type { KernelError, KernelErrorCode, KernelErrorDetails } from './kernel-error';

export type { CorrelationId } from './correlation-id';
export { parseCorrelationId } from './correlation-id';

export type { EntityId, EntityIdGenerator, EntityIdGeneratorOptions } from './entity-id';
export {
  isEntityId,
  parseEntityId,
  getEntityIdTimestampMs,
  createEntityIdGenerator,
  newEntityId,
} from './entity-id';

export type { EntityRef } from './entity-ref';
export { isEntityType, createEntityRef, parseEntityRef, entityRefEquals } from './entity-ref';

export type { Revision, RevisionRef } from './revision-ref';
export {
  parseRevision,
  parseRevisionRef,
  createRevisionRef,
  revisionEquals,
  revisionRefEquals,
} from './revision-ref';
