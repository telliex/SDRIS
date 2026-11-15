import {
  createError,
  err,
  ok,
  type EntityId,
  type EntityRef,
  type Result,
  type SdrisError,
  type Timestamp,
} from '@sdris/shared-kernel';

/**
 * Minimal Investigation aggregate used to carry a case and the failure observations recorded against it.
 *
 * Scope note: this is the smallest shape needed to exercise persistence, optimistic concurrency and the
 * cross-UUT rule. It deliberately has no status, no hypotheses and no lifecycle; those need the approved
 * S0-05 specification and an Owner decision (new domain state semantics).
 */
export type InvestigationCaseId = EntityId<'InvestigationCase'>;
export type FailureObservationId = EntityId<'FailureObservation'>;
export type UutRef = EntityRef<'UUT'>;

export interface FailureObservation {
  readonly id: FailureObservationId;
  readonly caseId: InvestigationCaseId;
  /** The unit under test this observation was made on. It must be the case's own UUT. */
  readonly uut: UutRef;
  readonly description: string;
  readonly observedAt: Timestamp;
}

export interface InvestigationCase {
  readonly id: InvestigationCaseId;
  readonly uut: UutRef;
  readonly openedAt: Timestamp;
  /** The persisted version this state was loaded at (1 for a newly opened case). */
  readonly version: number;
  readonly observations: readonly FailureObservation[];
}

export type InvestigationDomainErrorCode =
  | 'investigation.uut_mismatch'
  | 'investigation.case_mismatch'
  | 'investigation.duplicate_observation'
  | 'investigation.invalid_description';

export type InvestigationDomainError = SdrisError<
  InvestigationDomainErrorCode,
  { readonly expected?: string; readonly actual?: string }
>;

export const MAX_DESCRIPTION_LENGTH = 2000;

export function openCase(input: {
  readonly id: InvestigationCaseId;
  readonly uut: UutRef;
  readonly openedAt: Timestamp;
}): InvestigationCase {
  return Object.freeze({ ...input, version: 1, observations: Object.freeze([]) });
}

/**
 * Records an observation. Evidence from another UUT is never attached silently: a mismatching UUT, or an
 * observation addressed to a different case, is refused and the case is returned unchanged by omission.
 */
export function recordObservation(
  investigationCase: InvestigationCase,
  observation: FailureObservation,
): Result<InvestigationCase, InvestigationDomainError> {
  if (observation.caseId !== investigationCase.id) {
    return err(
      createError({
        code: 'investigation.case_mismatch' as const,
        message: 'The observation belongs to a different case.',
        details: { expected: investigationCase.id, actual: observation.caseId },
      }),
    );
  }
  if (
    observation.uut.entityType !== investigationCase.uut.entityType ||
    observation.uut.id !== investigationCase.uut.id
  ) {
    return err(
      createError({
        code: 'investigation.uut_mismatch' as const,
        message: 'The observation was made on a different UUT than the case; it was not attached.',
        details: { expected: investigationCase.uut.id, actual: observation.uut.id },
      }),
    );
  }
  const description = observation.description.trim();
  if (description === '' || description.length > MAX_DESCRIPTION_LENGTH) {
    return err(
      createError({
        code: 'investigation.invalid_description' as const,
        message: `The description must be 1 to ${MAX_DESCRIPTION_LENGTH} characters.`,
      }),
    );
  }
  if (investigationCase.observations.some((existing) => existing.id === observation.id)) {
    return err(
      createError({
        code: 'investigation.duplicate_observation' as const,
        message: 'An observation with this id is already recorded on the case.',
        details: { actual: observation.id },
      }),
    );
  }
  return ok(
    Object.freeze({
      ...investigationCase,
      observations: Object.freeze([
        ...investigationCase.observations,
        Object.freeze({ ...observation, description }),
      ]),
    }),
  );
}
