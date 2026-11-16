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

  describe('linking', () => {
    it('links an attempt and returns the new version', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'INITIAL_FAILURE',
      });
      assert.ok(result.ok && result.value.version === 2 && result.value.created);
      assert.equal((await service.getCase(c.id))?.links.length, 1);
    });

    it('is idempotent for an identical request: no write, no version increment', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const command = { caseId: c.id, attemptId: a.id, role: 'RETEST' };
      const first = await service.linkTestAttempt(command);
      assert.ok(first.ok);
      const savesBefore = store.saves;
      const again = await service.linkTestAttempt(command);
      assert.ok(again.ok && !again.value.created);
      assert.equal(again.value.version, 2, 'the version did not advance');
      assert.equal(again.value.link.linkedAt, first.value.link.linkedAt, 'original link returned');
      assert.equal(store.saves, savesBefore, 'nothing was saved');
      assert.equal(store.versions.get(c.id), 2);
    });

    it('treats another role for the same attempt as a new link and advances the version', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' });
      const second = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'SUPPORTING',
      });
      assert.ok(second.ok && second.value.created && second.value.version === 3);
    });

    it('rejects an unknown role and changes nothing', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'retest',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_link_role');
      assert.equal(store.versions.get(c.id), 1);
    });

    it('reports an unknown case', async () => {
      const u = await uut();
      const a = await attemptOf(u);
      const result = await service.linkTestAttempt({
        caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
        attemptId: a.id,
        role: 'CONTEXT',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.case_not_found');
    });

    it('reports an unknown attempt', async () => {
      const c = await open();
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: newEntityId<'TestAttempt'>() as TestAttemptId,
        role: 'CONTEXT',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.attempt_not_found');
      assert.equal(store.versions.get(c.id), 1);
    });

    it('rejects a cross-UUT link and changes nothing', async () => {
      const c = await open();
      const a = await attemptOf(await uut());
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'SUPPORTING',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.equal((await service.getCase(c.id))?.links.length, 0);
      assert.equal(store.versions.get(c.id), 1);
    });

    it('surfaces a concurrency conflict as an error result and rolls back', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      store.failNextSave = 'conflict';
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.equal((await service.getCase(c.id))?.links.length, 0);
    });

    it('never retries on its own: one conflict means exactly one save attempt', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      store.failNextSave = 'conflict';
      const before = store.saves;
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
      assert.equal(store.saves - before, 1);
    });

    it('rolls back and rethrows an unexpected failure', async () => {
      const u = await uut();
      const c = await open(u);
      const a = await attemptOf(u);
      store.failNextSave = 'throw';
      await assert.rejects(
        service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' }),
        /exploded/,
      );
      assert.equal((await service.getCase(c.id))?.links.length, 0);
    });
  });

  describe('observations (transitional, Q8)', () => {
    it('records an observation and returns the new version', async () => {
      const c = await open();
      const result = await service.recordObservation({
        caseId: c.id,
        uut: c.uut,
        description: 'fan stalled',
      });
      assert.ok(result.ok && result.value.version === 2);
    });

    it('rejects a cross-UUT observation and changes nothing', async () => {
      const c = await open();
      const other = refOf(await uut());
      const result = await service.recordObservation({
        caseId: c.id,
        uut: other,
        description: 'wrong unit',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.equal(store.versions.get(c.id), 1);
    });
  });
});
