import {
  createError,
  err,
  ok,
  type EntityId,
  type Result,
  type SdrisError,
  type Timestamp,
} from '@sdris/shared-kernel';
import type { UutRef } from './uut';

/**
 * One test execution as SDRIS registered it (Owner decision Q4).
 *
 * `stage` comes from a controlled vocabulary; extending it is an explicit change to {@link TEST_STAGES}. The
 * external execution reference is an optional external attribute: it is not unique and is never the internal id.
 * There is deliberately no PASS/FAIL result field: a result is not inferred from incomplete evidence.
 * A TestAttempt is immutable after registration in S0-05.
 */
export type TestAttemptId = EntityId<'TestAttempt'>;

export const TEST_STAGES = ['IST', 'SAT'] as const;
export type TestStage = (typeof TEST_STAGES)[number];

export interface TestAttempt {
  readonly id: TestAttemptId;
  readonly uut: UutRef;
  readonly stage: TestStage;
  readonly externalExecutionReference?: string;
  /** When SDRIS registered the attempt. Not the time the external test ran. */
  readonly registeredAt: Timestamp;
}

export type InvalidTestStageError = SdrisError<
  'investigation.invalid_test_stage',
  { readonly actual?: string }
>;

/** Exact match only: no case folding and no trimming. */
export function parseTestStage(value: unknown): Result<TestStage, InvalidTestStageError> {
  if (typeof value === 'string' && (TEST_STAGES as readonly string[]).includes(value)) {
    return ok(value as TestStage);
  }
  return err(
    createError({
      code: 'investigation.invalid_test_stage' as const,
      message: `The test stage must be one of ${TEST_STAGES.join(', ')}.`,
      details: { actual: typeof value === 'string' ? value : typeof value },
    }),
  );
}

export function registerTestAttempt(input: {
  readonly id: TestAttemptId;
  readonly uut: UutRef;
  readonly stage: TestStage;
  readonly externalExecutionReference?: string;
  readonly registeredAt: Timestamp;
}): TestAttempt {
  return Object.freeze({
    id: input.id,
    uut: input.uut,
    stage: input.stage,
    ...(input.externalExecutionReference === undefined
      ? {}
      : { externalExecutionReference: input.externalExecutionReference }),
    registeredAt: input.registeredAt,
  });
}
