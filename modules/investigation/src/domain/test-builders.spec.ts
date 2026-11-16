import { createEntityRef, newEntityId, parseTimestamp, type Timestamp } from '@sdris/shared-kernel';
import { openCase, type InvestigationCase } from './investigation-case';
import { registerTestAttempt, type TestAttempt, type TestStage } from './test-attempt';
import type { UutRef } from './uut';

/** Synthetic builders shared by domain and application unit tests. Not exported from the package. */
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

export const newCase = (uut: UutRef = uutRef()): InvestigationCase =>
  openCase({
    id: newEntityId<'InvestigationCase'>(),
    uut,
    openedAt: timestamp('2026-11-15T10:00:00.000Z'),
  });

export const newAttempt = (
  uut: UutRef,
  stage: TestStage = 'IST',
  registeredAt = '2026-11-15T09:00:00.000Z',
): TestAttempt =>
  registerTestAttempt({
    id: newEntityId<'TestAttempt'>(),
    uut,
    stage,
    registeredAt: timestamp(registeredAt),
  });
