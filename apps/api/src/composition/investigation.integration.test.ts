import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createPersistenceHandle } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import type {
  AccessError,
  InvestigationService,
  RequestContext,
  UutRef,
} from '@sdris/investigation';
import { createInvestigationModule } from '@sdris/investigation/composition';
import {
  createEntityRef,
  newEntityId,
  type CorrelationId,
  type EntityId,
  type Result,
} from '@sdris/shared-kernel';
import { readTrustedEnvironment } from './identity';
import { syntheticPrincipalsFixture } from './identity/synthetic-principals.fixtures';
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
  let composed: ReturnType<typeof composeInvestigation>;
  let ctx: RequestContext;
  const securityEvents: unknown[] = [];
  /** Modules built directly with a custom clock or id generator still trust the same real issuer. */
  const identityOptions = () => ({
    actorResolver: composed.issuer.resolver,
    securityLog: { record: () => undefined },
  });
  // The reads return a Result since S0-06 Stage 2; these helpers keep the existing assertions on the value.
  const unwrap = <T>(result: Result<T, AccessError>): T => {
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const read = {
    getUut: async (id: Parameters<InvestigationService['getUut']>[1]) =>
      unwrap(await service.getUut(ctx, id)),
    getTestAttempt: async (id: Parameters<InvestigationService['getTestAttempt']>[1]) =>
      unwrap(await service.getTestAttempt(ctx, id)),
    getCase: async (id: Parameters<InvestigationService['getCase']>[1]) =>
      unwrap(await service.getCase(ctx, id)),
  };
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
    const result = await service.registerUut(ctx, { serialNumber: 'SN-SYNTHETIC' });
    assert.ok(result.ok, JSON.stringify(result));
    const ref = createEntityRef('UUT', result.value.id);
    if (!ref.ok) throw new Error('bad ref');
    return ref.value;
  };

  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    composed = composeInvestigation(
      target.connection,
      readTrustedEnvironment({ SDRIS_ENV: 'test', NODE_ENV: 'test' }),
      {
        principals: syntheticPrincipalsFixture,
        securityEvents: (event) => securityEvents.push(event),
      },
    );
    service = composed.service;
    const issued = composed.issuer.issue('fixture-engineer');
    assert.equal(issued.status, 'issued');
    ctx = {
      actor: (issued as { handle: RequestContext['actor'] }).handle,
      correlationId: randomUUID() as CorrelationId,
    };
  });
  after(async () => {
    await target.drop();
  });

  it('stores a case and reads it back through the port, with opened_at, version 1 and no links', async () => {
    const u = await registeredUut();
    const opened = await service.openCase(ctx, { uut: u });
    assert.ok(opened.ok);
    const loaded = await read.getCase(opened.value.id);
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
      ...identityOptions(),
      newId: <T extends string>() => fixedId as unknown as EntityId<T>,
    }).service;
    const sharedUut = await registeredUut();
    const first = await fixed.openCase(ctx, { uut: sharedUut });
    assert.ok(first.ok);
    const before = await counts();
    const second = await fixed.openCase(ctx, { uut: sharedUut });
    assert.ok(!second.ok && second.error.code === 'investigation.case_already_exists');
    assert.deepEqual(await counts(), before);
    assert.equal(
      unwrap(await fixed.getCase(ctx, fixedId))?.openedAt,
      first.value.openedAt,
      'the original case is unchanged',
    );
  });

  it('returns undefined for an unknown case', async () => {
    assert.equal(await read.getCase(newEntityId<'InvestigationCase'>()), undefined);
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
      await assert.rejects(service.openCase(ctx, { uut: owner }), (error) =>
        causedBy(error, /no cases today/),
      );
    } finally {
      await sql('drop trigger reject_case on investigation.investigation_case');
      await sql('drop function investigation.reject_case()');
    }
    assert.deepEqual(await counts(), before);
  });
});
