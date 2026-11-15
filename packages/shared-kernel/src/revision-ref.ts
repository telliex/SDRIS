import { createEntityRef, parseEntityRef, type EntityRef } from './entity-ref';
import { err, isErr, ok, type Result } from './result';
import { isRecord, kernelError, type KernelError } from './kernel-error';

/**
 * Identifies one specific version of a record or definition. Different SDRIS records may use
 * different versioning strategies, so a revision is a tagged union rather than a single number.
 * New schemes can be added without changing existing ones.
 */
export type Revision =
  | { readonly scheme: 'sequence'; readonly value: number }
  | { readonly scheme: 'label'; readonly value: string };

/** An immutable pointer to a specific revision of a specific entity. */
export interface RevisionRef<TType extends string = string> {
  readonly target: EntityRef<TType>;
  readonly revision: Revision;
}

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function invalid(reason: string, field: string): Result<never, KernelError> {
  return err(kernelError('shared_kernel.invalid_revision', reason, field));
}

/** Validates untrusted input as a Revision and returns a frozen copy. */
export function parseRevision(input: unknown, field = 'revision'): Result<Revision, KernelError> {
  if (!isRecord(input)) {
    return invalid('must be an object', field);
  }
  switch (input.scheme) {
    case 'sequence': {
      const { value } = input;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        return invalid('sequence value must be a positive safe integer', `${field}.value`);
      }
      return ok(Object.freeze({ scheme: 'sequence' as const, value }));
    }
    case 'label': {
      const { value } = input;
      if (typeof value !== 'string' || !LABEL_PATTERN.test(value)) {
        return invalid(
          'label must be 1-64 characters of [A-Za-z0-9._+-] starting with an alphanumeric',
          `${field}.value`,
        );
      }
      return ok(Object.freeze({ scheme: 'label' as const, value }));
    }
    default:
      return invalid('scheme must be "sequence" or "label"', `${field}.scheme`);
  }
}

/**
 * Validates untrusted input as a RevisionRef and returns a deeply frozen copy. As with
 * `parseEntityRef`, the target's entity type is only narrowed when `expectedType` is passed (and
 * then checked at runtime); `parseRevisionRef<'UUT'>(input)` does not compile.
 */
export function parseRevisionRef(
  input: unknown,
  expectedType?: undefined,
  field?: string,
): Result<RevisionRef, KernelError>;
export function parseRevisionRef<const TType extends string>(
  input: unknown,
  expectedType: TType,
  field?: string,
): Result<RevisionRef<TType>, KernelError>;
export function parseRevisionRef(
  input: unknown,
  expectedType?: string,
  field?: string,
): Result<RevisionRef, KernelError> {
  const prefix = field === undefined ? '' : `${field}.`;
  if (!isRecord(input)) {
    return err(kernelError('shared_kernel.invalid_revision', 'must be an object', field));
  }
  const targetField = `${prefix}target`;
  const target =
    expectedType === undefined
      ? parseEntityRef(input.target, undefined, targetField)
      : parseEntityRef(input.target, expectedType, targetField);
  if (isErr(target)) return target;
  const revision = parseRevision(input.revision, `${prefix}revision`);
  if (isErr(revision)) return revision;
  return ok(Object.freeze({ target: target.value, revision: revision.value }));
}

/** Builds a RevisionRef from already-typed parts, re-validating them at runtime. */
export function createRevisionRef<TType extends string>(
  target: EntityRef<TType>,
  revision: Revision,
): Result<RevisionRef<TType>, KernelError> {
  const checked = createEntityRef(target.entityType, target.id, 'target');
  if (isErr(checked)) return checked;
  const rev = parseRevision(revision);
  if (isErr(rev)) return rev;
  return ok(Object.freeze({ target: checked.value, revision: rev.value }));
}

export function revisionEquals(a: Revision, b: Revision): boolean {
  return a.scheme === b.scheme && a.value === b.value;
}

export function revisionRefEquals(a: RevisionRef, b: RevisionRef): boolean {
  return (
    a.target.entityType === b.target.entityType &&
    a.target.id === b.target.id &&
    revisionEquals(a.revision, b.revision)
  );
}
