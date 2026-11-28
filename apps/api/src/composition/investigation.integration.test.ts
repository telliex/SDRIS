import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createPersistenceHandle } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import type { InvestigationService, UutRef } from '@sdris/investigation';
import { createInvestigationModule } from '@sdris/investigation/composition';
import { createEntityRef, newEntityId, type EntityId } from '@sdris/shared-kernel';
import { readTrustedEnvironment } from './identity';
import { composeInvestigation } from './investigation.composition';

/**
 * Case persistence end to end, against real PostgreSQL:
 *   apps/api composition root -> Investigation composition factory -> InvestigationService ->
 *   repository port -> context-owned persistence adapter -> PostgreSQL
 * Nothing is mocked. Each run uses its own throw-away database. Linking, UUT and TestAttempt behaviour (including
 * transactions, concurrency and same-UUT protection) is covered in investigation-links.integration.test.ts.
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

describe('Investigation case through the apps/api composition root (real PostgreSQL)', () => {
  let target: IsolatedDatabase;
  let service: InvestigationService;
  const sql = async (text: string, values: unknown[] = []) =>
    (await target.connection.pool.query(text, values)).rows;
  const counts = async () => ({
    cases: (await sql('select count(*)::int as n from investigation.investigation_case'))[0]
      .n as number,
    links: (await sql('select count(*)::int as n from investigation.case_test_attempt_link'))[0]
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

  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    service = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
    ).service;
  });
  after(async () => {
    await target.drop();
  });

  it('stores a case and reads it back through the port, with opened_at, version 1 and no links', async () => {
    const u = await registeredUut();
    const opened = await service.openCase({ uut: u });
    assert.ok(opened.ok);
    const loaded = await service.getCase(opened.value.id);
    assert.ok(loaded);
    assert.equal(loaded.id, opened.value.id);
    assert.equal(loaded.uut.id, u.id);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.openedAt, opened.value.openedAt);
    assert.deepEqual(loaded.links, []);
  });

  it('refuses to store a second case with an id that already exists, and keeps the first untouched', async () => {
    const fixedId = newEntityId<'InvestigationCase'>();
    const fixed = createInvestigationModule(createPersistenceHandle(target.connection), {
      newId: <T extends string>() => fixedId as unknown as EntityId<T>,
    }).service;
    const sharedUut = await registeredUut();
    const first = await fixed.openCase({ uut: sharedUut });
    assert.ok(first.ok);
    const before = await counts();
    const second = await fixed.openCase({ uut: sharedUut });
    assert.ok(!second.ok && second.error.code === 'investigation.case_already_exists');
    assert.deepEqual(await counts(), before);
    assert.equal(
      (await fixed.getCase(fixedId))?.openedAt,
      first.value.openedAt,
      'the original case is unchanged',
    );
  });

  it('returns undefined for an unknown case', async () => {
    assert.equal(await service.getCase(newEntityId<'InvestigationCase'>()), undefined);
  });

  it('rolls back a failed open, leaving no case behind', async () => {
    const owner = await registeredUut();
    const before = await counts();
    await sql(
      `create function investigation.reject_case() returns trigger language plpgsql as $$ begin raise exception 'no cases today'; end $$`,
    );
    await sql(
      'create trigger reject_case before insert on investigation.investigation_case for each row execute function investigation.reject_case()',
    );
    try {
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
