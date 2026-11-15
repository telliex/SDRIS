import test from 'node:test';
import assert from 'node:assert/strict';
import { isTimestamp, parseTimestamp, timestampFromDate, timestampToDate } from './index';
import { FIXED_NOW_MS, FIXED_TIMESTAMP } from './test-support';

test('accepts strict UTC ISO-8601 timestamps', () => {
  for (const good of [
    '2026-11-14T10:00:00Z',
    '2026-11-14T10:00:00.123Z',
    '2024-02-29T23:59:59.999Z', // leap day
    '0001-01-01T00:00:00Z',
  ]) {
    assert.equal(isTimestamp(good), true, good);
  }
});

test('rejects malformed, offset, non-UTC and calendar-invalid timestamps', () => {
  const cases: unknown[] = [
    '',
    'not a date',
    '2026-11-14',
    '2026-11-14T10:00:00',
    '2026-11-14T10:00:00+00:00',
    '2026-11-14T10:00:00+08:00',
    '2026-11-14 10:00:00Z',
    '2026-11-14T10:00:00.1Z',
    '2026-11-14T10:00:00.123456Z',
    '2026-02-30T10:00:00Z',
    '2025-02-29T10:00:00Z', // not a leap year
    '2026-13-01T00:00:00Z',
    '2026-11-14T24:00:00Z',
    '2026-11-14T10:60:00Z',
    '2026-11-14T10:00:60Z',
    1_700_000_000_000,
    null,
    undefined,
  ];
  for (const input of cases) {
    const result = parseTimestamp(input, 'occurredAt');
    assert.equal(result.ok, false, String(input));
    if (!result.ok) {
      assert.equal(result.error.code, 'shared_kernel.invalid_timestamp');
      assert.equal(result.error.details?.field, 'occurredAt');
    }
  }
});

test('timestampFromDate and timestampToDate round-trip', () => {
  const result = timestampFromDate(new Date(FIXED_NOW_MS));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, FIXED_TIMESTAMP);
    assert.equal(timestampToDate(result.value).getTime(), FIXED_NOW_MS);
  }
});

test('timestampFromDate rejects invalid dates and years outside 0000-9999', () => {
  assert.equal(timestampFromDate(new Date(Number.NaN)).ok, false);
  assert.equal(timestampFromDate(new Date('+275760-09-13T00:00:00Z')).ok, false);
  assert.equal(timestampFromDate('2026-01-01' as unknown as Date).ok, false);
});
