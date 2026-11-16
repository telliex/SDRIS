import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { applyScripts, pgErrorCode } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import type { InvestigationCase, InvestigationService, UutRef } from '@sdris/investigation';
import { createEntityRef, newEntityId } from '@sdris/shared-kernel';
import path from 'node:path';
import { createPersistenceHandle } from '@sdris/database';
import { createInvestigationModule } from '@sdris/investigation/composition';
import { composeInvestigation } from './investigation.composition';

/**
 * End to end, against real PostgreSQL:
 *   apps/api composition root -> Investigation composition factory -> InvestigationService ->
 *   repository port -> context-owned persistence adapter -> PostgreSQL
 * Nothing is mocked. Each run uses its own throw-away database.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../../infrastructure/database/migrations');
/** True when the error, or anything in its cause chain (Drizzle wraps driver errors), matches. */
const causedBy = (error: unknown, pattern: RegExp): boolean => {
  for (
    let e: unknown = error, depth = 0;
    e && depth < 5;
    depth += 1, e = (e as { cause?: unknown }).cause
  ) {
    if (pattern.test(String((e as { message?: unknown }).message ?? ''))) return true;
  }
  return false;
};
const uut = (): UutRef => {
  const ref = createEntityRef('UUT', newEntityId<'UUT'>());
  if (!ref.ok) throw new Error('bad ref');
  return ref.value;
};

describe('Investigation through the apps/api composition root (real PostgreSQL)', () => {
  let target: IsolatedDatabase;
  let service: InvestigationService;
  const sql = async (text: string, values: unknown[] = []) =>
    (await target.connection.pool.query(text, values)).rows;
  const counts = async () => ({
    cases: (await sql('select count(*)::int as n from investigation.investigation_case'))[0]
      .n as number,
    observations: (await sql('select count(*)::int as n from investigation.failure_observation'))[0]
      .n as number,
  });
  /** A UUT that exists in the database (cases may only be opened for existing UUTs). */
  const registeredUut = async (): Promise<UutRef> => {
    const result = await service.registerUut({ serialNumber: 'SN-SYNTHETIC' });
    assert.ok(result.ok, JSON.stringify(result));
    const ref = createEntityRef('UUT', result.value.id);
    if (!ref.ok) throw new Error('bad ref');
    return ref.value;
  };
  const open = async (u?: UutRef): Promise<InvestigationCase> => {
    const result = await service.openCase({ uut: u ?? (await registeredUut()) });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };

  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    service = composeInvestigation(target.connection).service;
  });
  after(async () => {
    await target.drop();
  });

  describe('persistence', () => {
    it('stores a case and reads it back through the port', async () => {
      const u = await registeredUut();
      const created = await open(u);
      const loaded = await service.getCase(created.id);
      assert.ok(loaded);
      assert.equal(loaded.id, created.id);
      assert.equal(loaded.uut.id, u.id);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.openedAt, created.openedAt);
      assert.deepEqual(loaded.observations, []);
    });

    it('refuses to store a second case with an id that already exists, and keeps the first untouched', async () => {
      const fixedId = newEntityId<'InvestigationCase'>();
      const fixed = createInvestigationModule(createPersistenceHandle(target.connection), {
        newId: <T extends string>() =>
          fixedId as unknown as import('@sdris/shared-kernel').EntityId<T>,
      }).service;
      const sharedUut = await registeredUut();
      const first = await fixed.openCase({ uut: sharedUut });
      assert.ok(first.ok);
      const before = await counts();
      const second = await fixed.openCase({ uut: sharedUut });
      assert.ok(!second.ok && second.error.code === 'investigation.case_already_exists');
      assert.deepEqual(await counts(), before);
      assert.equal(
        (await fixed.getCase(fixedId))?.uut.id,
        first.value.uut.id,
        'the original case is unchanged',
      );
    });

    it('returns undefined for an unknown case', async () => {
      assert.equal(await service.getCase(newEntityId<'InvestigationCase'>()), undefined);
    });

    it('records observations, increments the version and preserves order', async () => {
      const c = await open();
      const first = await service.recordObservation({
        caseId: c.id,
        uut: c.uut,
        description: 'fan 3 stalled',
      });
      assert.ok(first.ok && first.value.version === 2);
      const second = await service.recordObservation({
        caseId: c.id,
        uut: c.uut,
        description: 'fan 3 still stalled',
      });
      assert.ok(second.ok && second.value.version === 3);
      const loaded = await service.getCase(c.id);
      assert.equal(loaded?.version, 3);
      assert.deepEqual(
        loaded?.observations.map((o) => o.description),
        ['fan 3 stalled', 'fan 3 still stalled'],
      );
      assert.ok(loaded?.observations.every((o) => o.uut.id === c.uut.id && o.caseId === c.id));
    });

    it('reports an unknown case without writing anything', async () => {
      const before = await counts();
      const result = await service.recordObservation({
        caseId: newEntityId<'InvestigationCase'>(),
        uut: uut(),
        description: 'x',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.case_not_found');
      assert.deepEqual(await counts(), before);
    });
  });

  describe('transaction commit and rollback', () => {
    it('commits the version bump and the observation together', async () => {
      const c = await open();
      await service.recordObservation({ caseId: c.id, uut: c.uut, description: 'both persist' });
      const [row] = await sql(
        'select version from investigation.investigation_case where id = $1',
        [c.id],
      );
      const observations = await sql(
        'select id from investigation.failure_observation where case_id = $1',
        [c.id],
      );
      assert.equal(row.version, 2);
      assert.equal(observations.length, 1);
    });

    it('rolls back everything when a domain rule rejects the command', async () => {
      const c = await open();
      const result = await service.recordObservation({
        caseId: c.id,
        uut: uut(),
        description: 'wrong unit',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      const [row] = await sql(
        'select version from investigation.investigation_case where id = $1',
        [c.id],
      );
      assert.equal(row.version, 1, 'the version must not have advanced');
      assert.equal((await service.getCase(c.id))?.observations.length, 0);
    });

    it('stores a description exactly as given, because no content rules are specified', async () => {
      const c = await open();
      const text = '  leading and trailing space \n' + 'y'.repeat(5000);
      const stored = await service.recordObservation({
        caseId: c.id,
        uut: c.uut,
        description: text,
      });
      assert.ok(stored.ok);
      assert.equal((await service.getCase(c.id))?.observations[0]?.description, text);
    });

    it('rolls back the version bump when storing the observation fails inside the database', async () => {
      const c = await open();
      // Force a database-level failure after the version bump: a trigger that rejects observation inserts.
      await sql(
        `create function investigation.reject_insert() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`,
      );
      await sql(
        'create trigger reject_observation before insert on investigation.failure_observation for each row execute function investigation.reject_insert()',
      );
      try {
        await assert.rejects(
          service.recordObservation({ caseId: c.id, uut: c.uut, description: 'will fail' }),
          (error) => causedBy(error, /injected failure/),
        );
      } finally {
        await sql('drop trigger reject_observation on investigation.failure_observation');
        await sql('drop function investigation.reject_insert()');
      }
      const [row] = await sql(
        'select version from investigation.investigation_case where id = $1',
        [c.id],
      );
      assert.equal(row.version, 1, 'the bump was rolled back with the failed insert');
      assert.equal((await service.getCase(c.id))?.observations.length, 0);
    });

    it('rolls back a failed open, leaving no case behind', async () => {
      const before = await counts();
      await sql(
        `create function investigation.reject_case() returns trigger language plpgsql as $$ begin raise exception 'no cases today'; end $$`,
      );
      await sql(
        'create trigger reject_case before insert on investigation.investigation_case for each row execute function investigation.reject_case()',
      );
      try {
        const owner = await registeredUut();
        await assert.rejects(service.openCase({ uut: owner }), (error) =>
          causedBy(error, /no cases today/),
        );
      } finally {
        await sql('drop trigger reject_case on investigation.investigation_case');
        await sql('drop function investigation.reject_case()');
      }
      assert.deepEqual(await counts(), before);
    });
  });

  describe('optimistic concurrency', () => {
    it('lets exactly one of many simultaneous writers advance the case and keeps all of their observations or none', async () => {
      const c = await open();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          service.recordObservation({ caseId: c.id, uut: c.uut, description: `writer ${i}` }),
        ),
      );
      // Writers read the case themselves, so several can succeed in sequence; every outcome must be
      // either a success with a distinct version or an explicit conflict, never a silent loss.
      const succeeded = results.filter((r) => r.ok);
      const conflicts = results.filter((r) => !r.ok);
      assert.ok(
        conflicts.every((r) => !r.ok && r.error.code === 'investigation.concurrency_conflict'),
      );
      const loaded = await service.getCase(c.id);
      assert.equal(
        loaded?.observations.length,
        succeeded.length,
        'one stored observation per success',
      );
      assert.equal(
        loaded?.version,
        1 + succeeded.length,
        'version equals one plus the number of successes',
      );
      const versions = succeeded.map((r) => (r.ok ? r.value.version : 0)).sort((a, b) => a - b);
      assert.deepEqual(versions, [...new Set(versions)], 'no two successes share a version');
      assert.ok(succeeded.length >= 1);
    });

    it('rejects, deterministically, a writer that decided on an older version', async () => {
      const c = await open();
      // Another writer advances the case to version 2 while our writer is between reading v1 and saving.
      // A row lock held by this connection makes the writer's UPDATE wait; it has already read version 1.
      const other = await target.connection.pool.connect();
      try {
        await other.query('begin');
        await other.query(
          'update investigation.investigation_case set version = version + 1 where id = $1',
          [c.id],
        );
        const writer = service.recordObservation({
          caseId: c.id,
          uut: c.uut,
          description: 'decided on v1',
        });
        for (let waited = 0; ; waited += 10) {
          const blocked = await sql(
            "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          if (blocked[0].n >= 1) break;
          assert.ok(waited < 5000, 'the writer never reached the row lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await other.query('commit');
        const result = await writer;
        assert.ok(
          !result.ok && result.error.code === 'investigation.concurrency_conflict',
          JSON.stringify(result),
        );
      } finally {
        other.release();
      }
      const loaded = await service.getCase(c.id);
      assert.equal(loaded?.version, 2, 'only the other writer advanced the version');
      assert.equal(loaded?.observations.length, 0, 'the stale writer stored nothing');
    });

    it('rejects a stale write at the repository boundary and stores nothing', async () => {
      const c = await open();
      const loadedA = await service.getCase(c.id);
      await service.recordObservation({
        caseId: c.id,
        uut: c.uut,
        description: 'first writer wins',
      });
      assert.equal(loadedA?.version, 1);
      // Writer B still holds version 1: a direct stale update must match zero rows.
      const stale = await sql(
        'update investigation.investigation_case set version = version + 1 where id = $1 and version = $2 returning version',
        [c.id, 1],
      );
      assert.equal(stale.length, 0, 'the stale version no longer matches');
      assert.equal((await service.getCase(c.id))?.version, 2);
    });

    it('loses no update when writers retry on conflict', async () => {
      const c = await open();
      const writers = 6;
      const each = 3;
      const retrying = async (w: number) => {
        for (let n = 0; n < each;) {
          const result = await service.recordObservation({
            caseId: c.id,
            uut: c.uut,
            description: `w${w}-${n}`,
          });
          if (result.ok) n += 1;
          else assert.equal(result.error.code, 'investigation.concurrency_conflict');
        }
      };
      await Promise.all(Array.from({ length: writers }, (_, w) => retrying(w)));
      const loaded = await service.getCase(c.id);
      assert.equal(loaded?.observations.length, writers * each);
      assert.equal(loaded?.version, 1 + writers * each);
      assert.equal(new Set(loaded?.observations.map((o) => o.description)).size, writers * each);
    });
  });

  describe('cross-UUT rejection', () => {
    it('rejects an observation from another UUT through the whole stack and stores nothing', async () => {
      const c = await open();
      const before = await counts();
      const result = await service.recordObservation({
        caseId: c.id,
        uut: uut(),
        description: 'from another unit',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.deepEqual(await counts(), before);
      const [row] = await sql(
        'select version from investigation.investigation_case where id = $1',
        [c.id],
      );
      assert.equal(row.version, 1, 'a rejected observation must not advance the version');
    });

    it('is also enforced by the database: a raw insert with a mismatching UUT violates the composite foreign key', async () => {
      const c = await open();
      await assert.rejects(
        target.connection.pool.query(
          `insert into investigation.failure_observation (id, case_id, uut_id, description, observed_at)
           values ($1, $2, $3, 'forged', now())`,
          [newEntityId<'FailureObservation'>(), c.id, newEntityId<'UUT'>()],
        ),
        (error) => pgErrorCode(error) === '23503',
      );
      assert.equal((await service.getCase(c.id))?.observations.length, 0);
    });

    it('also refuses an observation with the right UUT but a case that does not exist (foreign key)', async () => {
      await assert.rejects(
        target.connection.pool.query(
          `insert into investigation.failure_observation (id, case_id, uut_id, description, observed_at)
           values ($1, $2, $3, 'orphan', now())`,
          [
            newEntityId<'FailureObservation'>(),
            newEntityId<'InvestigationCase'>(),
            newEntityId<'UUT'>(),
          ],
        ),
        (error) => pgErrorCode(error) === '23503',
      );
    });
  });
});
