import type { CorrelationId } from './correlation-id';

/**
 * Stable technical error contract.
 *
 * Domain-specific error codes are owned by their bounded contexts; the kernel only defines the
 * shape. `code` is machine-readable and must not change once published; `message` is for humans
 * and may be reworded.
 */
export interface SdrisError<TCode extends string = string, TDetails = unknown> {
  readonly code: TCode;
  readonly message: string;
  readonly details?: TDetails;
  readonly correlationId?: CorrelationId;
}

export interface CreateErrorInput<TCode extends string, TDetails> {
  readonly code: TCode;
  readonly message: string;
  readonly details?: TDetails;
  readonly correlationId?: CorrelationId;
}

/** Lower-case dot-separated segments, e.g. `evidence.artifact_not_found`. */
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export function isErrorCode(value: unknown): value is string {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value);
}

/**
 * Creates a frozen error value. A malformed code or empty message is a programming error, so it
 * throws instead of returning a Result.
 */
export function createError<TCode extends string, TDetails = undefined>(
  input: CreateErrorInput<TCode, TDetails>,
): SdrisError<TCode, TDetails> {
  if (!isErrorCode(input.code)) {
    throw new RangeError(`Invalid error code: ${JSON.stringify(input.code)}`);
  }
  if (typeof input.message !== 'string' || input.message.trim() === '') {
    throw new RangeError('Error message must be a non-empty string');
  }
  return Object.freeze({
    code: input.code,
    message: input.message,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  });
}
