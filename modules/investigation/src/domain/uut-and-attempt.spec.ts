import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newEntityId } from '@sdris/shared-kernel';
import { parseTestStage, registerTestAttempt, TEST_STAGES } from './test-attempt';
import { createUut } from './uut';
import { uutRef } from './test-builders.spec';

describe('UUT', () => {
  it('has an internal UUIDv7 identity and optional external attributes', () => {
    const bare = createUut({
      id: newEntityId<'UUT'>(),
    });
    assert.equal(bare.serialNumber, undefined);
    assert.equal(bare.hostname, undefined);
    assert.ok(Object.isFrozen(bare));
  });

  it('stores serial number and hostname exactly as supplied: no trimming, case change or normalisation', () => {
    for (const value of ['  SN-001  ', 'sn-001', 'SN-001', '', 'host\tname', 'ＳＮ１']) {
      const uut = createUut({
        id: newEntityId<'UUT'>(),
        serialNumber: value,
        hostname: value,
      });
      assert.equal(uut.serialNumber, value);
      assert.equal(uut.hostname, value);
    }
  });

  it('does not treat an external attribute as identity: two UUTs may share a serial number', () => {
    const a = createUut({
      id: newEntityId<'UUT'>(),
      serialNumber: 'SN-1',
    });
    const b = createUut({
      id: newEntityId<'UUT'>(),
      serialNumber: 'SN-1',
    });
    assert.notEqual(a.id, b.id);
    assert.equal(a.serialNumber, b.serialNumber);
  });
});

describe('TestAttempt', () => {
  it('accepts exactly the controlled vocabulary IST and SAT', () => {
    assert.deepEqual([...TEST_STAGES], ['IST', 'SAT']);
    for (const stage of TEST_STAGES) {
      const parsed = parseTestStage(stage);
      assert.ok(parsed.ok && parsed.value === stage);
    }
  });

  it('rejects anything outside the vocabulary, with no case folding or trimming', () => {
    for (const bad of ['ist', 'Sat', ' IST', 'SAT ', 'FCT', '', undefined, null, 1]) {
      const parsed = parseTestStage(bad);
      assert.ok(
        !parsed.ok && parsed.error.code === 'investigation.invalid_test_stage',
        String(bad),
      );
    }
  });

  it('references one UUT and keeps the external execution reference optional and separate from its id', () => {
    const uut = uutRef();
    const withRef = registerTestAttempt({
      id: newEntityId<'TestAttempt'>(),
      uut,
      stage: 'SAT',
      externalExecutionReference: '  run-77 ',
    });
    assert.equal(withRef.uut.id, uut.id);
    assert.equal(withRef.externalExecutionReference, '  run-77 ');
    assert.notEqual(withRef.externalExecutionReference, withRef.id);
    const without = registerTestAttempt({
      id: newEntityId<'TestAttempt'>(),
      uut,
      stage: 'IST',
    });
    assert.equal(without.externalExecutionReference, undefined);
  });

  it('allows several attempts to share an external execution reference (not unique) and has no result field', () => {
    const uut = uutRef();
    const make = () =>
      registerTestAttempt({
        id: newEntityId<'TestAttempt'>(),
        uut,
        stage: 'IST',
        externalExecutionReference: 'same',
      });
    const [a, b] = [make(), make()];
    assert.equal(a.externalExecutionReference, b.externalExecutionReference);
    assert.ok(!('result' in a) && !('passed' in a) && !('status' in a));
    assert.ok(Object.isFrozen(a));
  });
});
