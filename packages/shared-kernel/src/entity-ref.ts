import { isEntityId, type EntityId } from './entity-id';
import { err, ok, type Result } from './result';
import { isRecord, kernelError, type KernelError } from './kernel-error';

/**
 * Typed reference to an entity owned by some bounded context: an explicit entity type plus a valid
 * internal identifier. Carries no aggregate behaviour and does not imply shared ownership.
 */
export interface EntityRef<TType extends string = string> {
  readonly entityType: TType;
  readonly id: EntityId<TType>;
}

const ENTITY_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function isEntityType(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_TYPE_PATTERN.test(value);
}

/**
 * Builds a frozen EntityRef. Passing an id branded for a different entity type is a compile-time
 * error; the runtime checks guard against casts and untyped callers.
 */
export function createEntityRef<TType extends string>(
  entityType: TType,
  id: EntityId<NoInfer<TType>>,
  field?: string,
): Result<EntityRef<TType>, KernelError> {
  if (!isEntityType(entityType)) {
    return err(
      kernelError(
        'shared_kernel.invalid_entity_type',
        'must start with a letter and contain only [A-Za-z0-9_] (max 64 characters)',
        field === undefined ? 'entityType' : `${field}.entityType`,
      ),
    );
  }
  if (!isEntityId(id)) {
    return err(
      kernelError(
        'shared_kernel.invalid_entity_id',
        'must be a canonical lower-case UUIDv7',
        field === undefined ? 'id' : `${field}.id`,
      ),
    );
  }
  return ok(Object.freeze({ entityType, id: id as EntityId<TType> }));
}

/**
 * Validates untrusted input (e.g. parsed JSON) as an EntityRef.
 *
 * Without `expectedType` the result is a general `EntityRef`. With it, the input's `entityType`
 * must equal `expectedType` at runtime and the result is narrowed to `EntityRef<TType>`. The
 * narrowed type can only be requested by passing the value: `parseEntityRef<'UUT'>(input)` does
 * not compile, because a compile-time-only type argument cannot be checked at runtime.
 */
export function parseEntityRef(
  input: unknown,
  expectedType?: undefined,
  field?: string,
): Result<EntityRef, KernelError>;
export function parseEntityRef<const TType extends string>(
  input: unknown,
  expectedType: TType,
  field?: string,
): Result<EntityRef<TType>, KernelError>;
export function parseEntityRef(
  input: unknown,
  expectedType?: string,
  field?: string,
): Result<EntityRef, KernelError> {
  if (!isRecord(input)) {
    return err(kernelError('shared_kernel.invalid_entity_ref', 'must be an object', field));
  }
  const { entityType, id } = input;
  if (expectedType !== undefined && entityType !== expectedType) {
    return err(
      kernelError(
        'shared_kernel.invalid_entity_ref',
        `entityType must be "${expectedType}"`,
        field === undefined ? 'entityType' : `${field}.entityType`,
      ),
    );
  }
  return createEntityRef(entityType as string, id as EntityId, field);
}

export function entityRefEquals(a: EntityRef, b: EntityRef): boolean {
  return a.entityType === b.entityType && a.id === b.id;
}
