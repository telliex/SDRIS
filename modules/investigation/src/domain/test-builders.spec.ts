import { createEntityRef, newEntityId, parseTimestamp, type Timestamp } from '@sdris/shared-kernel';
import type {
  CaseTestAttemptLink,
  InvestigationCase,
  NewCaseTestAttemptLink,
} from './investigation-case';
import type { TestAttempt, TestStage } from './test-attempt';
import type { UutRef } from './uut';

/**
 * Synthetic builders shared by domain and application unit tests. Not exported from the package. Timestamps are
 * fixed literals standing in for what PostgreSQL would generate; production code never supplies them.
 */
export const timestamp = (value: string): Timestamp => {
  const parsed = parseTimestamp(value);
  if (!parsed.ok) throw new Error('bad test timestamp');
  return parsed.value;
};

export const uutRef = (): UutRef => {
  const ref = createEntityRef('UUT', newEntityId<'UUT'>());
  if (!ref.ok) throw new Error('bad test ref');
  return ref.value;
};

/** A stored case, as the repository would return it. */
export const newCase = (uut: UutRef = uutRef()): InvestigationCase =>
  Object.freeze({
    id: newEntityId<'InvestigationCase'>(),
    uut,
    openedAt: timestamp('2026-11-15T10:00:00.000Z'),
    version: 1,
    links: Object.freeze([]),
  });

/** A stored attempt, as the repository would return it. */
export const newAttempt = (
  uut: UutRef,
  stage: TestStage = 'IST',
  registeredAt = '2026-11-15T09:00:00.000Z',
): TestAttempt => ({
  id: newEntityId<'TestAttempt'>(),
  uut,
  stage,
  registeredAt: timestamp(registeredAt),
});

/** The case as it would be after the repository stored `link` and advanced the version. */
export const afterStoring = (
  current: InvestigationCase,
  link: NewCaseTestAttemptLink,
  linkedAt = '2026-11-15T10:30:00.000Z',
): InvestigationCase => {
  const stored: CaseTestAttemptLink = { ...link, linkedAt: timestamp(linkedAt) };
  return {
    ...current,
    version: current.version + 1,
    links: Object.freeze([...current.links, stored]),
  };
};
