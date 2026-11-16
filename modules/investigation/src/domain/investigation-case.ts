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
export type { UutRef } from './uut';

/** The roles a link may have, in the order they are returned (Owner decisions Q5 and Q9). */
export const LINK_ROLES = ['INITIAL_FAILURE', 'RETEST', 'SUPPORTING', 'CONTEXT'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/**
 * Association between one case and one attempt of the same UUT. Identified by (case, attempt, role); the role
 * is immutable, so changing a role means creating another link. Never inferred automatically.
 */
export interface NewCaseTestAttemptLink {
  readonly caseId: InvestigationCaseId;
  readonly attemptId: TestAttemptId;
  /** The UUT both sides belong to. */
  readonly uut: UutRef;
  readonly role: LinkRole;
}

/** A stored link. */
export interface CaseTestAttemptLink extends NewCaseTestAttemptLink {
  /** When SDRIS recorded the link (database clock, UTC). */
  readonly linkedAt: Timestamp;
}

/** A case that has not been stored yet. PostgreSQL generates `opened_at` on insert. */
export interface NewInvestigationCase {
  readonly id: InvestigationCaseId;
  readonly uut: UutRef;
}

/** A stored case, as loaded: its version and its links belong to one database snapshot. */
export interface InvestigationCase extends NewInvestigationCase {
  /** When SDRIS opened the investigation (database clock, UTC). */
  readonly openedAt: Timestamp;
  /** The persisted version this state was loaded at (1 for a newly opened case). */
  readonly version: number;
  /** In retrieval order (registered_at, attempt id, role). */
  readonly links: readonly CaseTestAttemptLink[];
}

export type InvestigationDomainErrorCode =
  'investigation.uut_mismatch' | 'investigation.invalid_link_role';

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
}): NewInvestigationCase {
  return Object.freeze({ id: input.id, uut: input.uut });
}

/**
 * The result of a link request: either the existing identical link (nothing to write, the version must not advance)
 * or the new link to store. A new link has no timestamp yet: PostgreSQL generates `linked_at` when it is stored.
 */
export type LinkOutcome =
  | { readonly created: false; readonly link: CaseTestAttemptLink }
  | { readonly created: true; readonly link: NewCaseTestAttemptLink };

/**
 * Decides how to link an attempt to the case. A mismatch between the UUT of the case and the UUT of the attempt is
 * refused and nothing is attached. An identical link (same attempt and role) is idempotent: the existing link, with
 * its original `linkedAt`, is returned and nothing is overwritten. The same attempt with another role is a different
 * link. Persisting the new link and advancing the case version is the repository's single atomic step.
 */
export function linkTestAttempt(
  investigationCase: InvestigationCase,
  attempt: Pick<TestAttempt, 'id' | 'uut'>,
  role: LinkRole,
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
  if (existing) return ok({ created: false, link: existing });
  return ok({
    created: true,
    link: Object.freeze({
      caseId: investigationCase.id,
      attemptId: attempt.id,
      uut: investigationCase.uut,
      role,
    }),
  });
}
