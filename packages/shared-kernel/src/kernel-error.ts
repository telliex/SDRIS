import { createError, type SdrisError } from './error';

/** Technical validation failures raised by the Shared Kernel itself (not business errors). */
export type KernelErrorCode =
  | 'shared_kernel.invalid_entity_id'
  | 'shared_kernel.invalid_entity_type'
  | 'shared_kernel.invalid_entity_ref'
  | 'shared_kernel.invalid_revision'
  | 'shared_kernel.invalid_timestamp'
  | 'shared_kernel.invalid_correlation_id'
  | 'shared_kernel.invalid_metadata';

export interface KernelErrorDetails {
  /** Dotted path of the offending field, when known. */
  readonly field?: string;
  /** Short explanation. Never echoes the rejected value. */
  readonly reason: string;
}

export type KernelError = SdrisError<KernelErrorCode, KernelErrorDetails>;

/** @internal Not exported from the package entry point. */
export function kernelError(code: KernelErrorCode, reason: string, field?: string): KernelError {
  return createError({
    code,
    message: field === undefined ? reason : `${field}: ${reason}`,
    details: field === undefined ? { reason } : { field, reason },
  });
}

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
