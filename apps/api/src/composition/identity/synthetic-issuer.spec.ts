import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { timestampFromDate, type Timestamp } from '@sdris/shared-kernel';
import {
  HANDLE_TTL_MS,
  SyntheticIdentityForbiddenError,
  createSyntheticIssuer,
  isPermission,
  readTrustedEnvironment,
  type IssuanceRefusedEvent,
  type SyntheticIssuer,
  type SyntheticPrincipal,
} from './index';
import {
  FIXTURE_HUMAN_ID,
  FIXTURE_SYSTEM_ID,
  syntheticPrincipalsFixture,
} from './synthetic-principals.fixtures';

/** Unit tests of the synthetic issuer (S0-06 WP-02, specification 2 and 2.10). Deterministic clock: no sleeps. */
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0, 0);
const stamp = (ms: number): Timestamp => {
  const result = timestampFromDate(new Date(ms));
  if (!result.ok) throw new Error('bad test time');
  return result.value;
};
const testEnvironment = () => readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' });

describe('synthetic issuer', () => {
  let now: number;
  let events: IssuanceRefusedEvent[];
  let issuer: SyntheticIssuer;
  const build = (principals: readonly SyntheticPrincipal[] = syntheticPrincipalsFixture) =>
    createSyntheticIssuer({
      environment: testEnvironment(),
      clock: () => stamp(now),
      principals,
      securityEvents: (event) => events.push(event),
    });
  const issueHandle = (key = 'fixture-engineer', from: SyntheticIssuer = issuer) => {
    const outcome = from.issue(key);
    assert.equal(outcome.status, 'issued');
    if (outcome.status !== 'issued') throw new Error('not issued');
    return outcome.handle;
  };

  beforeEach(() => {
    now = T0;
    events = [];
    issuer = build();
  });

  describe('issuance and resolution', () => {
    it('resolves a valid handle to the issuer-private canonical claims', () => {
      const resolution = issuer.resolver.resolve(issueHandle());
      assert.equal(resolution.status, 'valid');
      if (resolution.status !== 'valid') return;
      assert.deepEqual(resolution.actor.actor, { entityType: 'Actor', id: FIXTURE_HUMAN_ID });
      assert.equal(resolution.actor.actorKind, 'HUMAN');
      assert.deepEqual(resolution.actor.permissions, [
        'investigation.attempt.register',
        'investigation.case.link_attempt',
        'investigation.case.open',
        'investigation.read',
        'investigation.uut.register',
      ]);
      assert.equal(events.length, 0, 'a successful issuance and resolution emit nothing');
    });

    it('keeps the actor kind in the table: a SYSTEM principal is SYSTEM whatever its name suggests', () => {
      const resolution = issuer.resolver.resolve(issueHandle('fixture-automation'));
      assert.ok(resolution.status === 'valid');
      assert.equal(resolution.actor.actorKind, 'SYSTEM');
      assert.equal(resolution.actor.actor.id, FIXTURE_SYSTEM_ID);
    });

    it('a handle is a frozen member-less object: no claims to read or alter', () => {
      const handle = issueHandle();
      assert.ok(Object.isFrozen(handle));
      assert.deepEqual(Reflect.ownKeys(handle), []);
      assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(handle)).sort(), [
        '__defineGetter__',
        '__defineSetter__',
        '__lookupGetter__',
        '__lookupSetter__',
        '__proto__',
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
        'toString',
        'valueOf',
      ]);
      assert.throws(() => {
        (handle as unknown as Record<string, unknown>).permissions = ['x'];
      }, TypeError);
    });

    it('returns a fresh deep-frozen copy each time, so nothing aliases the registry', () => {
      const handle = issueHandle();
      const first = issuer.resolver.resolve(handle);
      const second = issuer.resolver.resolve(handle);
      assert.ok(first.status === 'valid' && second.status === 'valid');
      assert.notEqual(first.actor, second.actor);
      assert.notEqual(first.actor.permissions, second.actor.permissions);
      for (const copy of [first.actor, first.actor.actor, first.actor.permissions]) {
        assert.ok(Object.isFrozen(copy));
      }
      assert.throws(
        () => (first.actor.permissions as string[]).push('investigation.read'),
        TypeError,
      );
      assert.throws(() => {
        (first.actor.actor as { id: string }).id = 'x';
      }, TypeError);
      assert.deepEqual(
        issuer.resolver.resolve(handle),
        second,
        'claims are unaltered by what a caller does',
      );
    });

    it('does not let the caller change claims through the principal table it passed in', () => {
      const principals = [
        {
          key: 'mutable',
          actor: { entityType: 'Actor' as const, id: FIXTURE_HUMAN_ID as never },
          actorKind: 'HUMAN' as const,
          permissions: ['investigation.read'],
        },
      ];
      const own = build(principals);
      const handle = issueHandle('mutable', own);
      principals[0]!.permissions.push('investigation.case.open');
      (principals[0] as { actorKind: string }).actorKind = 'SYSTEM';
      const resolution = own.resolver.resolve(handle);
      assert.ok(resolution.status === 'valid');
      assert.deepEqual(resolution.actor.permissions, ['investigation.read']);
      assert.equal(resolution.actor.actorKind, 'HUMAN');
    });

    it('builds permissions sorted, de-duplicated and from the closed vocabulary', () => {
      const own = build([
        {
          key: 'dupes',
          actor: { entityType: 'Actor', id: FIXTURE_HUMAN_ID } as never,
          actorKind: 'HUMAN',
          permissions: ['investigation.read', 'investigation.case.open', 'investigation.read'],
        },
      ]);
      const resolution = own.resolver.resolve(issueHandle('dupes', own));
      assert.ok(resolution.status === 'valid');
      assert.deepEqual(resolution.actor.permissions, [
        'investigation.case.open',
        'investigation.read',
      ]);
      assert.equal(isPermission('investigation.root'), false);
    });

    it('rejects a malformed principal table at construction (invalid id, kind, permission, duplicate key)', () => {
      const base = syntheticPrincipalsFixture[0]!;
      const bad: unknown[] = [
        { ...base, actor: { entityType: 'Actor', id: 'not-a-uuid' } },
        { ...base, actor: { entityType: 'UUT', id: FIXTURE_HUMAN_ID } },
        { ...base, actorKind: 'AI' },
        { ...base, permissions: ['investigation.admin'] },
        { ...base, key: '' },
      ];
      for (const entry of bad) {
        assert.throws(
          () => build([entry as SyntheticPrincipal]),
          (error) => {
            return !(error instanceof SyntheticIdentityForbiddenError);
          },
        );
      }
      assert.throws(() => build([base, base]), RangeError);
      assert.deepEqual(events, [], 'a bad table is a programming error, not a security event');
    });
  });

  describe('runtime trust boundaries', () => {
    const plainLookalike = { permissions: ['investigation.read'], actor: { id: FIXTURE_HUMAN_ID } };
    const cases: Array<[string, () => unknown, 'missing' | 'invalid']> = [
      ['undefined', () => undefined, 'missing'],
      ['null', () => null, 'missing'],
      ['a plain object that looks like claims', () => plainLookalike, 'invalid'],
      ['an empty object', () => ({}), 'invalid'],
      ['a frozen empty object the issuer never registered', () => Object.freeze({}), 'invalid'],
      ['a copy of a real handle', () => Object.freeze({ ...issueHandle() }), 'invalid'],
      [
        'a clone with the same prototype',
        () => Object.freeze(Object.create(Object.getPrototypeOf(issueHandle()))),
        'invalid',
      ],
      ['a string', () => 'fixture-engineer', 'invalid'],
      ['a number', () => 7, 'invalid'],
      ['a boolean', () => true, 'invalid'],
      ['a symbol', () => Symbol('handle'), 'invalid'],
      ['a function', () => () => undefined, 'invalid'],
      ['an array', () => [issueHandle()], 'invalid'],
      [
        'a JSON round trip of a real handle',
        () => JSON.parse(JSON.stringify(issueHandle())),
        'invalid',
      ],
    ];
    for (const [label, make, status] of cases) {
      it(`${status}: ${label}`, () => {
        assert.deepEqual(issuer.resolver.resolve(make()), { status });
      });
    }

    it('a handle of a foreign issuer is invalid here, indistinguishable from a forged one', () => {
      const other = build();
      const foreign = issueHandle('fixture-engineer', other);
      assert.deepEqual(issuer.resolver.resolve(foreign), { status: 'invalid' });
      assert.equal(other.resolver.resolve(foreign).status, 'valid');
    });

    it('resolving never changes state and never emits an event', () => {
      const handle = issueHandle();
      for (let i = 0; i < 5; i += 1) issuer.resolver.resolve(handle);
      issuer.resolver.resolve(plainLookalike);
      assert.equal(events.length, 0);
    });
  });

  describe('expiry (15 minutes, now >= expiresAt)', () => {
    it('uses the specified 15 minute lifetime', () => {
      assert.equal(HANDLE_TTL_MS, 15 * 60 * 1000);
    });

    it('is valid one millisecond before expiresAt and expired at exactly expiresAt', () => {
      const handle = issueHandle();
      now = T0 + HANDLE_TTL_MS - 1;
      assert.equal(issuer.resolver.resolve(handle).status, 'valid');
      now = T0 + HANDLE_TTL_MS;
      assert.deepEqual(issuer.resolver.resolve(handle), { status: 'expired' });
      now = T0 + HANDLE_TTL_MS + 1;
      assert.deepEqual(issuer.resolver.resolve(handle), { status: 'expired' });
    });

    it('is reusable until then, with no renewal and no sliding window', () => {
      const handle = issueHandle();
      for (const offset of [0, 1, 60_000, 600_000, HANDLE_TTL_MS - 1]) {
        now = T0 + offset;
        assert.equal(issuer.resolver.resolve(handle).status, 'valid');
      }
      now = T0 + HANDLE_TTL_MS;
      assert.equal(issuer.resolver.resolve(handle).status, 'expired');
      // Repeated use never moved expiresAt: the status above is decided by issuance time plus 15 minutes only.
    });

    it('counts the lifetime from issuance, so a later handle lives later', () => {
      const early = issueHandle();
      now = T0 + 10 * 60_000;
      const late = issueHandle();
      now = T0 + HANDLE_TTL_MS;
      assert.equal(issuer.resolver.resolve(early).status, 'expired');
      assert.equal(issuer.resolver.resolve(late).status, 'valid');
    });
  });

  describe('revocation', () => {
    it('takes effect at the next resolve and is permanent', () => {
      const handle = issueHandle();
      assert.equal(issuer.resolver.resolve(handle).status, 'valid');
      issuer.revoke(handle);
      assert.deepEqual(issuer.resolver.resolve(handle), { status: 'revoked' });
      now = T0 + 1000;
      assert.deepEqual(issuer.resolver.resolve(handle), { status: 'revoked' });
      const replacement = issueHandle();
      assert.equal(issuer.resolver.resolve(replacement).status, 'valid');
      assert.deepEqual(
        issuer.resolver.resolve(handle),
        { status: 'revoked' },
        'a new handle does not restore it',
      );
    });

    it('is idempotent and isolated between handles of the same principal', () => {
      const first = issueHandle();
      const second = issueHandle();
      issuer.revoke(first);
      issuer.revoke(first);
      assert.equal(issuer.resolver.resolve(first).status, 'revoked');
      assert.equal(issuer.resolver.resolve(second).status, 'valid');
    });

    it('reports revoked before expired, as specified (missing, invalid, revoked, expired, valid)', () => {
      const handle = issueHandle();
      issuer.revoke(handle);
      now = T0 + HANDLE_TTL_MS + 1;
      assert.deepEqual(issuer.resolver.resolve(handle), { status: 'revoked' });
    });

    it('revoking an unknown, foreign, forged or missing handle changes nothing and emits no event', () => {
      const own = issueHandle();
      const foreign = issueHandle('fixture-engineer', build());
      for (const value of [undefined, null, {}, 'x', 7, foreign, Object.freeze({})])
        issuer.revoke(value);
      assert.equal(issuer.resolver.resolve(own).status, 'valid');
      assert.equal(events.length, 0);
    });
  });

  describe('issuer refusals (specification 2.10)', () => {
    it('an unknown principal key is refused with one event that never contains the key', () => {
      const outcome = issuer.issue('secret-principal-key-abc');
      assert.deepEqual(outcome, { status: 'refused', reason: 'unknown_principal' });
      assert.equal('handle' in outcome, false);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        event: 'security.issuance_refused',
        at: stamp(T0),
        origin: 'issuer',
        reason: 'unknown_principal',
      });
      assert.deepEqual(Object.keys(events[0]!).sort(), ['at', 'event', 'origin', 'reason']);
      assert.ok(!JSON.stringify(events).includes('secret-principal-key-abc'));
    });

    it('a known principal key is issued with zero events', () => {
      assert.equal(issuer.issue('fixture-reader').status, 'issued');
      assert.equal(events.length, 0);
    });

    it('N refused calls produce N events: no coalescing, no duplicates', () => {
      for (let i = 0; i < 7; i += 1) issuer.issue(`unknown-${i}`);
      assert.equal(events.length, 7);
      assert.ok(events.every((event) => event.reason === 'unknown_principal'));
    });

    it('a non-string key is an unknown principal, not a crash', () => {
      for (const key of [undefined, null, 7, {}, ['fixture-reader']]) {
        assert.deepEqual(issuer.issue(key as never), {
          status: 'refused',
          reason: 'unknown_principal',
        });
      }
      assert.equal(events.length, 5);
    });

    it('a throwing sink: the outcome is unchanged, one emission attempt per refusal, one stderr report each', () => {
      let attempts = 0;
      const reports: unknown[] = [];
      const failing = createSyntheticIssuer({
        environment: testEnvironment(),
        clock: () => stamp(now),
        principals: syntheticPrincipalsFixture,
        securityEvents: () => {
          attempts += 1;
          throw new Error('sink down');
        },
        reportSinkFailure: (report) => reports.push(report),
      });
      assert.deepEqual(failing.issue('nobody'), { status: 'refused', reason: 'unknown_principal' });
      assert.equal(attempts, 1);
      assert.equal(reports.length, 1);
      assert.equal(failing.sinkFailures(), 1);
      failing.issue('nobody-else');
      assert.equal(attempts, 2);
      assert.equal(failing.sinkFailures(), 2);
      assert.equal(failing.issue('fixture-reader').status, 'issued');
      assert.equal(attempts, 2, 'a success emits nothing');
      assert.deepEqual(reports[0], { event: 'security.issuance_refused' });
    });

    it('a failing standard-error reporter never changes the outcome either', () => {
      const failing = createSyntheticIssuer({
        environment: testEnvironment(),
        clock: () => stamp(now),
        principals: syntheticPrincipalsFixture,
        securityEvents: () => {
          throw new Error('sink down');
        },
        reportSinkFailure: () => {
          throw new Error('stderr down');
        },
      });
      assert.deepEqual(failing.issue('nobody'), { status: 'refused', reason: 'unknown_principal' });
      assert.equal(failing.sinkFailures(), 1);
    });
  });
});
