import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityRef,
  createRevisionRef,
  parseRevision,
  parseRevisionRef,
  revisionEquals,
  revisionRefEquals,
  type RevisionRef,
} from './index';
import { UUID_A, uutId } from './test-support';

function target() {
  const ref = createEntityRef('UUT', uutId());
  if (!ref.ok) throw new Error('expected ok');
  return ref.value;
}

test('parseRevision accepts sequence and label schemes', () => {
  assert.deepEqual(parseRevision({ scheme: 'sequence', value: 3 }), {
    ok: true,
    value: { scheme: 'sequence', value: 3 },
  });
  for (const label of ['A02', 'v1.2.3', '2.0.0-rc.1', '1.0.0+build.5', 'rev_7']) {
    assert.equal(parseRevision({ scheme: 'label', value: label }).ok, true, label);
  }
});

test('parseRevision rejects invalid revisions', () => {
  const cases: unknown[] = [
    null,
    'v1',
    {},
    { scheme: 'unknown', value: 1 },
    { scheme: 'sequence', value: 0 },
    { scheme: 'sequence', value: -1 },
    { scheme: 'sequence', value: 1.5 },
    { scheme: 'sequence', value: Number.MAX_SAFE_INTEGER + 1 },
    { scheme: 'sequence', value: '1' },
    { scheme: 'sequence' },
    { scheme: 'label', value: '' },
    { scheme: 'label', value: ' v1' },
    { scheme: 'label', value: 'has space' },
    { scheme: 'label', value: 'x'.repeat(65) },
    { scheme: 'label', value: 5 },
  ];
  for (const input of cases) {
    const result = parseRevision(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.equal(result.error.code, 'shared_kernel.invalid_revision');
  }
});

test('createRevisionRef builds an immutable reference to a target revision', () => {
  const result = createRevisionRef(target(), { scheme: 'sequence', value: 2 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ref: RevisionRef<'UUT'> = result.value;
  assert.equal(ref.target.id, UUID_A);
  assert.deepEqual(ref.revision, { scheme: 'sequence', value: 2 });
  assert.ok(Object.isFrozen(ref));
  assert.ok(Object.isFrozen(ref.target));
  assert.ok(Object.isFrozen(ref.revision));
  assert.throws(() => {
    (ref.revision as { value: number }).value = 9;
  }, TypeError);
});

test('createRevisionRef does not alias a mutable input revision', () => {
  const input = { scheme: 'sequence' as const, value: 1 };
  const result = createRevisionRef(target(), input);
  assert.equal(result.ok, true);
  (input as { value: number }).value = 99;
  if (result.ok) assert.deepEqual(result.value.revision, { scheme: 'sequence', value: 1 });
});

test('createRevisionRef rejects an invalid revision', () => {
  const result = createRevisionRef(target(), { scheme: 'sequence', value: 0 });
  assert.equal(result.ok, false);
});

test('parseRevisionRef validates the whole structure and reports field paths', () => {
  const good = parseRevisionRef(
    { target: { entityType: 'UUT', id: UUID_A }, revision: { scheme: 'label', value: 'A02' } },
    'UUT',
  );
  assert.equal(good.ok, true);

  const badTarget = parseRevisionRef({ target: { entityType: 'UUT', id: 'x' }, revision: {} });
  assert.equal(badTarget.ok, false);
  if (!badTarget.ok) assert.equal(badTarget.error.details?.field, 'target.id');

  const badRevision = parseRevisionRef({
    target: { entityType: 'UUT', id: UUID_A },
    revision: { scheme: 'sequence', value: 0 },
  });
  assert.equal(badRevision.ok, false);
  if (!badRevision.ok) assert.equal(badRevision.error.details?.field, 'revision.value');

  const wrongType = parseRevisionRef(
    { target: { entityType: 'UUT', id: UUID_A }, revision: { scheme: 'sequence', value: 1 } },
    'InvestigationCase',
  );
  assert.equal(wrongType.ok, false);

  assert.equal(parseRevisionRef(null).ok, false);
});

test('equality distinguishes scheme and value', () => {
  assert.equal(
    revisionEquals({ scheme: 'sequence', value: 1 }, { scheme: 'sequence', value: 1 }),
    true,
  );
  assert.equal(
    revisionEquals({ scheme: 'sequence', value: 1 }, { scheme: 'label', value: '1' }),
    false,
  );
  const a = createRevisionRef(target(), { scheme: 'label', value: 'A' });
  const b = createRevisionRef(target(), { scheme: 'label', value: 'B' });
  if (!a.ok || !b.ok) throw new Error('expected ok');
  assert.equal(revisionRefEquals(a.value, a.value), true);
  assert.equal(revisionRefEquals(a.value, b.value), false);
});
