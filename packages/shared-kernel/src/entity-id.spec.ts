import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntityIdGenerator,
  getEntityIdTimestampMs,
  isEntityId,
  newEntityId,
  parseEntityId,
  type EntityId,
} from './index';
import { FIXED_NOW_MS, UUID_A, fixedGenerator } from './test-support';

type UutId = EntityId<'UUT'>;
type CaseId = EntityId<'InvestigationCase'>;

test('newEntityId generates valid UUIDv7 values', () => {
  for (let i = 0; i < 50; i += 1) {
    const id = newEntityId<'UUT'>();
    assert.equal(isEntityId(id), true);
    assert.equal(id[14], '7');
    assert.match(id[19] as string, /[89ab]/);
  }
});

test('newEntityId embeds the current time', () => {
  const before = Date.now();
  const id = newEntityId<'UUT'>();
  const after = Date.now();
  const ts = getEntityIdTimestampMs(id);
  assert.ok(ts >= before && ts <= after + 1);
});

test('injected clock and randomness give deterministic output', () => {
  const first = fixedGenerator().next<'UUT'>();
  const again = fixedGenerator().next<'UUT'>();
  assert.equal(first, again);
  assert.equal(getEntityIdTimestampMs(first), FIXED_NOW_MS);
  assert.equal(parseEntityId<'UUT'>(first).ok, true);
});

test('injected inputs cannot produce an invalid identifier', () => {
  for (const fill of [0x00, 0xff, 0x5a]) {
    const id = fixedGenerator(fill).next();
    assert.equal(isEntityId(id), true, id);
  }
});

test('ids from one generator are strictly increasing even when the clock is frozen or reversed', () => {
  let clock = FIXED_NOW_MS;
  const generator = createEntityIdGenerator({
    now: () => clock,
    randomBytes: (n) => new Uint8Array(n),
  });
  const ids = [generator.next(), generator.next()];
  clock -= 5_000;
  ids.push(generator.next());
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, 3);
});

test('counter overflow advances the timestamp by a millisecond, not per identifier', () => {
  const generator = fixedGenerator(0x00);
  const ids = Array.from({ length: 6000 }, () => generator.next());
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, ids.length);
  const drift = getEntityIdTimestampMs(ids[ids.length - 1] as EntityId) - FIXED_NOW_MS;
  assert.ok(drift >= 1 && drift <= 4, `drift was ${drift}ms`);
});

test('generator rejects an out-of-range clock and short random input', () => {
  const badClock = (value: number) =>
    createEntityIdGenerator({ now: () => value, randomBytes: (n) => new Uint8Array(n) });
  for (const value of [-1, 1.5, Number.NaN, 2 ** 48]) {
    assert.throws(() => badClock(value).next(), RangeError, String(value));
  }
  const short = createEntityIdGenerator({ now: () => 1, randomBytes: () => new Uint8Array(3) });
  assert.throws(() => short.next(), RangeError);
});

test('parseEntityId accepts a canonical UUIDv7', () => {
  const result = parseEntityId<'UUT'>(UUID_A);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, UUID_A);
});

test('parseEntityId rejects malformed and non-v7 identifiers', () => {
  const cases: unknown[] = [
    '',
    'not-a-uuid',
    '01890A5D-AC96-774B-BCCE-B302099A8057', // upper-case is not canonical
    '01890a5dac96774bbcceb302099a8057', // missing hyphens
    '{01890a5d-ac96-774b-bcce-b302099a8057}',
    ' 01890a5d-ac96-774b-bcce-b302099a8057',
    '550e8400-e29b-41d4-a716-446655440000', // UUIDv4
    '01890a5d-ac96-674b-bcce-b302099a8057', // UUIDv6
    '01890a5d-ac96-774b-7cce-b302099a8057', // wrong variant
    '00000000-0000-0000-0000-000000000000', // nil UUID
    '01890a5d-ac96-774b-bcce-b302099a805', // too short
    '01890a5d-ac96-774b-bcce-b302099a80577', // too long
    123,
    null,
    undefined,
    {},
  ];
  for (const input of cases) {
    const result = parseEntityId(input, 'id');
    assert.equal(result.ok, false, String(input));
    if (!result.ok) {
      assert.equal(result.error.code, 'shared_kernel.invalid_entity_id');
      assert.equal(result.error.details?.field, 'id');
    }
  }
});

test('error details never echo the rejected value', () => {
  const result = parseEntityId('secret-looking-value');
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(!JSON.stringify(result.error).includes('secret-looking-value'));
});

test('typed ids are distinct at compile time', () => {
  const uut = fixedGenerator().next<'UUT'>();
  const caseId = fixedGenerator().next<'InvestigationCase'>();
  const takesUut = (id: UutId): string => id;
  const takesCase = (id: CaseId): string => id;
  assert.equal(takesUut(uut), uut);
  assert.equal(takesCase(caseId), caseId);
  // @ts-expect-error a CaseId must not be accepted where a UutId is required
  takesUut(caseId);
  // @ts-expect-error a UutId must not be accepted where a CaseId is required
  takesCase(uut);
  // @ts-expect-error a plain string is not an EntityId
  takesUut('01890a5d-ac96-774b-bcce-b302099a8057');
  // A specific id is usable where the generic EntityId is expected.
  const generic: EntityId = uut;
  assert.equal(generic, uut);
});
