import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRetryableTransactionFailure,
  isUniqueViolation,
  pgErrorCode,
} from './persistence-errors';

describe('persistence error classification', () => {
  it('finds SQLSTATE on the error or its cause chain', () => {
    assert.equal(pgErrorCode({ code: '23505' }), '23505');
    assert.equal(pgErrorCode(new Error('wrapped', { cause: { code: '40001' } })), '40001');
  });
  it('ignores non-SQLSTATE codes and non-errors', () => {
    assert.equal(pgErrorCode({ code: 'ECONNREFUSED' }), undefined);
    assert.equal(pgErrorCode(undefined), undefined);
    assert.equal(pgErrorCode('23505'), undefined);
  });
  it('distinguishes unique violations and retryable failures', () => {
    assert.ok(isUniqueViolation({ code: '23505' }));
    assert.ok(!isUniqueViolation({ code: '23503' }));
    assert.ok(isRetryableTransactionFailure({ code: '40001' }));
    assert.ok(isRetryableTransactionFailure({ code: '40P01' }));
    assert.ok(!isRetryableTransactionFailure({ code: '23505' }));
  });
});
