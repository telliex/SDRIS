import { assertDisposableLocalTarget } from '@sdris/database';
import { SyntheticIdentityForbiddenError } from './errors';

/**
 * The environment the identity module trusts (specification 3.2). Only `readTrustedEnvironment` creates one and it
 * is recorded in a module-private set, so an object that merely looks like one (a plain object, a copy, a cast) is
 * not trusted: the issuer and `composeInvestigation` check membership at runtime, not only the compile-time type.
 */
declare const trustedEnvironmentBrand: unique symbol;
export interface TrustedEnvironment {
  readonly [trustedEnvironmentBrand]: 'trusted-environment';
  /** `SDRIS_ENV` exactly as read (not trimmed, not case-folded); `undefined` when unset. */
  readonly sdrisEnv: string | undefined;
  /** `NODE_ENV` exactly as read; `undefined` when unset. */
  readonly nodeEnv: string | undefined;
}

const genuine = new WeakSet<object>();

/**
 * The one place that reads the process environment. It reads the two variables once and returns a frozen,
 * registered value. Tests may pass an environment record explicitly; production code passes nothing.
 */
export function readTrustedEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TrustedEnvironment {
  const value = Object.freeze({
    sdrisEnv: env.SDRIS_ENV,
    nodeEnv: env.NODE_ENV,
  }) as unknown as TrustedEnvironment;
  genuine.add(value);
  return value;
}

export function isTrustedEnvironment(value: unknown): value is TrustedEnvironment {
  return typeof value === 'object' && value !== null && genuine.has(value);
}

/**
 * Fail closed on a positive match: the synthetic issuer is permitted only if `SDRIS_ENV` is exactly `local` or
 * `test` and `NODE_ENV` is not `production`. A missing, empty, misspelt (`prod`, `Test`) or conflicting value is
 * refused; a negative check alone would pass when a variable is unset. Throws `SyntheticIdentityForbiddenError`.
 */
export function assertSyntheticIdentityAllowed(environment: unknown): TrustedEnvironment {
  if (!isTrustedEnvironment(environment)) throw new SyntheticIdentityForbiddenError();
  if (environment.sdrisEnv !== 'local' && environment.sdrisEnv !== 'test') {
    throw new SyntheticIdentityForbiddenError();
  }
  // Stricter than "exactly production" on purpose: spelling variants of production are refused too.
  if (environment.nodeEnv?.trim().toLowerCase() === 'production') {
    throw new SyntheticIdentityForbiddenError();
  }
  return environment;
}

/**
 * The database target must also be a disposable local one (`assertDisposableLocalTarget`). A missing target is a
 * refusal. The unsafe-target error of the database package is translated, so no URL or reason text escapes.
 */
export function assertDisposableDatabaseTarget(
  environment: TrustedEnvironment,
  databaseUrl: unknown,
): void {
  if (typeof databaseUrl !== 'string' || databaseUrl === '') {
    throw new SyntheticIdentityForbiddenError();
  }
  try {
    assertDisposableLocalTarget(databaseUrl, 'use the synthetic identity issuer', {
      NODE_ENV: environment.nodeEnv,
    });
  } catch {
    throw new SyntheticIdentityForbiddenError();
  }
}
