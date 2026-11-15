import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityRef,
  entityRefEquals,
  parseEntityRef,
  type EntityId,
  type EntityRef,
} from './index';
import { UUID_A, UUID_B, caseId, uutId } from './test-support';

test('createEntityRef builds a frozen typed reference', () => {
  const result = createEntityRef('UUT', uutId());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { entityType: 'UUT', id: UUID_A });
    assert.ok(Object.isFrozen(result.value));
  }
});

test('typed references infer their entity type and reject mixed identities', () => {
  const result = createEntityRef('UUT', uutId());
  if (!result.ok) throw new Error('expected ok');
  const ref: EntityRef<'UUT'> = result.value;
  const literal: 'UUT' = ref.entityType;
  assert.equal(literal, 'UUT');
  // @ts-expect-error a UUT reference is not an InvestigationCase reference
  const wrong: EntityRef<'InvestigationCase'> = ref;
  void wrong;
  // @ts-expect-error the id must be branded with the same entity type as the reference
  createEntityRef('UUT', caseId());
  // @ts-expect-error a bare string is not a valid id
  createEntityRef('UUT', UUID_A);
});

test('createEntityRef rejects malformed entity types and ids that were cast', () => {
  for (const type of ['', '1UUT', 'has space', 'a-b', 'x'.repeat(65)]) {
    const result = createEntityRef(type, uutId() as unknown as EntityId<string>);
    assert.equal(result.ok, false, type);
    if (!result.ok) assert.equal(result.error.code, 'shared_kernel.invalid_entity_type');
  }
  const result = createEntityRef('UUT', 'nope' as EntityId<'UUT'>);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'shared_kernel.invalid_entity_id');
});

test('parseEntityRef validates untrusted input', () => {
  const good = parseEntityRef({ entityType: 'UUT', id: UUID_A });
  assert.equal(good.ok, true);
  const typed = parseEntityRef({ entityType: 'UUT', id: UUID_A }, 'UUT');
  assert.equal(typed.ok, true);
  if (typed.ok) {
    const ref: EntityRef<'UUT'> = typed.value;
    assert.equal(ref.id, UUID_A);
  }
});

test('parseEntityRef rejects non-objects, wrong types, and malformed ids', () => {
  const cases: [unknown, string | undefined][] = [
    [null, undefined],
    ['UUT', undefined],
    [[], undefined],
    [{}, undefined],
    [{ entityType: 'UUT' }, undefined],
    [{ id: UUID_A }, undefined],
    [{ entityType: 'UUT', id: 'bad' }, undefined],
    [{ entityType: 'UUT', id: UUID_A }, 'InvestigationCase'],
  ];
  for (const [input, expected] of cases) {
    const result = expected === undefined ? parseEntityRef(input) : parseEntityRef(input, expected);
    assert.equal(result.ok, false, JSON.stringify(input));
  }
});

test('parseEntityRef reports the failing field path', () => {
  const result = parseEntityRef({ entityType: 'UUT', id: 'bad' }, undefined, 'aggregate');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.details?.field, 'aggregate.id');
});

test('entityRefEquals compares type and id', () => {
  const a = createEntityRef('UUT', uutId());
  const b = createEntityRef('UUT', uutId());
  const c = createEntityRef('InvestigationCase', caseId());
  if (!a.ok || !b.ok || !c.ok) throw new Error('expected ok');
  assert.equal(entityRefEquals(a.value, b.value), true);
  assert.equal(entityRefEquals(a.value, c.value), false);
  assert.notEqual(UUID_A, UUID_B);
});

test('parseEntityRef without expectedType returns a general EntityRef', () => {
  const result = parseEntityRef({ entityType: 'InvestigationCase', id: UUID_B });
  assert.equal(result.ok, true);
  if (result.ok) {
    const ref: EntityRef = result.value;
    assert.equal(ref.entityType, 'InvestigationCase');
    // @ts-expect-error the type is only `string`, so it cannot be assumed to be 'UUT'
    const kind: 'UUT' = ref.entityType;
    void kind;
  }
});

test('parseEntityRef cannot claim a type without a runtime check', () => {
  // @ts-expect-error a type argument alone is erased at runtime; pass expectedType instead
  parseEntityRef<'UUT'>({ entityType: 'InvestigationCase', id: UUID_B });
});

test('parseEntityRef rejects a runtime entityType that contradicts expectedType', () => {
  const result = parseEntityRef({ entityType: 'InvestigationCase', id: UUID_B }, 'UUT');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'shared_kernel.invalid_entity_ref');
    assert.equal(result.error.details?.field, 'entityType');
  }
});
