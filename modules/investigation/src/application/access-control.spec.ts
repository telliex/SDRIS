import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { createEntityRef, newEntityId, ok, timestampFromDate } from '@sdris/shared-kernel';
import type { Timestamp } from '@sdris/shared-kernel';
import {
  REQUIRED_PERMISSION,
  type GuardedCommand,
  type RequestContext,
  type SecurityEvent,
} from './access-control';
import { createInvestigationService, type InvestigationService } from './investigation-service';
import type { InvestigationRepository } from './ports/investigation-repository';
import type { TransactionScope, TransactionToken } from './ports/transaction-scope';
import { ALL_PERMISSIONS, FakeIdentity, RecordingSecurityLog } from './test-identity.spec';
import type { InvestigationCaseId } from '../domain/investigation-case';
import type { TestAttemptId } from '../domain/test-attempt';
import type { UutId } from '../domain/uut';

/**
 * Authentication, correlation validation and authorization at the service boundary (S0-06 WP-03, specification 2.6
 * to 2.9, 3.1, 3.3 and 4.7), with a fake identity provider (see test-identity.spec.ts for its limits) and a
 * tripwire repository and transaction scope: a refusal must leave both untouched. The real issuer and a real
 * database are exercised in the apps/api tests.
 */
const clock = (): Timestamp => {
  const result = timestampFromDate(new Date(Date.UTC(2026, 10, 27, 9, 0, 0, 0)));
  if (!result.ok) throw new Error('bad test time');
  return result.value;
};

interface Tripwire {
  repositoryCalls: string[];
  transactions: number;
}
const tripwire = (): {
  state: Tripwire;
  repository: InvestigationRepository;
  scope: TransactionScope;
  repositoryCalls: () => string[];
} => {
  const state: Tripwire = { repositoryCalls: [], transactions: 0 };
  const note = (name: string) => state.repositoryCalls.push(name);
  const repository: InvestigationRepository = {
    async addUut() {
      note('addUut');
      return ok(undefined);
    },
    async getUut() {
      note('getUut');
      return undefined;
    },
    async addTestAttempt() {
      note('addTestAttempt');
      return ok(undefined);
    },
    async getTestAttempt() {
      note('getTestAttempt');
      return undefined;
    },
    async add() {
      note('add');
      return ok(undefined);
    },
    async get() {
      note('get');
      return undefined;
    },
    async save() {
      note('save');
      return ok({ version: 2 });
    },
  };
  const scope: TransactionScope = {
    async run(work) {
      state.transactions += 1;
      return work({} as TransactionToken);
    },
  };
  return { state, repository, scope, repositoryCalls: () => state.repositoryCalls };
};

const uutRef = (() => {
  const ref = createEntityRef('UUT', newEntityId<'UUT'>());
  if (!ref.ok) throw new Error('bad ref');
  return ref.value;
})();

/** One invocation per guarded command, with a command value that is valid on its own. */
const calls: Record<
  GuardedCommand,
  (service: InvestigationService, ctx: RequestContext) => Promise<unknown>
> = {
  registerUut: (s, c) => s.registerUut(c, { serialNumber: 'SN-1' }),
  registerTestAttempt: (s, c) =>
    s.registerTestAttempt(c, { uutId: newEntityId<'UUT'>() as UutId, stage: 'IST' }),
  openCase: (s, c) => s.openCase(c, { uut: uutRef }),
  linkAttempt: (s, c) =>
    s.linkAttempt(c, {
      caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
      attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
      role: 'RETEST',
      expectedVersion: 1,
    }),
  getUut: (s, c) => s.getUut(c, newEntityId<'UUT'>() as UutId),
  getTestAttempt: (s, c) => s.getTestAttempt(c, newEntityId<'TestAttempt'>() as TestAttemptId),
  getCase: (s, c) => s.getCase(c, newEntityId<'InvestigationCase'>() as InvestigationCaseId),
};
const COMMANDS = Object.keys(calls) as GuardedCommand[];

describe('access control at the service boundary', () => {
  let identity: FakeIdentity;
  let log: RecordingSecurityLog;
  let wire: ReturnType<typeof tripwire>;
  let service: InvestigationService;
  const build = (securityLog: { record(event: SecurityEvent): void } = log) =>
    createInvestigationService({
      actorResolver: identity.resolver,
      securityLog,
      repository: wire.repository,
      transactions: wire.scope,
      now: clock,
      newId: newEntityId,
    });
  const untouched = () => {
    assert.deepEqual(wire.repositoryCalls(), []);
    assert.equal(wire.state.transactions, 0, 'no transaction was opened');
  };
  beforeEach(() => {
    identity = new FakeIdentity();
    log = new RecordingSecurityLog();
    wire = tripwire();
    service = build();
  });
  const assertUntouched = untouched;

  const errorOf = (result: unknown) => {
    const r = result as { ok: boolean; error?: { code: string; details?: unknown } };
    assert.equal(r.ok, false, JSON.stringify(result));
    return r.error!;
  };

  describe('the factory', () => {
    it('refuses to build without an actor resolver or a security log', () => {
      const base = {
        repository: wire.repository,
        transactions: wire.scope,
        now: clock,
        newId: newEntityId,
      };
      assert.throws(
        () => createInvestigationService({ ...base, securityLog: log } as never),
        TypeError,
      );
      assert.throws(
        () => createInvestigationService({ ...base, actorResolver: identity.resolver } as never),
        TypeError,
      );
      assert.throws(
        () =>
          createInvestigationService({
            ...base,
            actorResolver: {} as never,
            securityLog: log,
          }),
        TypeError,
      );
    });
  });

  describe('authentication (A1)', () => {
    const forged = { permissions: ['investigation.read'], actor: { id: 'x' } };
    const contexts: Array<[string, () => unknown, string]> = [
      ['no context at all (undefined)', () => undefined, 'missing_handle'],
      ['a null context', () => null, 'missing_handle'],
      ['a string instead of a context', () => 'context', 'missing_handle'],
      ['a context without an actor', () => ({ correlationId: randomUUID() }), 'missing_handle'],
      ['an actor of null', () => ({ actor: null, correlationId: randomUUID() }), 'missing_handle'],
      [
        'a plain object that looks like claims',
        () => ({ actor: forged, correlationId: randomUUID() }),
        'invalid_handle',
      ],
      [
        'a copy of a real handle',
        () => ({ actor: { ...identity.handle() }, correlationId: randomUUID() }),
        'invalid_handle',
      ],
      [
        'a number as the actor',
        () => ({ actor: 7, correlationId: randomUUID() }),
        'invalid_handle',
      ],
      [
        'a handle of another identity provider',
        () => ({ actor: new FakeIdentity().handle(), correlationId: randomUUID() }),
        'invalid_handle',
      ],
    ];
    for (const command of COMMANDS) {
      for (const [label, make, reason] of contexts) {
        it(`${command}: ${label} is unauthenticated (${reason}), logged once, and touches nothing`, async () => {
          const result = await calls[command](service, make() as RequestContext);
          const error = errorOf(result);
          assert.equal(error.code, 'investigation.unauthenticated');
          assert.equal(error.details, undefined, 'no detail about the cause');
          assert.equal(log.events.length, 1);
          assert.deepEqual(log.events[0], {
            event: 'security.unauthenticated',
            at: clock(),
            command,
            reason,
          });
          assertUntouched();
        });
      }
    }

    it('an expired handle and a revoked handle are unauthenticated with their own log reason', async () => {
      const expired = identity.handle();
      identity.expire(expired);
      const revoked = identity.handle();
      identity.revoke(revoked);
      const a = errorOf(
        await service.getUut(identity.context(expired), newEntityId<'UUT'>() as UutId),
      );
      const b = errorOf(
        await service.getUut(identity.context(revoked), newEntityId<'UUT'>() as UutId),
      );
      assert.equal(a.code, 'investigation.unauthenticated');
      assert.equal(b.code, 'investigation.unauthenticated');
      assert.deepEqual(
        log.events.map((e) => (e as { reason: string }).reason),
        ['expired_handle', 'revoked_handle'],
      );
      assertUntouched();
    });

    it('a resolver that throws is a refusal (fail closed), not a crash or a success', async () => {
      const throwing = createInvestigationService({
        actorResolver: {
          resolve: () => {
            throw new Error('resolver down');
          },
        },
        securityLog: log,
        repository: wire.repository,
        transactions: wire.scope,
        now: clock,
        newId: newEntityId,
      });
      const error = errorOf(
        await throwing.getUut(identity.context(), newEntityId<'UUT'>() as UutId),
      );
      assert.equal(error.code, 'investigation.unauthenticated');
      assert.equal((log.events[0] as { reason: string }).reason, 'invalid_handle');
      assertUntouched();
    });

    it('the context actor is read exactly once and the resolver is asked exactly once', async () => {
      const handle = identity.handle();
      let reads = 0;
      const context = {
        get actor() {
          reads += 1;
          return reads === 1 ? handle : undefined;
        },
        correlationId: randomUUID(),
      };
      const before = identity.resolveCalls;
      const result = await service.getUut(context as never, newEntityId<'UUT'>() as UutId);
      assert.ok((result as { ok: boolean }).ok);
      assert.equal(reads, 1);
      assert.equal(identity.resolveCalls - before, 1);
    });

    it('a throwing context accessor is refused as an invalid handle', async () => {
      const context = {
        get actor(): never {
          throw new Error('accessor down');
        },
        correlationId: randomUUID(),
      };
      const error = errorOf(await service.getUut(context as never, newEntityId<'UUT'>() as UutId));
      assert.equal(error.code, 'investigation.unauthenticated');
      assertUntouched();
    });
  });

  describe('correlation validation (A2)', () => {
    const labels: Array<[string, unknown]> = [
      ['missing', undefined],
      ['null', null],
      ['a number', 7],
      ['an object', {}],
      ['free text', 'serial-number-SN-12345'],
      ['an upper-case UUID', randomUUID().toUpperCase()],
      ['a UUID with braces', `{${randomUUID()}}`],
      ['a UUID with trailing text', `${randomUUID()} `],
      ['a 128 character label (the Shared Kernel pattern would accept it)', 'a'.repeat(128)],
      ['an empty string', ''],
    ];
    for (const [label, value] of labels) {
      it(`refuses ${label} as invalid_request_context on correlationId, logged without the label`, async () => {
        const handle = identity.handle();
        const context = { actor: handle, correlationId: value } as unknown as RequestContext;
        const error = errorOf(await service.getUut(context, newEntityId<'UUT'>() as UutId));
        assert.equal(error.code, 'investigation.invalid_request_context');
        assert.deepEqual(error.details, { field: 'correlationId' });
        assert.equal(log.events.length, 1);
        assert.deepEqual(log.events[0], {
          event: 'security.invalid_request_context',
          at: clock(),
          command: 'getUut',
          reason: 'invalid_correlation',
          actorId: identity.actorId(handle),
        });
        assert.ok(!('correlationId' in log.events[0]!), 'an unvalidated label is never logged');
        assertUntouched();
      });
    }

    it('an array or function that carries a valid handle is an invalid context, not a trusted one', async () => {
      const handle = identity.handle();
      const asArray = Object.assign([], { actor: handle, correlationId: randomUUID() });
      const asFunction = Object.assign(() => undefined, {
        actor: handle,
        correlationId: randomUUID(),
      });
      for (const context of [asArray, asFunction]) {
        const error = errorOf(
          await service.getUut(context as never, newEntityId<'UUT'>() as UutId),
        );
        assert.equal(error.code, 'investigation.invalid_request_context');
        assert.deepEqual(error.details, { field: 'context' });
      }
      assert.deepEqual(
        log.events.map((e) => (e as { reason: string }).reason),
        ['invalid_context', 'invalid_context'],
      );
      assertUntouched();
    });

    it('a context that stops being inspectable is an invalid context, not a crash (regression)', async () => {
      // The reviewer's reproduction: the actor getter hands back a valid handle but revokes the context first, so
      // the later shape inspection (`Array.isArray`) throws a TypeError on the revoked proxy.
      const handle = identity.handle();
      const revocable = Proxy.revocable(
        {},
        {
          get(_target, property) {
            if (property === 'actor') {
              revocable.revoke();
              return handle;
            }
            return randomUUID();
          },
        },
      );
      const result = await service.getUut(revocable.proxy as never, newEntityId<'UUT'>() as UutId);
      const error = errorOf(result);
      assert.equal(error.code, 'investigation.invalid_request_context');
      assert.deepEqual(error.details, { field: 'context' });
      assert.equal(log.events.length, 1, 'exactly one event');
      assert.deepEqual(log.events[0], {
        event: 'security.invalid_request_context',
        at: clock(),
        command: 'getUut',
        reason: 'invalid_context',
        actorId: identity.actorId(handle),
      });
      assert.ok(!('correlationId' in log.events[0]!), 'an uninspected label is never logged');
      assertUntouched();
    });

    it('the same revoked context is refused by every command and read, never crashing', async () => {
      for (const command of COMMANDS) {
        const handle = identity.handle();
        const revocable = Proxy.revocable(
          {},
          {
            get() {
              revocable.revoke();
              return handle;
            },
          },
        );
        const error = errorOf(await calls[command](service, revocable.proxy as never));
        assert.equal(error.code, 'investigation.invalid_request_context', command);
        assert.deepEqual(error.details, { field: 'context' }, command);
      }
      assert.equal(log.events.length, COMMANDS.length);
      assertUntouched();
    });

    it('the correlation label is read exactly once', async () => {
      const handle = identity.handle();
      let reads = 0;
      const context = {
        actor: handle,
        get correlationId() {
          reads += 1;
          return reads === 1 ? randomUUID() : 'not-a-uuid';
        },
      };
      const result = await service.getUut(context as never, newEntityId<'UUT'>() as UutId);
      assert.ok((result as { ok: boolean }).ok);
      assert.equal(reads, 1);
    });
  });

  describe('authorization (A3)', () => {
    for (const command of COMMANDS) {
      const required = REQUIRED_PERMISSION[command];
      it(`${command} needs exactly ${required}: without it permission_denied, with only it the call passes access`, async () => {
        const others = ALL_PERMISSIONS.filter((p) => p !== required);
        // every other permission, but not the required one
        const denied = identity.handle(others);
        const deniedContext = identity.context(denied);
        const error = errorOf(await calls[command](service, deniedContext));
        assert.equal(error.code, 'investigation.permission_denied');
        assert.deepEqual(error.details, { requiredPermission: required });
        assert.deepEqual(log.events, [
          {
            event: 'security.permission_denied',
            at: clock(),
            command,
            reason: 'permission_missing',
            correlationId: deniedContext.correlationId,
            actorId: identity.actorId(denied),
            requiredPermission: required,
          },
        ]);
        assertUntouched();

        // exactly the required permission and nothing else
        log.events.length = 0;
        const allowed = identity.context(identity.handle([required]));
        const result = (await calls[command](service, allowed)) as {
          ok: boolean;
          error?: { code: string };
        };
        assert.ok(
          result.ok ||
            !/^investigation\.(unauthenticated|invalid_request_context|permission_denied)$/.test(
              result.error!.code,
            ),
          'no access error',
        );
        assert.deepEqual(log.events, [], 'an accepted call logs nothing');
        assert.ok(wire.repositoryCalls().length > 0, 'the operation itself ran');
      });
    }

    it('an actor with no permission at all is denied, and a SYSTEM actor gets no special treatment', async () => {
      for (const kind of ['HUMAN', 'SYSTEM'] as const) {
        const handle = identity.handle([], kind);
        const error = errorOf(
          await service.getCase(
            identity.context(handle),
            newEntityId<'InvestigationCase'>() as InvestigationCaseId,
          ),
        );
        assert.equal(error.code, 'investigation.permission_denied');
      }
      assertUntouched();
    });

    it('a permission outside the vocabulary or a look-alike grants nothing', async () => {
      const handle = identity.handle([
        'investigation.*',
        'investigation.admin',
        'INVESTIGATION.READ',
        'investigation.read ',
      ]);
      const error = errorOf(
        await service.getUut(identity.context(handle), newEntityId<'UUT'>() as UutId),
      );
      assert.equal(error.code, 'investigation.permission_denied');
      assertUntouched();
    });

    it('authentication does not imply authorization and a denied read is not reported as not found', async () => {
      const handle = identity.handle(['investigation.uut.register']);
      const denied = await service.getUut(identity.context(handle), newEntityId<'UUT'>() as UutId);
      assert.equal((denied as { ok: boolean }).ok, false);
      const granted = await service.getUut(
        identity.context(identity.handle(['investigation.read'])),
        newEntityId<'UUT'>() as UutId,
      );
      assert.deepEqual(
        granted,
        ok(undefined),
        'an authorized read of a missing resource is ok(undefined)',
      );
    });
  });

  describe('order of checks (specification 2.7)', () => {
    it('authentication comes before the correlation check', async () => {
      const context = {
        actor: { forged: true },
        correlationId: 'bad',
      } as unknown as RequestContext;
      assert.equal(
        errorOf(await service.getUut(context, newEntityId<'UUT'>() as UutId)).code,
        'investigation.unauthenticated',
      );
    });

    it('the correlation check comes before authorization', async () => {
      const context = {
        actor: identity.handle([]),
        correlationId: 'bad',
      } as unknown as RequestContext;
      assert.equal(
        errorOf(await service.getUut(context, newEntityId<'UUT'>() as UutId)).code,
        'investigation.invalid_request_context',
      );
    });

    it('authorization comes before domain validation and before the transaction', async () => {
      const denied = identity.context(identity.handle([]));
      const noPermission = errorOf(
        await service.linkAttempt(denied, {
          caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
          attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
          role: 'not-a-role',
          expectedVersion: 'x' as never,
        }),
      );
      assert.equal(noPermission.code, 'investigation.permission_denied');
      assertUntouched();
    });

    it('pure domain validation (role, stage) runs after access and before any transaction opens', async () => {
      const ctx = identity.context();
      const role = errorOf(
        await service.linkAttempt(ctx, {
          caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
          attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
          role: 'not-a-role',
          expectedVersion: 1,
        }),
      );
      const stage = errorOf(
        await service.registerTestAttempt(ctx, {
          uutId: newEntityId<'UUT'>() as UutId,
          stage: 'FCT',
        }),
      );
      assert.equal(role.code, 'investigation.invalid_link_role');
      assert.equal(stage.code, 'investigation.invalid_test_stage');
      assertUntouched();
      assert.deepEqual(log.events, [], 'a domain validation error is not a security event');
    });

    it('an authorized call still gets the existing precedence: not found before an invalid expectedVersion', async () => {
      const result = errorOf(
        await service.linkAttempt(identity.context(), {
          caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
          attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
          role: 'RETEST',
          expectedVersion: 'x' as never,
        }),
      );
      assert.equal(result.code, 'investigation.case_not_found');
      assert.equal(wire.state.transactions, 1);
    });
  });

  describe('the Security Log (specification 4.7)', () => {
    it('events carry fixed fields only and never a handle, a claim, a payload value or a caller label', async () => {
      const handle = identity.handle(['investigation.read']);
      await service.registerUut(identity.context(handle), {
        serialNumber: 'SN-SECRET-12345',
        hostname: 'host-secret',
      });
      await service.getUut(
        { actor: { secret: 'token-abc' }, correlationId: randomUUID() } as never,
        newEntityId<'UUT'>() as UutId,
      );
      await service.getUut(
        { actor: handle, correlationId: 'label-secret-xyz' } as never,
        newEntityId<'UUT'>() as UutId,
      );
      assert.equal(log.events.length, 3);
      const text = JSON.stringify(log.events);
      for (const secret of ['SN-SECRET-12345', 'host-secret', 'token-abc', 'label-secret-xyz']) {
        assert.ok(!text.includes(secret), `${secret} must not be logged`);
      }
      const keys = log.events.map((e) => Object.keys(e).sort());
      assert.deepEqual(keys[0], [
        'actorId',
        'at',
        'command',
        'correlationId',
        'event',
        'reason',
        'requiredPermission',
      ]);
      assert.deepEqual(keys[1], ['at', 'command', 'event', 'reason']);
      assert.deepEqual(keys[2], ['actorId', 'at', 'command', 'event', 'reason']);
    });

    it('one event per rejected call, none for an accepted call', async () => {
      const ctx = identity.context();
      await service.getUut(ctx, newEntityId<'UUT'>() as UutId);
      assert.equal(log.events.length, 0);
      const bad = identity.context(identity.handle([]));
      for (let i = 0; i < 3; i += 1) await service.getUut(bad, newEntityId<'UUT'>() as UutId);
      assert.equal(log.events.length, 3);
    });

    it('events are frozen values built by the service, not objects the caller can reach', async () => {
      await service.getUut(undefined as never, newEntityId<'UUT'>() as UutId);
      assert.ok(Object.isFrozen(log.events[0]) || Object.keys(log.events[0]!).length === 4);
    });

    it('a throwing security log never changes the refusal, and an accepted result is never affected by it', async () => {
      const broken = build({
        record: () => {
          throw new Error('log down');
        },
      });
      const denied = errorOf(
        await broken.getUut(undefined as never, newEntityId<'UUT'>() as UutId),
      );
      assert.equal(denied.code, 'investigation.unauthenticated');
      const accepted = await broken.getUut(identity.context(), newEntityId<'UUT'>() as UutId);
      assert.ok((accepted as { ok: boolean }).ok);
    });
  });

  describe('reads', () => {
    it('absence is ok(undefined) for an authorized actor, for all three reads', async () => {
      const ctx = identity.context();
      assert.deepEqual(await service.getUut(ctx, newEntityId<'UUT'>() as UutId), ok(undefined));
      assert.deepEqual(
        await service.getTestAttempt(ctx, newEntityId<'TestAttempt'>() as TestAttemptId),
        ok(undefined),
      );
      assert.deepEqual(
        await service.getCase(ctx, newEntityId<'InvestigationCase'>() as InvestigationCaseId),
        ok(undefined),
      );
      assert.equal(wire.state.transactions, 0, 'reads open no transaction');
    });

    it('a refused read never reaches the repository', async () => {
      for (const command of ['getUut', 'getTestAttempt', 'getCase'] as const) {
        await calls[command](service, undefined as never);
        await calls[command](service, identity.context(identity.handle([])));
      }
      assertUntouched();
      assert.equal(log.events.length, 6);
    });
  });
});
