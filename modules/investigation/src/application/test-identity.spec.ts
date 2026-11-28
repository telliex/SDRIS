import { randomUUID } from 'node:crypto';
import { newEntityId, type CorrelationId } from '@sdris/shared-kernel';
import type { RequestContext, SecurityEvent, SecurityLog } from './access-control';
import type {
  ActorHandle,
  ActorResolution,
  ActorResolver,
  VerifiedActor,
} from './ports/actor-resolver';

/**
 * A fake identity provider for the isolated unit tests of the service (S0-06 WP-03). **Its limits are explicit:** it
 * is not the real issuer. It only lets these tests choose an actor's permissions and status without importing the
 * application's identity module (Investigation may not import it). The real issuer, its registry, expiry and
 * revocation are exercised through the real composition in the `apps/api` tests; nothing here claims to prove them.
 */
export const ALL_PERMISSIONS = [
  'investigation.attempt.register',
  'investigation.case.link_attempt',
  'investigation.case.open',
  'investigation.read',
  'investigation.uut.register',
] as const;

interface Entry {
  readonly actor: VerifiedActor;
  status: 'valid' | 'expired' | 'revoked';
}

export class FakeIdentity {
  private readonly registry = new WeakMap<object, Entry>();
  /** How many times the resolver was asked, for "resolved exactly once per call" assertions. */
  resolveCalls = 0;

  readonly resolver: ActorResolver = {
    resolve: (handle: unknown): ActorResolution => {
      this.resolveCalls += 1;
      if (handle === undefined || handle === null) return { status: 'missing' };
      if (typeof handle !== 'object') return { status: 'invalid' };
      const entry = this.registry.get(handle);
      if (entry === undefined) return { status: 'invalid' };
      if (entry.status === 'revoked') return { status: 'revoked' };
      if (entry.status === 'expired') return { status: 'expired' };
      return { status: 'valid', actor: entry.actor };
    },
  };

  /** A registered handle for an actor with exactly these permissions. */
  handle(
    permissions: readonly string[] = ALL_PERMISSIONS,
    kind: 'HUMAN' | 'SYSTEM' = 'HUMAN',
  ): ActorHandle {
    const handle = Object.freeze({}) as ActorHandle;
    this.registry.set(handle, {
      status: 'valid',
      actor: Object.freeze({
        actor: Object.freeze({ entityType: 'Actor' as const, id: newEntityId<'Actor'>() }),
        actorKind: kind,
        permissions: Object.freeze([...permissions]),
      }),
    });
    return handle;
  }

  expire(handle: ActorHandle): void {
    this.registry.get(handle)!.status = 'expired';
  }

  revoke(handle: ActorHandle): void {
    this.registry.get(handle)!.status = 'revoked';
  }

  actorId(handle: ActorHandle): string {
    return this.registry.get(handle)!.actor.actor.id;
  }

  /** A well-formed context: the handle plus a strict (lowercase canonical UUID) correlation label. */
  context(
    handle: ActorHandle = this.handle(),
    correlationId: string = randomUUID(),
  ): RequestContext {
    return { actor: handle, correlationId: correlationId as CorrelationId };
  }
}

export class RecordingSecurityLog implements SecurityLog {
  readonly events: SecurityEvent[] = [];
  record(event: SecurityEvent): void {
    this.events.push(event);
  }
}
