import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createError,
  err,
  isErr,
  isErrorCode,
  isOk,
  ok,
  type Result,
  type SdrisError,
} from './index';
import { parseCorrelationId } from './index';

function divide(a: number, b: number): Result<number, SdrisError<'math.division_by_zero'>> {
  return b === 0
    ? err(createError({ code: 'math.division_by_zero', message: 'Cannot divide by zero' }))
    : ok(a / b);
}

test('Result discriminates success and failure', () => {
  const success = divide(6, 3);
  const failure = divide(1, 0);
  assert.equal(success.ok, true);
  assert.equal(failure.ok, false);
  assert.ok(isOk(success) && !isErr(success));
  assert.ok(isErr(failure) && !isOk(failure));
  if (success.ok) assert.equal(success.value, 2);
  if (!failure.ok) assert.equal(failure.error.code, 'math.division_by_zero');
});

test('Result narrowing is enforced at compile time', () => {
  const result = divide(1, 1);
  // @ts-expect-error `value` does not exist until `ok` has been checked
  void result.value;
  // @ts-expect-error `error` does not exist until `ok` has been checked
  void result.error;
});

test('Result values are frozen', () => {
  assert.ok(Object.isFrozen(ok(1)));
  assert.ok(Object.isFrozen(err('x')));
});

test('createError builds a frozen error with optional details and correlation id', () => {
  const correlation = parseCorrelationId('req-123');
  assert.ok(correlation.ok);
  const error = createError({
    code: 'evidence.artifact_missing',
    message: 'Artifact not found',
    details: { artifact: 'synthetic-1' },
    correlationId: correlation.ok ? correlation.value : undefined,
  });
  assert.equal(error.code, 'evidence.artifact_missing');
  assert.equal(error.message, 'Artifact not found');
  assert.deepEqual(error.details, { artifact: 'synthetic-1' });
  assert.equal(error.correlationId, 'req-123');
  assert.ok(Object.isFrozen(error));
});

test('createError omits absent optional fields', () => {
  const error = createError({ code: 'a.b', message: 'm' });
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message']);
});

test('createError rejects malformed codes and empty messages', () => {
  assert.throws(() => createError({ code: 'Bad Code', message: 'm' }), RangeError);
  assert.throws(() => createError({ code: '', message: 'm' }), RangeError);
  assert.throws(() => createError({ code: 'ok.code', message: '  ' }), RangeError);
});

test('isErrorCode accepts dotted snake_case and rejects everything else', () => {
  for (const good of ['a', 'a.b', 'shared_kernel.invalid_entity_id', 'x1.y2_z']) {
    assert.equal(isErrorCode(good), true, good);
  }
  for (const bad of ['', 'A.b', '1a', 'a..b', 'a.', '.a', 'a b', 'a-b', 7, null]) {
    assert.equal(isErrorCode(bad), false, String(bad));
  }
});

test('parseCorrelationId validates shape', () => {
  assert.ok(parseCorrelationId('abc-123_DEF.x:y').ok);
  for (const bad of ['', ' ', '-leading', 'a'.repeat(129), 'has space', 42, null, undefined]) {
    const result = parseCorrelationId(bad);
    assert.equal(result.ok, false, String(bad));
    if (!result.ok) assert.equal(result.error.code, 'shared_kernel.invalid_correlation_id');
  }
});
