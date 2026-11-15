import type { SdrisError } from './error';

/** Successful outcome carrying a value. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failed outcome carrying an error. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Discriminated success/failure union. Narrow on the `ok` property. */
export type Result<T, E = SdrisError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false as const, error });
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
