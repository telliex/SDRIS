import { err, ok, type Result } from './result';
import { kernelError, type KernelError } from './kernel-error';

declare const correlationIdBrand: unique symbol;

/**
 * Opaque identifier that ties together work belonging to one request or flow. It is deliberately
 * not an EntityId: it may originate outside SDRIS (e.g. a propagated trace id).
 */
export type CorrelationId = string & { readonly [correlationIdBrand]: true };

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function parseCorrelationId(
  value: unknown,
  field?: string,
): Result<CorrelationId, KernelError> {
  if (typeof value !== 'string' || !CORRELATION_ID_PATTERN.test(value)) {
    return err(
      kernelError(
        'shared_kernel.invalid_correlation_id',
        'must be 1-128 characters of [A-Za-z0-9._:-] starting with an alphanumeric',
        field,
      ),
    );
  }
  return ok(value as CorrelationId);
}
