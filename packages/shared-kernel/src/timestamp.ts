import { err, ok, type Result } from './result';
import { kernelError, type KernelError } from './kernel-error';

declare const timestampBrand: unique symbol;

/**
 * An instant in time as a strict UTC ISO-8601 string: `YYYY-MM-DDTHH:mm:ss[.sss]Z`. Offsets other
 * than `Z`, calendar-invalid dates and ambiguous formats are rejected.
 */
export type Timestamp = string & { readonly [timestampBrand]: true };

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function isTimestamp(value: unknown): value is Timestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Round-trip catches overflowing fields such as 2026-02-30 or 24:00:00.
  const normalized = value.length === 20 ? `${value.slice(0, 19)}.000Z` : value;
  return date.toISOString() === normalized;
}

export function parseTimestamp(value: unknown, field?: string): Result<Timestamp, KernelError> {
  if (!isTimestamp(value)) {
    return err(
      kernelError(
        'shared_kernel.invalid_timestamp',
        'must be a valid UTC ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z)',
        field,
      ),
    );
  }
  return ok(value);
}

export function timestampFromDate(date: Date, field?: string): Result<Timestamp, KernelError> {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (Number.isNaN(time)) {
    return err(kernelError('shared_kernel.invalid_timestamp', 'must be a valid Date', field));
  }
  // Years outside 0000-9999 serialize with sign/extra digits; parseTimestamp rejects those.
  return parseTimestamp(date.toISOString(), field);
}

export function timestampToDate(timestamp: Timestamp): Date {
  return new Date(timestamp);
}
