import { err, ok, type Result } from './result';
import { kernelError, type KernelError } from './kernel-error';

declare const entityIdBrand: unique symbol;

/**
 * Internal SDRIS entity identifier: a canonical (lower-case) UUIDv7 string, branded with the
 * entity type it identifies so that `EntityId<'UUT'>` and `EntityId<'InvestigationCase'>` are not
 * interchangeable at compile time.
 *
 * This is NOT an external manufacturing or test-system identifier. External identifiers are
 * references and must be modelled separately.
 */
export type EntityId<TType extends string = string> = string & {
  readonly [entityIdBrand]: TType;
};

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;
const RANDOM_BYTES = 10;

export function isEntityId<TType extends string = string>(
  value: unknown,
): value is EntityId<TType> {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value);
}

/**
 * Validates untrusted input as an EntityId (canonical lower-case UUIDv7, RFC 9562 variant).
 * The entity type is a compile-time label only; the string alone cannot prove which type it names.
 */
export function parseEntityId<TType extends string = string>(
  value: unknown,
  field?: string,
): Result<EntityId<TType>, KernelError> {
  if (!isEntityId<TType>(value)) {
    return err(
      kernelError(
        'shared_kernel.invalid_entity_id',
        'must be a canonical lower-case UUIDv7',
        field,
      ),
    );
  }
  return ok(value);
}

/** Milliseconds since the Unix epoch encoded in the identifier. */
export function getEntityIdTimestampMs(id: EntityId): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

export interface EntityIdGeneratorOptions {
  /** Milliseconds since the Unix epoch. Defaults to `Date.now`. Override for deterministic tests. */
  readonly now?: () => number;
  /** Returns at least 10 random bytes. Defaults to Web Crypto. Override for deterministic tests. */
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface EntityIdGenerator {
  next<TType extends string>(): EntityId<TType>;
}

function defaultRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Creates a UUIDv7 generator. Injecting `now`/`randomBytes` only changes the inputs: generated
 * values pass through exactly the same format and validation rules as production ones.
 *
 * Identifiers from one generator instance are strictly increasing (RFC 9562 method 1): within the
 * same millisecond, or if the clock moves backwards, a 12-bit counter in `rand_a` increments. Only
 * when the counter overflows is the timestamp advanced by one millisecond, so the embedded time
 * stays within about a millisecond of the real clock per ~2000 identifiers.
 */
export function createEntityIdGenerator(options: EntityIdGeneratorOptions = {}): EntityIdGenerator {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  let lastTimestamp = -1;
  let counter = 0;

  return {
    next<TType extends string>(): EntityId<TType> {
      const clock = now();
      if (!Number.isInteger(clock) || clock < 0 || clock > MAX_TIMESTAMP_MS) {
        throw new RangeError('Clock must return integer milliseconds within the 48-bit range');
      }
      const bytes = randomBytes(RANDOM_BYTES);
      if (bytes.length < RANDOM_BYTES) {
        throw new RangeError(`randomBytes must return at least ${RANDOM_BYTES} bytes`);
      }
      // Fresh counter seed keeps the top bit clear to leave headroom for increments.
      const seed = (((bytes[0] as number) << 8) | (bytes[1] as number)) & 0x7ff;

      if (clock > lastTimestamp) {
        lastTimestamp = clock;
        counter = seed;
      } else {
        counter += 1;
        if (counter > 0xfff) {
          lastTimestamp += 1;
          counter = seed;
        }
      }
      if (lastTimestamp > MAX_TIMESTAMP_MS) {
        throw new RangeError('UUIDv7 timestamp overflow');
      }

      const hex = Array.from(bytes.subarray(2, RANDOM_BYTES), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      const ts = lastTimestamp.toString(16).padStart(12, '0');
      const randA = counter.toString(16).padStart(3, '0');
      const variant = ((parseInt(hex[0] as string, 16) & 0x3) | 0x8).toString(16);
      const id =
        `${ts.slice(0, 8)}-${ts.slice(8)}-7${randA}-` +
        `${variant}${hex.slice(1, 4)}-${hex.slice(4, 16)}`;
      return id as EntityId<TType>;
    },
  };
}

const defaultGenerator = createEntityIdGenerator();

/** Generates a new EntityId using the system clock and a cryptographically secure source. */
export function newEntityId<TType extends string>(): EntityId<TType> {
  return defaultGenerator.next<TType>();
}
