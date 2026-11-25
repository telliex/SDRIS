import type { ActorHandle } from '@sdris/investigation';
import type {
  ActorResolution,
  ActorResolver,
  VerifiedActor,
} from '@sdris/investigation/composition';
import { isEntityId, timestampToDate, type EntityRef, type Timestamp } from '@sdris/shared-kernel';
import { SyntheticIdentityForbiddenError } from './errors';
import { isPermission, type Permission } from './permissions';
import {
  createSecurityEventEmitter,
  type SecurityEventSink,
  type SinkFailureReport,
} from './security-events';
import { assertSyntheticIdentityAllowed, type TrustedEnvironment } from './trusted-environment';

/** The handle lifetime proposed in specification 2.4: 15 minutes, no renewal, no sliding window. */
export const HANDLE_TTL_MS = 15 * 60 * 1000;

/** One synthetic principal: the issuer's fixed table entry. Claims come from here, never from the caller. */
export interface SyntheticPrincipal {
  /** The key a test (or, in S0-07, the authenticated request) presents to ask for a handle. */
  readonly key: string;
  /** `EntityRef<'Actor'>` whose id is a fixed, valid UUIDv7 (specification 2.3). */
  readonly actor: EntityRef<'Actor'>;
  /** Never derived from a name or a credential. */
  readonly actorKind: 'HUMAN' | 'SYSTEM';
  readonly permissions: readonly string[];
}

export type IssueOutcome =
  | { readonly status: 'issued'; readonly handle: ActorHandle }
  | { readonly status: 'refused'; readonly reason: 'unknown_principal' | 'invalid_credential' };

export interface SyntheticIssuer {
  /** Typed outcome, not a throw, for a bad request (specification 2.10). */
  issue(principalKey: string): IssueOutcome;
  /** Idempotent, permanent, takes effect at the next `resolve`; an unknown handle is not a refusal. */
  revoke(handle: unknown): void;
  /** The port Investigation is given. Evaluation order: missing, invalid, revoked, expired, valid. */
  readonly resolver: ActorResolver;
  /** Emission attempts the security-event sink failed (a failing sink never changes an outcome). */
  sinkFailures(): number;
}

export interface SyntheticIssuerOptions {
  /** Only a genuine `readTrustedEnvironment` value is accepted; a look-alike is refused. */
  readonly environment: TrustedEnvironment;
  /** The issuer's trusted clock, injected by the composition root; callers never supply "now". */
  readonly clock: () => Timestamp;
  /** The principal table, required: the issuer has no built-in principals. */
  readonly principals: readonly SyntheticPrincipal[];
  /** The same security-event sink the composition root gives the Investigation security log. */
  readonly securityEvents: SecurityEventSink;
  /** Test seam for the standard-error fallback used when the sink fails. */
  readonly reportSinkFailure?: ((report: SinkFailureReport) => void) | undefined;
}

interface Claims {
  readonly actor: EntityRef<'Actor'>;
  readonly actorKind: 'HUMAN' | 'SYSTEM';
  readonly permissions: readonly Permission[];
}

interface Registration {
  readonly claims: Claims;
  readonly expiresAtMs: number;
  revoked: boolean;
}

const deepFrozenActor = (claims: Claims): VerifiedActor =>
  Object.freeze({
    actor: Object.freeze({
      entityType: 'Actor' as const,
      id: claims.actor.id,
    }) as EntityRef<'Actor'>,
    actorKind: claims.actorKind,
    permissions: Object.freeze([...claims.permissions]),
  });

function snapshotPrincipals(principals: readonly SyntheticPrincipal[]): Map<string, Claims> {
  if (!Array.isArray(principals)) throw new TypeError('principals must be an array');
  const table = new Map<string, Claims>();
  for (const principal of principals) {
    const key: unknown = principal?.key;
    if (typeof key !== 'string' || key === '') {
      throw new RangeError('a principal needs a non-empty string key');
    }
    if (table.has(key)) throw new RangeError('principal keys must be unique');
    if (principal.actor?.entityType !== 'Actor' || !isEntityId(principal.actor.id)) {
      throw new RangeError('a principal actor must be an Actor reference with a UUIDv7 id');
    }
    if (principal.actorKind !== 'HUMAN' && principal.actorKind !== 'SYSTEM') {
      throw new RangeError('a principal actorKind must be HUMAN or SYSTEM');
    }
    if (!Array.isArray(principal.permissions) || !principal.permissions.every(isPermission)) {
      throw new RangeError('principal permissions must come from the closed vocabulary');
    }
    // Sorted, de-duplicated, frozen copy: no caller-owned references survive.
    const permissions = Object.freeze(
      [...new Set(principal.permissions as readonly Permission[])].sort(),
    );
    table.set(
      key,
      Object.freeze({
        actor: Object.freeze({
          entityType: 'Actor' as const,
          id: principal.actor.id,
        }) as EntityRef<'Actor'>,
        actorKind: principal.actorKind,
        permissions,
      }),
    );
  }
  return table;
}

/**
 * Creates the synthetic issuer (specification 2). Construction fails closed: outside a positively matched local
 * or test environment it emits one `synthetic_forbidden` event and throws `SyntheticIdentityForbiddenError`.
 */
export function createSyntheticIssuer(options: SyntheticIssuerOptions): SyntheticIssuer {
  const events = createSecurityEventEmitter({
    sink: options.securityEvents,
    now: options.clock,
    reportFailure: options.reportSinkFailure,
  });
  try {
    assertSyntheticIdentityAllowed(options.environment);
  } catch (error) {
    events.refuse('synthetic_forbidden');
    throw error instanceof SyntheticIdentityForbiddenError
      ? error
      : new SyntheticIdentityForbiddenError();
  }
  const table = snapshotPrincipals(options.principals);
  // Private to this issuer: a handle of another issuer, a forged object or a copy is simply absent.
  const registry = new WeakMap<object, Registration>();

  const resolve = (handle: unknown): ActorResolution => {
    if (handle === undefined || handle === null) return { status: 'missing' };
    if (typeof handle !== 'object') return { status: 'invalid' };
    const entry = registry.get(handle);
    if (entry === undefined) return { status: 'invalid' };
    if (entry.revoked) return { status: 'revoked' };
    if (timestampToDate(options.clock()).getTime() >= entry.expiresAtMs)
      return { status: 'expired' };
    return { status: 'valid', actor: deepFrozenActor(entry.claims) };
  };

  return {
    issue(principalKey) {
      const claims = typeof principalKey === 'string' ? table.get(principalKey) : undefined;
      if (claims === undefined) {
        events.refuse('unknown_principal');
        return { status: 'refused', reason: 'unknown_principal' };
      }
      const issuedAt = options.clock();
      const handle = Object.freeze({}) as ActorHandle;
      registry.set(handle, {
        claims,
        expiresAtMs: timestampToDate(issuedAt).getTime() + HANDLE_TTL_MS,
        revoked: false,
      });
      return { status: 'issued', handle };
    },
    revoke(handle) {
      if (typeof handle !== 'object' || handle === null) return;
      const entry = registry.get(handle);
      if (entry !== undefined) entry.revoked = true;
    },
    resolver: Object.freeze({ resolve }),
    sinkFailures: events.sinkFailures,
  };
}
