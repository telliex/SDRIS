import type { EntityRef } from '@sdris/shared-kernel';

/**
 * The opaque, issuer-verified handle for a trusted actor (S0-06 specification 2.2). It has no members: the
 * claims behind it live in a private registry of the issuer that created it, so a caller cannot read, alter or
 * forge them. At runtime a handle is a frozen empty object that the issuer registered; anything else passed in its
 * place (a plain object with `permissions`, a copy, a handle of another issuer, `null`) is not in the registry and
 * is refused. The brand below is compile-time only and is **not** the trust decision.
 */
declare const actorHandleBrand: unique symbol;
export interface ActorHandle {
  readonly [actorHandleBrand]: 'actor-handle';
}

/** What a resolver returns for a valid handle: a fresh, deep-frozen copy of the issuer's canonical claims. */
export interface VerifiedActor {
  readonly actor: EntityRef<'Actor'>;
  readonly actorKind: 'HUMAN' | 'SYSTEM';
  readonly permissions: readonly string[];
}

/**
 * The typed outcome of resolving a handle (specification 2.4), never a boolean, so the cause of a failure is kept
 * for the Security Log and hidden from the caller. `invalid` covers a forged object, a plain object, a wrong type
 * and a handle issued by another issuer, which are indistinguishable by design.
 */
export type ActorResolution =
  | { readonly status: 'valid'; readonly actor: VerifiedActor }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | { readonly status: 'expired' }
  | { readonly status: 'revoked' };

/**
 * Internal port: Investigation never verifies credentials, it asks the injected resolver. Implemented by the
 * issuer of the application composition root; it is deliberately not part of `src/public`.
 */
export interface ActorResolver {
  resolve(handle: unknown): ActorResolution;
}
