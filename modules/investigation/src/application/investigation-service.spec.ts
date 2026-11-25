import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  createError,
  createEntityRef,
  err,
  newEntityId,
  ok,
  type Result,
} from '@sdris/shared-kernel';
import type { InvestigationCase, InvestigationCaseId } from '../domain/investigation-case';
import type { TestAttempt, TestAttemptId } from '../domain/test-attempt';
import { timestamp } from '../domain/test-builders.spec';
import type { Uut, UutId, UutRef } from '../domain/uut';
import { createInvestigationService, type InvestigationService } from './investigation-service';
import type { InvestigationRepository, RepositoryError } from './ports/investigation-repository';
import type { TransactionScope, TransactionToken } from './ports/transaction-scope';

/** In-memory stand-ins for the ports. Real PostgreSQL behaviour is covered by the integration tests. */
class FakeStore {
  uuts = new Map<string, Uut>();
  attempts = new Map<string, TestAttempt>();
  cases = new Map<string, InvestigationCase>();
  versions = new Map<string, number>();
  saves = 0;
  failNextSave: 'conflict' | 'throw' | undefined;
}
const fakeScope = (store: FakeStore): TransactionScope => ({
  async run(work) {
    const snapshot = {
      uuts: new Map(store.uuts),
      attempts: new Map(store.attempts),
      cases: new Map(store.cases),
      versions: new Map(store.versions),
    };
    try {
      return await work({} as TransactionToken);
    } catch (error) {
      Object.assign(store, snapshot);
      throw error;
    }
  },
});
const exists = (code: 'case' | 'uut' | 'attempt'): Result<never, RepositoryError> =>
  err(createError({ code: `investigation.${code}_already_exists` as const, message: 'exists' }));
const fakeRepository = (store: FakeStore): InvestigationRepository => ({
  async addUut(u) {
    if (store.uuts.has(u.id)) return exists('uut');
    store.uuts.set(u.id, u);
    return ok(undefined);
  },
  async getUut(id) {
    return store.uuts.get(id);
  },
  async addTestAttempt(a) {
    if (store.attempts.has(a.id)) return exists('attempt');
    store.attempts.set(a.id, a);
    return ok(undefined);
  },
  async getTestAttempt(id) {
    return store.attempts.get(id);
  },
  async add(c) {
    if (store.cases.has(c.id)) return exists('case');
    store.cases.set(c.id, c);
    store.versions.set(c.id, 1);
    return ok(undefined);
  },
  async get(id) {
    const stored = store.cases.get(id);
    return stored ? { ...stored, version: store.versions.get(id)! } : undefined;
  },
  async save(c): Promise<Result<{ version: number }, RepositoryError>> {
    store.saves += 1;
    if (store.failNextSave === 'throw') throw new Error('database exploded');
    if (store.failNextSave === 'conflict' || store.versions.get(c.id) !== c.version) {
      return err(
        createError({
          code: 'investigation.concurrency_conflict' as const,
          message: 'stale',
          details: { expectedVersion: c.version },
        }),
      );
    }
    store.cases.set(c.id, c);
    store.versions.set(c.id, c.version + 1);
    return ok({ version: c.version + 1 });
  },
});

const refOf = (u: Uut): UutRef => {
  const ref = createEntityRef('UUT', u.id);
  if (!ref.ok) throw new Error('bad ref');
  return ref.value;
};

describe('InvestigationService', () => {
  let store: FakeStore;
  let service: InvestigationService;
  let tick: number;
  beforeEach(() => {
    store = new FakeStore();
    tick = 0;
    service = createInvestigationService({
      repository: fakeRepository(store),
      transactions: fakeScope(store),
      now: () => timestamp(new Date(Date.UTC(2026, 10, 15, 10, 0, 0, tick++)).toISOString()),
      newId: newEntityId,
    });
  });
  const uut = async (): Promise<Uut> => {
    const result = await service.registerUut({ serialNumber: 'SN-1' });
    assert.ok(result.ok);
    return result.value;
  };
  const open = async (u?: Uut): Promise<InvestigationCase> => {
    const result = await service.openCase({ uut: refOf(u ?? (await uut())) });
    assert.ok(result.ok);
    return result.value;
  };
  const attemptOf = async (u: Uut, stage = 'IST'): Promise<TestAttempt> => {
    const result = await service.registerTestAttempt({ uutId: u.id, stage });
    assert.ok(result.ok);
    return result.value;
  };

  describe('UUT and TestAttempt', () => {
    it('registers and retrieves a UUT, with a creation timestamp', async () => {
      const created = await uut();
      assert.deepEqual(await service.getUut(created.id), created);
      assert.ok(created.createdAt);
    });

    it('registers and retrieves an attempt of an existing UUT, with a registration timestamp', async () => {
      const u = await uut();
      const result = await service.registerTestAttempt({
        uutId: u.id,
        stage: 'SAT',
        externalExecutionReference: 'run-9',
      });
      assert.ok(result.ok);
      assert.equal(result.value.stage, 'SAT');
      assert.equal(result.value.uut.id, u.id);
      assert.deepEqual(await service.getTestAttempt(result.value.id), result.value);
    });

    it('rejects a stage outside the vocabulary and stores nothing', async () => {
      const u = await uut();
      const result = await service.registerTestAttempt({ uutId: u.id, stage: 'FCT' });
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_test_stage');
      assert.equal(store.attempts.size, 0);
    });

    it('reports an attempt for an unknown UUT', async () => {
      const result = await service.registerTestAttempt({
        uutId: newEntityId<'UUT'>() as UutId,
        stage: 'IST',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_not_found');
    });

    it('reports a case for an unknown UUT', async () => {
      const ghost = createEntityRef('UUT', newEntityId<'UUT'>());
      assert.ok(ghost.ok);
      const result = await service.openCase({ uut: ghost.value });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_not_found');
      assert.equal(store.cases.size, 0);
    });
  });

  describe('cases', () => {
    it('opens and stores a case', async () => {
      const c = await open();
      assert.equal(store.cases.size, 1);
      assert.deepEqual(await service.getCase(c.id), { ...c, version: 1 });
    });
  });

  describe('linking (expectedVersion is mandatory, Owner decision Q6)', () => {
    const link = (c: InvestigationCase, a: TestAttempt, role: string, expectedVersion: number) =>
      service.linkAttempt({ caseId: c.id, attemptId: a.id, role, expectedVersion });
    const versionOf = (c: InvestigationCase) => store.versions.get(c.id);

    it('links a new attempt at the matching version and returns the new version', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await link(c, a, 'INITIAL_FAILURE', 1);
      assert.ok(result.ok && result.value.version === 2 && result.value.created);
      assert.equal((await service.getCase(c.id))?.links.length, 1);
    });

    it('matching version and identical link: idempotent success, no write, no version increment', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const first = await link(c, a, 'RETEST', 1);
      assert.ok(first.ok);
      const savesBefore = store.saves;
      const again = await link(c, a, 'RETEST', 2);
      assert.ok(again.ok && !again.value.created && again.value.version === 2);
      assert.equal(again.value.link.linkedAt, first.value.link.linkedAt, 'original link returned');
      assert.equal(store.saves, savesBefore, 'nothing was saved');
      assert.equal(versionOf(c), 2);
    });

    it('stale version beats idempotency: an identical, already existing link still gets concurrency_conflict', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      assert.ok((await link(c, a, 'RETEST', 1)).ok);
      const stale = await link(c, a, 'RETEST', 1); // the link exists, but the caller still believes version 1
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(stale.error.details?.expectedVersion, 1);
      assert.equal(stale.error.details?.actualVersion, 2);
      assert.equal(versionOf(c), 2, 'nothing changed');
    });

    it('stale version for a new link: conflict, nothing stored, and no automatic retry', async () => {
      const u = await uut();
      const c = await open(u);
      const [a, b] = [await attemptOf(u), await attemptOf(u)];
      assert.ok((await link(c, a, 'INITIAL_FAILURE', 1)).ok);
      const savesBefore = store.saves;
      const stale = await link(c, b, 'RETEST', 1);
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(
        store.saves,
        savesBefore,
        'the stale request never reached the repository, and was not retried',
      );
      assert.equal((await service.getCase(c.id))?.links.length, 1);
    });

    it('a version from the future is also a conflict, never a success', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await link(c, a, 'RETEST', 7);
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.equal(versionOf(c), 1);
    });

    it('treats another role for the same attempt as a new link and advances the version', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      await link(c, a, 'INITIAL_FAILURE', 1);
      const second = await link(c, a, 'SUPPORTING', 2);
      assert.ok(second.ok && second.value.created && second.value.version === 3);
    });

    it('rejects an unknown role and changes nothing', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await link(c, a, 'retest', 1);
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_link_role');
      assert.equal(versionOf(c), 1);
    });

    it('reports an unknown case', async () => {
      const u = await uut();
      const a = await attemptOf(u);
      const result = await service.linkAttempt({
        caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
        attemptId: a.id,
        role: 'CONTEXT',
        expectedVersion: 1,
      });
      assert.ok(!result.ok && result.error.code === 'investigation.case_not_found');
    });

    it('reports an unknown attempt', async () => {
      const c = await open();
      const result = await service.linkAttempt({
        caseId: c.id,
        attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
        role: 'CONTEXT',
        expectedVersion: 1,
      });
      assert.ok(!result.ok && result.error.code === 'investigation.attempt_not_found');
      assert.equal(versionOf(c), 1);
    });

    it('validates existence and same-UUT ownership BEFORE the version: a cross-UUT request is uut_mismatch even when stale', async () => {
      const c = await open();
      const a = await attemptOf(await uut());
      const result = await link(c, a, 'SUPPORTING', 99);
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.equal((await service.getCase(c.id))?.links.length, 0);
      assert.equal(versionOf(c), 1);
    });

    it('surfaces a repository concurrency conflict as an error result and rolls back', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      store.failNextSave = 'conflict';
      const result = await link(c, a, 'RETEST', 1);
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.equal((await service.getCase(c.id))?.links.length, 0);
    });

    it('rolls back and rethrows an unexpected failure instead of treating it as success', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      store.failNextSave = 'throw';
      await assert.rejects(link(c, a, 'RETEST', 1), /exploded/);
      assert.equal((await service.getCase(c.id))?.links.length, 0);
    });
  });

  /**
   * Characterisation (S0-06 WP-01, specification 7.2 and 7.5). These pass on the pre-FU-3 service and must still pass
   * after runtime `expectedVersion` validation and version exhaustion exist: the earlier checks keep their precedence,
   * and the existing behaviour at the maximum version does not change.
   */
  describe('characterisation: precedence FU-3 must preserve', () => {
    const MAX_VERSION = 2147483647;
    const asVersion = (value: unknown) => value as number;
    // A valid-but-stale number, and values that are not valid versions at all. The earlier checks must win over each.
    const versions: Array<[string, unknown]> = [
      ['a stale number', 99],
      ['NaN', Number.NaN],
      ['a numeric string', '3'],
      ['an omitted value', undefined],
    ];

    for (const [label, value] of versions) {
      it(`reports an unknown role before the version (${label})`, async () => {
        const u = await uut();
        const c = await open(u);
        const a = await attemptOf(u);
        const result = await service.linkAttempt({
          caseId: c.id,
          attemptId: a.id,
          role: 'retest',
          expectedVersion: asVersion(value),
        });
        assert.ok(!result.ok && result.error.code === 'investigation.invalid_link_role');
        assert.equal(store.versions.get(c.id), 1);
      });

      it(`reports an unknown case before the version (${label})`, async () => {
        const a = await attemptOf(await uut());
        const result = await service.linkAttempt({
          caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
          attemptId: a.id,
          role: 'CONTEXT',
          expectedVersion: asVersion(value),
        });
        assert.ok(!result.ok && result.error.code === 'investigation.case_not_found');
      });

      it(`reports an unknown attempt before the version (${label})`, async () => {
        const c = await open();
        const result = await service.linkAttempt({
          caseId: c.id,
          attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
          role: 'CONTEXT',
          expectedVersion: asVersion(value),
        });
        assert.ok(!result.ok && result.error.code === 'investigation.attempt_not_found');
      });

      it(`reports a cross-UUT pair before the version (${label})`, async () => {
        const c = await open();
        const foreign = await attemptOf(await uut());
        const result = await service.linkAttempt({
          caseId: c.id,
          attemptId: foreign.id,
          role: 'SUPPORTING',
          expectedVersion: asVersion(value),
        });
        assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
        assert.equal(store.versions.get(c.id), 1);
      });
    }

    it('at the maximum version a matching duplicate is still an idempotent success and a stale value is still a conflict', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      assert.ok(
        (
          await service.linkAttempt({
            caseId: c.id,
            attemptId: a.id,
            role: 'RETEST',
            expectedVersion: 1,
          })
        ).ok,
      );
      store.versions.set(c.id, MAX_VERSION); // test-only seeding of the stored version
      const savesBefore = store.saves;
      const duplicate = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: MAX_VERSION,
      });
      assert.ok(
        duplicate.ok && !duplicate.value.created && duplicate.value.version === MAX_VERSION,
      );
      assert.equal(store.saves, savesBefore, 'nothing was saved');
      const stale = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: MAX_VERSION - 1,
      });
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(stale.error.details?.expectedVersion, MAX_VERSION - 1);
      assert.equal(stale.error.details?.actualVersion, MAX_VERSION);
    });
  });

  /** S0-06 FU-3 step 5 (specification 7.3, 7.4.2, 7.5.1 and 7.5.2). */
  describe('runtime expectedVersion validation (FU-3)', () => {
    type Reason = 'not_a_number' | 'not_a_safe_integer' | 'out_of_range';
    const cases: Array<[string, unknown, Reason, string]> = [
      ["string '3'", '3', 'not_a_number', 'string'],
      ['empty string', '', 'not_a_number', 'string'],
      ['bigint 3n', 3n, 'not_a_number', 'bigint'],
      ['true', true, 'not_a_number', 'boolean'],
      ['false', false, 'not_a_number', 'boolean'],
      ['boxed Number(3)', new Number(3), 'not_a_number', 'object'],
      ['undefined', undefined, 'not_a_number', 'undefined'],
      ['null', null, 'not_a_number', 'null'],
      ['a Symbol', Symbol('v'), 'not_a_number', 'symbol'],
      ['a function', () => 3, 'not_a_number', 'function'],
      ['an array', [3], 'not_a_number', 'object'],
      ['an object', { version: 3 }, 'not_a_number', 'object'],
      ['NaN', Number.NaN, 'not_a_safe_integer', 'number'],
      ['Infinity', Number.POSITIVE_INFINITY, 'not_a_safe_integer', 'number'],
      ['-Infinity', Number.NEGATIVE_INFINITY, 'not_a_safe_integer', 'number'],
      ['a fraction 2.5', 2.5, 'not_a_safe_integer', 'number'],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1, 'not_a_safe_integer', 'number'],
      ['zero', 0, 'out_of_range', 'number'],
      ['negative zero', -0, 'out_of_range', 'number'],
      ['a negative number', -1, 'out_of_range', 'number'],
      ['MAX + 1', 2147483648, 'out_of_range', 'number'],
    ];
    const sendWith = async (value: unknown) => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const savesBefore = store.saves;
      const result = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: value as number,
      });
      return { c, result, savesBefore };
    };

    for (const [label, value, reason, actualType] of cases) {
      it(`rejects ${label} with ${reason} and writes nothing`, async () => {
        const { c, result, savesBefore } = await sendWith(value);
        assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
        const details = result.error.details as Record<string, unknown>;
        assert.deepEqual(details, { reason, minimum: 1, maximum: 2147483647, actualType });
        assert.deepEqual(Object.keys(details).sort(), [
          'actualType',
          'maximum',
          'minimum',
          'reason',
        ]);
        assert.equal(store.saves, savesBefore, 'the repository was not called to save');
        assert.equal(store.versions.get(c.id), 1);
        assert.equal((await service.getCase(c.id))?.links.length, 0);
      });
    }

    it('rejects the omitted property exactly like undefined', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
      } as unknown as Parameters<typeof service.linkAttempt>[0]);
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
      assert.deepEqual(result.error.details, {
        reason: 'not_a_number',
        minimum: 1,
        maximum: 2147483647,
        actualType: 'undefined',
      });
    });

    it('never echoes the raw input: the message is fixed text and details are the four fixed keys', async () => {
      const probes: Array<[unknown, Reason, string]> = [
        [2.5, 'not_a_safe_integer', 'number'],
        [-1, 'out_of_range', 'number'],
        [2147483648, 'out_of_range', 'number'],
        [Number.MAX_SAFE_INTEGER + 1, 'not_a_safe_integer', 'number'],
        ['secret-token-123', 'not_a_number', 'string'],
        [7n, 'not_a_number', 'bigint'],
      ];
      const messages = new Set<string>();
      for (const [value, reason, actualType] of probes) {
        const { result } = await sendWith(value);
        assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
        assert.deepEqual(result.error.details, {
          reason,
          minimum: 1,
          maximum: 2147483647,
          actualType,
        });
        messages.add(result.error.message);
        assert.ok(!result.error.message.includes('secret-token-123'));
        assert.ok(!JSON.stringify(result.error.details).includes('secret-token-123'));
      }
      assert.equal(messages.size, 1, 'the message does not vary with the input');
    });

    it('accepts the smallest and largest valid values as input (they then take the existing path)', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const atMinimum = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: 1,
      });
      assert.ok(atMinimum.ok && atMinimum.value.created);
      const atMaximum = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'CONTEXT',
        expectedVersion: 2147483647,
      });
      assert.ok(
        !atMaximum.ok && atMaximum.error.code === 'investigation.concurrency_conflict',
        'a valid but stale value is a conflict, not a validation error',
      );
    });

    it('a valid stale value still beats an identical existing link', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      assert.ok(
        (
          await service.linkAttempt({
            caseId: c.id,
            attemptId: a.id,
            role: 'RETEST',
            expectedVersion: 1,
          })
        ).ok,
      );
      const stale = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: 1,
      });
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(stale.error.details?.actualVersion, 2);
    });

    it('an invalid value is also rejected when the link already exists (validation precedes the comparison and the duplicate no-op)', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      assert.ok(
        (
          await service.linkAttempt({
            caseId: c.id,
            attemptId: a.id,
            role: 'RETEST',
            expectedVersion: 1,
          })
        ).ok,
      );
      const result = await service.linkAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
        expectedVersion: '2' as unknown as number,
      });
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
    });
  });

  /** S0-06 FU-3 step 8 (specification 7.4.3, 7.5.3 and 7.7). The fake store has no integer limit; the service must stop first. */
  describe('version exhaustion (FU-3)', () => {
    const MAX_VERSION = 2147483647;
    const linkAt = (c: InvestigationCase, a: TestAttempt, role: string, expectedVersion: number) =>
      service.linkAttempt({ caseId: c.id, attemptId: a.id, role, expectedVersion });
    const caseAtMaximum = async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      assert.ok((await linkAt(c, a, 'RETEST', 1)).ok);
      store.versions.set(c.id, MAX_VERSION); // test-only seeding of the stored version
      return { u, c, a };
    };

    it('a new link at the maximum version returns version_exhausted and never reaches save', async () => {
      const { u, c } = await caseAtMaximum();
      const other = await attemptOf(u);
      const savesBefore = store.saves;
      const result = await linkAt(c, other, 'INITIAL_FAILURE', MAX_VERSION);
      assert.ok(!result.ok && result.error.code === 'investigation.version_exhausted');
      assert.deepEqual(result.error.details, {
        actualVersion: MAX_VERSION,
        maximumVersion: MAX_VERSION,
      });
      assert.equal(store.saves, savesBefore, 'no write was attempted');
      assert.equal(store.versions.get(c.id), MAX_VERSION);
      assert.equal((await service.getCase(c.id))?.links.length, 1);
    });

    it('another role for an already linked attempt is a new link and is also exhausted', async () => {
      const { c, a } = await caseAtMaximum();
      const savesBefore = store.saves;
      const result = await linkAt(c, a, 'SUPPORTING', MAX_VERSION);
      assert.ok(!result.ok && result.error.code === 'investigation.version_exhausted');
      assert.equal(store.saves, savesBefore);
    });

    it('a matching duplicate at the maximum stays ok with created false and writes nothing', async () => {
      const { c, a } = await caseAtMaximum();
      const savesBefore = store.saves;
      const result = await linkAt(c, a, 'RETEST', MAX_VERSION);
      assert.ok(result.ok && !result.value.created && result.value.version === MAX_VERSION);
      assert.equal(store.saves, savesBefore);
    });

    it('a stale value at the maximum is a service-shape conflict, not an exhaustion', async () => {
      const { u, c } = await caseAtMaximum();
      const other = await attemptOf(u);
      const result = await linkAt(c, other, 'CONTEXT', MAX_VERSION - 1);
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.deepEqual(result.error.details, {
        expectedVersion: MAX_VERSION - 1,
        actualVersion: MAX_VERSION,
      });
    });

    it('MAX + 1 is invalid input, not an exhaustion', async () => {
      const { u, c } = await caseAtMaximum();
      const other = await attemptOf(u);
      const result = await linkAt(c, other, 'CONTEXT', MAX_VERSION + 1);
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
    });

    it('the last increment is allowed: from MAX - 1 a new link reaches MAX, the next new link is exhausted', async () => {
      const u = await uut();
      const c = await open(u);
      const [a, b] = [await attemptOf(u), await attemptOf(u)];
      store.versions.set(c.id, MAX_VERSION - 1);
      const last = await linkAt(c, a, 'INITIAL_FAILURE', MAX_VERSION - 1);
      assert.ok(last.ok && last.value.created && last.value.version === MAX_VERSION);
      const next = await linkAt(c, b, 'RETEST', MAX_VERSION);
      assert.ok(!next.ok && next.error.code === 'investigation.version_exhausted');
      const repeat = await linkAt(c, a, 'INITIAL_FAILURE', MAX_VERSION - 1);
      assert.ok(!repeat.ok && repeat.error.code === 'investigation.concurrency_conflict');
    });
  });

  /**
   * Regression (independent review of WP-01): `expectedVersion` is read once, at step 5, and that single value is the
   * one validated, compared and reported. A JavaScript accessor can answer differently on each read.
   */
  describe('expectedVersion is read exactly once (FU-3)', () => {
    const accessorCommand = (
      c: InvestigationCase,
      a: TestAttempt,
      role: string,
      answers: unknown[],
    ) => {
      const counter = { reads: 0 };
      const command = {
        caseId: c.id,
        attemptId: a.id,
        role,
        get expectedVersion(): number {
          const answer = answers[Math.min(counter.reads, answers.length - 1)];
          counter.reads += 1;
          return answer as number;
        },
      };
      return { command, counter };
    };

    it('validates, compares and reports the same captured value (first read 2, later reads 1, case at version 1)', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const { command, counter } = accessorCommand(c, a, 'RETEST', [2, 1]);
      const savesBefore = store.saves;
      const result = await service.linkAttempt(command);
      assert.equal(counter.reads, 1, 'the accessor was read exactly once');
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.deepEqual(result.error.details, { expectedVersion: 2, actualVersion: 1 });
      assert.equal(store.saves, savesBefore, 'the repository was never asked to save');
      assert.equal(store.versions.get(c.id), 1);
      assert.equal((await service.getCase(c.id))?.links.length, 0);
    });

    it('an invalid captured value is rejected from that one read (first read invalid, later reads valid)', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const { command, counter } = accessorCommand(c, a, 'RETEST', ['3', 1]);
      const result = await service.linkAttempt(command);
      assert.equal(counter.reads, 1);
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
      assert.equal(store.versions.get(c.id), 1);
    });

    it('earlier validation failures never read expectedVersion', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const foreign = await attemptOf(await uut());
      const badRole = accessorCommand(c, a, 'retest', [1]);
      const noCase = accessorCommand(
        { ...c, id: newEntityId<'InvestigationCase'>() as InvestigationCaseId },
        a,
        'RETEST',
        [1],
      );
      const noAttempt = accessorCommand(
        c,
        { ...a, id: newEntityId<'TestAttempt'>() as TestAttemptId },
        'RETEST',
        [1],
      );
      const crossUut = accessorCommand(c, foreign, 'RETEST', [1]);
      assert.ok(!(await service.linkAttempt(badRole.command)).ok);
      assert.ok(!(await service.linkAttempt(noCase.command)).ok);
      assert.ok(!(await service.linkAttempt(noAttempt.command)).ok);
      assert.ok(!(await service.linkAttempt(crossUut.command)).ok);
      for (const { counter } of [badRole, noCase, noAttempt, crossUut]) {
        assert.equal(counter.reads, 0, 'expectedVersion is not read before step 5');
      }
    });
  });
});
