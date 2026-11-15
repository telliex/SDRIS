import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  createEntityRef,
  err,
  newEntityId,
  ok,
  parseTimestamp,
  createError,
  type Result,
  type Timestamp,
} from '@sdris/shared-kernel';
import type { InvestigationCase, InvestigationCaseId, UutRef } from '../domain/investigation-case';
import { createInvestigationService, type InvestigationService } from './investigation-service';
import type { InvestigationRepository, RepositoryError } from './ports/investigation-repository';
import type { TransactionScope, TransactionToken } from './ports/transaction-scope';

/** In-memory stand-ins for the ports. Real PostgreSQL behaviour is covered by the integration tests. */
class FakeStore {
  cases = new Map<string, InvestigationCase>();
  versions = new Map<string, number>();
  failNextSave: 'conflict' | 'throw' | undefined;
}
const fakeScope = (store: FakeStore): TransactionScope => ({
  async run(work) {
    const snapshot = { cases: new Map(store.cases), versions: new Map(store.versions) };
    try {
      return await work({} as TransactionToken);
    } catch (error) {
      store.cases = snapshot.cases;
      store.versions = snapshot.versions;
      throw error;
    }
  },
});
const fakeRepository = (store: FakeStore): InvestigationRepository => ({
  async add(c) {
    if (store.cases.has(c.id)) {
      return err(
        createError({ code: 'investigation.case_already_exists' as const, message: 'exists' }),
      );
    }
    store.cases.set(c.id, c);
    store.versions.set(c.id, 1);
    return ok(undefined);
  },
  async get(id) {
    const stored = store.cases.get(id);
    return stored ? { ...stored, version: store.versions.get(id)! } : undefined;
  },
  async save(c): Promise<Result<{ version: number }, RepositoryError>> {
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

const timestamp = (value: string): Timestamp => {
  const parsed = parseTimestamp(value);
  if (!parsed.ok) throw new Error('bad test timestamp');
  return parsed.value;
};
const uut = (): UutRef => {
  const ref = createEntityRef('UUT', newEntityId<'UUT'>());
  if (!ref.ok) throw new Error('bad ref');
  return ref.value;
};

describe('InvestigationService', () => {
  let store: FakeStore;
  let service: InvestigationService;
  beforeEach(() => {
    store = new FakeStore();
    service = createInvestigationService({
      repository: fakeRepository(store),
      transactions: fakeScope(store),
      now: () => timestamp('2026-11-15T10:00:00.000Z'),
      newId: newEntityId,
    });
  });
  const open = async (u: UutRef = uut()): Promise<InvestigationCase> => {
    const result = await service.openCase({ uut: u });
    assert.ok(result.ok);
    return result.value;
  };

  it('opens and stores a case', async () => {
    const c = await open();
    assert.equal(store.cases.size, 1);
    assert.deepEqual(await service.getCase(c.id), { ...c, version: 1 });
  });

  it('records an observation and returns the new version', async () => {
    const c = await open();
    const result = await service.recordObservation({
      caseId: c.id,
      uut: c.uut,
      description: 'fan stalled',
    });
    assert.ok(result.ok && result.value.version === 2);
    assert.equal((await service.getCase(c.id))?.observations.length, 1);
  });

  it('reports an unknown case', async () => {
    const result = await service.recordObservation({
      caseId: newEntityId<'InvestigationCase'>() as InvestigationCaseId,
      uut: uut(),
      description: 'x',
    });
    assert.ok(!result.ok && result.error.code === 'investigation.case_not_found');
  });

  it('rejects a cross-UUT observation and changes nothing', async () => {
    const c = await open();
    const result = await service.recordObservation({
      caseId: c.id,
      uut: uut(),
      description: 'wrong unit',
    });
    assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
    assert.equal((await service.getCase(c.id))?.observations.length, 0);
    assert.equal(store.versions.get(c.id), 1);
  });

  it('surfaces a concurrency conflict as an error result and rolls back', async () => {
    const c = await open();
    store.failNextSave = 'conflict';
    const result = await service.recordObservation({ caseId: c.id, uut: c.uut, description: 'x' });
    assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
    assert.equal((await service.getCase(c.id))?.observations.length, 0);
  });

  it('rolls back and rethrows an unexpected failure', async () => {
    const c = await open();
    store.failNextSave = 'throw';
    await assert.rejects(
      service.recordObservation({ caseId: c.id, uut: c.uut, description: 'x' }),
      /exploded/,
    );
    assert.equal((await service.getCase(c.id))?.observations.length, 0);
  });
});
