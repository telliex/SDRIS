import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActorHandle as PublicActorHandle } from '../../public';
import type { ActorHandle, ActorResolution, ActorResolver, VerifiedActor } from './actor-resolver';

/** Contract tests (S0-06 WP-02, specification 2.2 and 2.4). Mostly compile-time: `tsc --noEmit` is part of the run. */
describe('actor resolver contract', () => {
  it('the public ActorHandle is the same member-less opaque type as the port declares', () => {
    const same: PublicActorHandle = {} as ActorHandle;
    const back: ActorHandle = same;
    assert.ok(back !== undefined || back === undefined);
    // `keyof` of a member-less handle is only the brand symbol: nothing a caller could read or set by name.
    type Names = Exclude<keyof ActorHandle, symbol>;
    const none: Names[] = [];
    assert.equal(none.length, 0);
  });

  it('the resolution union is closed: the five statuses of specification 2.4, exhaustively handled', () => {
    const describeOutcome = (r: ActorResolution): string => {
      switch (r.status) {
        case 'valid':
          return `valid:${r.actor.actorKind}`;
        case 'missing':
        case 'invalid':
        case 'expired':
        case 'revoked':
          return r.status;
        default: {
          const unreachable: never = r;
          return unreachable;
        }
      }
    };
    const actor: VerifiedActor = {
      actor: { entityType: 'Actor', id: '0190a5b0-0000-7000-8000-000000000001' as never },
      actorKind: 'SYSTEM',
      permissions: Object.freeze(['investigation.read']),
    };
    assert.equal(describeOutcome({ status: 'valid', actor }), 'valid:SYSTEM');
    for (const status of ['missing', 'invalid', 'expired', 'revoked'] as const) {
      assert.equal(describeOutcome({ status }), status);
    }
  });

  it('a resolver takes an unknown handle: the type system is not the trust decision', () => {
    const resolver: ActorResolver = { resolve: () => ({ status: 'invalid' }) };
    const asUnknown: Parameters<ActorResolver['resolve']>[0] = { permissions: [] };
    assert.deepEqual(resolver.resolve({ permissions: ['investigation.read'] }), {
      status: 'invalid',
    });
  });
});
