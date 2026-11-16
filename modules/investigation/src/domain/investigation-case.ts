import {
  createError,
  err,
  ok,
  type EntityId,
  type Result,
  type SdrisError,
  type Timestamp,
} from '@sdris/shared-kernel';
import type { TestAttempt, TestAttemptId } from './test-attempt';
import type { UutRef } from './uut';

/**
 * The InvestigationCase aggregate (Owner decisions Q5 to Q7).
 *
 * The case is the aggregate root and owns its CaseTestAttemptLinks. Content is exactly: identity, UUT reference,
 * `openedAt`, version and links. There is no status, no lifecycle, no description and no content limit. A case
 * never closes because a test passed, and a RETEST link records a relationship only: it establishes neither
 * repair effectiveness nor an RCA conclusion.
 */
export type InvestigationCaseId = EntityId<'InvestigationCase'>;
/** TRANSITIONAL: removed once the link-based tests replace the observation-based ones (Owner decision Q8). */
export type FailureObservationId = EntityId<'FailureObservation'>;
export type { UutRef } from './uut';

/** The roles a link may have, in the order they are returned (Owner decisions Q5 and Q9). */
export const LINK_ROLES = ['INITIAL_FAILURE', 'RETEST', 'SUPPORTING', 'CONTEXT'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/**
 * Association between one case and one attempt of the same UUT. Identified by (case, attempt, role); the role
 * is immutable, so changing a role means creating another link. Never inferred automatically.
 */
export interface CaseTestAttemptLink {
  readonly caseId: InvestigationCaseId;
  readonly attemptId: TestAttemptId;
  /** The UUT both sides belong to. */
  readonly uut: UutRef;
  readonly role: LinkRole;
  /** When SDRIS recorded the link. */
  readonly linkedAt: Timestamp;
}

/** TRANSITIONAL (Q8): deferred by the specification; removed in this PR after the replacement tests exist. */
export interface FailureObservation {
  readonly id: FailureObservationId;
  readonly caseId: InvestigationCaseId;
  readonly uut: UutRef;
  readonly description: string;
  readonly observedAt: Timestamp;
}

export interface InvestigationCase {
  readonly id: InvestigationCaseId;
  readonly uut: UutRef;
  /** When SDRIS opened the investigation. */
  readonly openedAt: Timestamp;
  /** The persisted version this state was loaded at (1 for a newly opened case). */
  readonly version: number;
  /** In retrieval order (registered_at, attempt id, role) when loaded; a newly added link is appended. */
  readonly links: readonly CaseTestAttemptLink[];
  /** TRANSITIONAL (Q8). */
  readonly observations: readonly FailureObservation[];
}

export type InvestigationDomainErrorCode =
  | 'investigation.uut_mismatch'
  | 'investigation.invalid_link_role'
  | 'investigation.case_mismatch'
  | 'investigation.duplicate_observation';

export type InvestigationDomainError = SdrisError<
  InvestigationDomainErrorCode,
  { readonly expected?: string; readonly actual?: string }
>;

/** Exact match only: roles are never inferred, normalised or defaulted. */
export function parseLinkRole(value: unknown): Result<LinkRole, InvestigationDomainError> {
  if (typeof value === 'string' && (LINK_ROLES as readonly string[]).includes(value)) {
    return ok(value as LinkRole);
  }
  return err(
    createError({
      code: 'investigation.invalid_link_role' as const,
      message: `The link role must be one of ${LINK_ROLES.join(', ')}.`,
      details: { actual: typeof value === 'string' ? value : typeof value },
    }),
  );
}

export function openCase(input: {
  readonly id: InvestigationCaseId;
  readonly uut: UutRef;
  readonly openedAt: Timestamp;
}): InvestigationCase {
  return Object.freeze({
    ...input,
    version: 1,
    links: Object.freeze([]),
    observations: Object.freeze([]),
  });
}

export interface LinkOutcome {
  /** The case with the link present. The very same instance when the request was a duplicate. */
  readonly investigationCase: InvestigationCase;
  readonly link: CaseTestAttemptLink;
  /** False for an identical repeat: nothing changes and the version must not advance. */
  readonly created: boolean;
}

/**
 * Links an attempt to the case. A mismatch between the UUT of the case and the UUT of the attempt is refused and
 * nothing is attached. An identical link (same attempt and role) is idempotent: the existing link, with its original
 * `linkedAt`, is returned and nothing is overwritten. The same attempt with another role is a different link.
 */
export function linkTestAttempt(
  investigationCase: InvestigationCase,
  attempt: TestAttempt,
  role: LinkRole,
  linkedAt: Timestamp,
): Result<LinkOutcome, InvestigationDomainError> {
  if (
    attempt.uut.entityType !== investigationCase.uut.entityType ||
    attempt.uut.id !== investigationCase.uut.id
  ) {
    return err(
      createError({
        code: 'investigation.uut_mismatch' as const,
        message: 'The attempt belongs to a different UUT than the case; it was not linked.',
        details: { expected: investigationCase.uut.id, actual: attempt.uut.id },
      }),
    );
  }
  const existing = investigationCase.links.find(
    (candidate) => candidate.attemptId === attempt.id && candidate.role === role,
  );
  if (existing) {
    return ok({ investigationCase, link: existing, created: false });
  }
  const link: CaseTestAttemptLink = Object.freeze({
    caseId: investigationCase.id,
    attemptId: attempt.id,
    uut: investigationCase.uut,
    role,
    linkedAt,
  });
  return ok({
    investigationCase: Object.freeze({
      ...investigationCase,
      links: Object.freeze([...investigationCase.links, link]),
    }),
    link,
    created: true,
  });
}

/** TRANSITIONAL (Q8): the previous write operation, kept only until the link-based tests replace its proofs. */
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
        Object.freeze({ ...observation }),
      ]),
    }),
  );
}
