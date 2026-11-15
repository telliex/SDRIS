/** PostgreSQL SQLSTATE codes the persistence layer distinguishes. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_DEADLOCK_DETECTED = '40P01';

/** Finds the SQLSTATE on an error or anywhere along its `cause` chain (Drizzle wraps driver errors). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (error: unknown): boolean =>
  pgErrorCode(error) === PG_UNIQUE_VIOLATION;

/** Failures that PostgreSQL documents as safe to retry the whole transaction. */
export const isRetryableTransactionFailure = (error: unknown): boolean => {
  const code = pgErrorCode(error);
  return code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED;
};
