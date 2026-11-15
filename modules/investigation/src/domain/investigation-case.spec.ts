import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEntityRef, newEntityId, parseTimestamp, type Timestamp } from '@sdris/shared-kernel';
import {
  MAX_DESCRIPTION_LENGTH,
  openCase,
  recordObservation,
  type FailureObservation,
  type InvestigationCase,
  type UutRef,
} from './investigation-case';

const timestamp = (value: string): Timestamp => {
  const parsed = parseTimestamp(value);
  if (!parsed.ok) throw new Error('bad test timestamp');
  return parsed.value;
};
const uut = (): UutRef => {
  const ref = createEntityRef('UUT', newEntityId<'UUT'>());
  if (!ref.ok) throw new Error('bad test ref');
  return ref.value;
};
const newCase = (u: UutRef = uut()): InvestigationCase =>
  openCase({
    id: newEntityId<'InvestigationCase'>(),
    uut: u,
    openedAt: timestamp('2026-11-15T10:00:00.000Z'),
  });
const observation = (
  c: InvestigationCase,
  overrides: Partial<FailureObservation> = {},
): FailureObservation => ({
  id: newEntityId<'FailureObservation'>(),
  caseId: c.id,
  uut: c.uut,
  description: 'Fan 3 reports 0 RPM',
  observedAt: timestamp('2026-11-15T10:05:00.000Z'),
  ...overrides,
});

describe('Investigation aggregate', () => {
  it('opens a case at version 1 with no observations', () => {
    const c = newCase();
    assert.equal(c.version, 1);
    assert.deepEqual(c.observations, []);
    assert.ok(Object.isFrozen(c));
  });

  it('records an observation without mutating the original case', () => {
    const c = newCase();
    const result = recordObservation(c, observation(c));
    assert.ok(result.ok);
    assert.equal(result.value.observations.length, 1);
    assert.equal(c.observations.length, 0, 'the input case is unchanged');
    assert.equal(result.value.version, c.version, 'the version only changes when persisted');
  });

  it('trims the description', () => {
    const c = newCase();
    const result = recordObservation(c, observation(c, { description: '  spaced  ' }));
    assert.ok(result.ok && result.value.observations[0]!.description === 'spaced');
  });

  it('refuses evidence from another UUT and attaches nothing', () => {
    const c = newCase();
    const other = uut();
    const result = recordObservation(c, observation(c, { uut: other }));
    assert.ok(!result.ok);
    assert.equal(result.error.code, 'investigation.uut_mismatch');
    assert.equal(result.error.details?.expected, c.uut.id);
    assert.equal(result.error.details?.actual, other.id);
    assert.equal(c.observations.length, 0);
  });

  it('refuses an observation addressed to a different case', () => {
    const c = newCase();
    const result = recordObservation(
      c,
      observation(c, { caseId: newEntityId<'InvestigationCase'>() }),
    );
    assert.ok(!result.ok && result.error.code === 'investigation.case_mismatch');
  });

  it('refuses empty, blank and over-long descriptions', () => {
    const c = newCase();
    for (const description of ['', '   ', 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1)]) {
      const result = recordObservation(c, observation(c, { description }));
      assert.ok(
        !result.ok && result.error.code === 'investigation.invalid_description',
        description.slice(0, 10),
      );
    }
    assert.ok(
      recordObservation(c, observation(c, { description: 'x'.repeat(MAX_DESCRIPTION_LENGTH) })).ok,
    );
  });

  it('refuses a duplicate observation id', () => {
    const c = newCase();
    const first = observation(c);
    const once = recordObservation(c, first);
    assert.ok(once.ok);
    const twice = recordObservation(once.value, first);
    assert.ok(!twice.ok && twice.error.code === 'investigation.duplicate_observation');
  });
});
