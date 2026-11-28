import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createPersistenceHandle, pgErrorCode } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import type {
  AccessError,
  InvestigationCase,
  InvestigationService,
  RequestContext,
  TestAttempt,
  Uut,
} from '@sdris/investigation';
import { createInvestigationModule } from '@sdris/investigation/composition';
import {
  createEntityRef,
  newEntityId,
  parseTimestamp,
  type CorrelationId,
  type Result,
} from '@sdris/shared-kernel';
import { readTrustedEnvironment } from './identity';
import { syntheticPrincipalsFixture } from './identity/synthetic-principals.fixtures';
import { composeInvestigation } from './investigation.composition';

/**
 * UUT, TestAttempt, InvestigationCase and CaseTestAttemptLink through the whole stack, against real PostgreSQL:
 *   apps/api composition root -> composition factory -> service -> repository port -> adapter -> PostgreSQL.
 * Synthetic data only. Each run uses its own throw-away database.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../../infrastructure/database/migrations');
const RAW_FOREIGN_KEY = '23503';
const RAW_UNIQUE = '23505';
const RAW_CHECK = '23514';
const RAW_RESTRICT = '23001';

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

describe('Investigation links through the apps/api composition root (real PostgreSQL)', () => {
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
  const rawCode = async (text: string, values: unknown[] = []) => {
    try {
      await target.connection.pool.query(text, values);
      return undefined;
    } catch (error) {
      return pgErrorCode(error);
    }
  };
  const counts = async () => ({
    uuts: (await sql('select count(*)::int as n from investigation.uut'))[0].n as number,
    attempts: (await sql('select count(*)::int as n from investigation.test_attempt'))[0]
      .n as number,
    cases: (await sql('select count(*)::int as n from investigation.investigation_case'))[0]
      .n as number,
    links: (await sql('select count(*)::int as n from investigation.case_test_attempt_link'))[0]
      .n as number,
  });
  const caseVersion = async (id: string) =>
    (await sql('select version from investigation.investigation_case where id = $1', [id]))[0]
      .version as number;

  const uut = async (attributes: { serialNumber?: string; hostname?: string } = {}) => {
    const result = await service.registerUut(ctx, attributes);
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const refOf = (u: Uut) => {
    const ref = createEntityRef('UUT', u.id);
    if (!ref.ok) throw new Error('bad ref');
    return ref.value;
  };
  const attempt = async (u: Uut, stage = 'IST') => {
    const result = await service.registerTestAttempt(ctx, { uutId: u.id, stage });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const open = async (u: Uut): Promise<InvestigationCase> => {
    const result = await service.openCase(ctx, { uut: refOf(u) });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  /**
   * Links with the version the caller would currently see (a fresh read). Tests that are about versions pass
   * `expectedVersion` explicitly through `service.linkAttempt` instead.
   */
  const linkNow = async (input: { caseId: string; attemptId: string; role: string }) =>
    service.linkAttempt(ctx, {
      caseId: input.caseId as never,
      attemptId: input.attemptId as never,
      role: input.role,
      expectedVersion: await caseVersion(input.caseId),
    });
  /** Links asserting that the caller last saw the case at exactly `expectedVersion`. */
  const linkAt = (
    expectedVersion: number,
    input: { caseId: string; attemptId: string; role: string },
  ) =>
    service.linkAttempt(ctx, {
      caseId: input.caseId as never,
      attemptId: input.attemptId as never,
      role: input.role,
      expectedVersion,
    });
  /** A fresh UUT with one case and one attempt of that UUT. */
  const scenario = async () => {
    const u = await uut();
    return { u, c: await open(u), a: await attempt(u) };
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

  describe('UUT and TestAttempt persistence', () => {
    it('stores external identifiers exactly as supplied, and allows duplicates (not unique)', async () => {
      const a = await uut({ serialNumber: '  Sn-001 ', hostname: 'HostA' });
      const b = await uut({ serialNumber: '  Sn-001 ', hostname: 'HostA' });
      assert.notEqual(a.id, b.id);
      const loaded = await read.getUut(a.id);
      assert.equal(loaded?.serialNumber, '  Sn-001 ');
      assert.equal(loaded?.hostname, 'HostA');
      const [row] = await sql(
        'select serial_number, hostname from investigation.uut where id = $1',
        [a.id],
      );
      assert.deepEqual(row, { serial_number: '  Sn-001 ', hostname: 'HostA' });
    });

    it('keeps both identifiers optional and distinguishes an empty string from an absent value', async () => {
      const bare = await uut();
      assert.equal((await read.getUut(bare.id))?.serialNumber, undefined);
      const empty = await uut({ serialNumber: '' });
      assert.equal((await read.getUut(empty.id))?.serialNumber, '');
    });

    it('persists the timestamps of one injected application clock as UTC instants, and commands cannot override them', async () => {
      const instants = [
        '2026-11-15T08:00:00.123Z',
        '2026-11-15T08:00:01.456Z',
        '2026-11-15T08:00:02.789Z',
        '2026-11-15T08:00:03.012Z',
      ];
      let reads = 0;
      const clock = () => {
        const parsed = parseTimestamp(instants[reads] ?? instants.at(-1)!);
        reads += 1;
        if (!parsed.ok) throw new Error('bad clock');
        return parsed.value;
      };
      const timed = createInvestigationModule(createPersistenceHandle(target.connection), {
        ...identityOptions(),
        now: clock,
      }).service;
      const forged = '2001-01-01T00:00:00.000Z';
      // A caller trying to choose a timestamp: extra fields are not part of any command and are ignored.
      const u = await timed.registerUut(ctx, { createdAt: forged } as never);
      assert.ok(u.ok);
      const a = await timed.registerTestAttempt(ctx, {
        uutId: u.value.id,
        stage: 'IST',
        registeredAt: forged,
      } as never);
      assert.ok(a.ok);
      const opened = await timed.openCase(ctx, { uut: refOf(u.value), openedAt: forged } as never);
      assert.ok(opened.ok);
      const linked = await timed.linkAttempt(ctx, {
        caseId: opened.value.id,
        attemptId: a.value.id,
        role: 'RETEST',
        expectedVersion: 1,
        linkedAt: forged,
      } as never);
      assert.ok(linked.ok);
      assert.equal(u.value.createdAt, instants[0]);
      assert.equal(a.value.registeredAt, instants[1]);
      assert.equal(opened.value.openedAt, instants[2]);
      assert.equal(linked.value.link.linkedAt, instants[3]);
      // what is stored is exactly what the clock supplied, read back through the port, as UTC instants
      assert.equal((await read.getUut(u.value.id))?.createdAt, instants[0]);
      assert.equal((await read.getTestAttempt(a.value.id))?.registeredAt, instants[1]);
      const loaded = await read.getCase(opened.value.id);
      assert.equal(loaded?.openedAt, instants[2]);
      assert.equal(loaded?.links[0]?.linkedAt, instants[3]);
      const stored = await sql(
        `select to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created,
                to_char(l.linked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as linked
           from investigation.uut u, investigation.case_test_attempt_link l where u.id = $1 and l.case_id = $2`,
        [u.value.id, opened.value.id],
      );
      assert.deepEqual(stored[0], { created: instants[0], linked: instants[3] });
      const types = await sql(
        `select data_type from information_schema.columns
         where table_schema = 'investigation' and column_name in ('created_at','registered_at','opened_at','linked_at')`,
      );
      assert.equal(types.length, 4);
      assert.ok(types.every((t) => t.data_type === 'timestamp with time zone'));
    });

    it('returns undefined for an unknown UUT', async () => {
      assert.equal(await read.getUut(newEntityId<'UUT'>()), undefined);
    });

    it('registers an attempt with stage and an optional, non-unique external execution reference', async () => {
      const u = await uut();
      const first = await service.registerTestAttempt(ctx, {
        uutId: u.id,
        stage: 'SAT',
        externalExecutionReference: ' run-1 ',
      });
      const second = await service.registerTestAttempt(ctx, {
        uutId: u.id,
        stage: 'SAT',
        externalExecutionReference: ' run-1 ',
      });
      assert.ok(first.ok && second.ok);
      assert.notEqual(first.value.id, second.value.id);
      const loaded = await read.getTestAttempt(first.value.id);
      assert.deepEqual(loaded, first.value);
      assert.equal(loaded?.externalExecutionReference, ' run-1 ');
      assert.equal(loaded?.uut.id, u.id);
      assert.equal(await read.getTestAttempt(newEntityId<'TestAttempt'>()), undefined);
    });

    it('rejects an invalid stage before anything is written', async () => {
      const u = await uut();
      const before = await counts();
      const result = await service.registerTestAttempt(ctx, { uutId: u.id, stage: 'FCT' });
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_test_stage');
      assert.deepEqual(await counts(), before);
    });

    it('reports an unknown UUT for an attempt or a case and writes nothing', async () => {
      const before = await counts();
      const ghost = newEntityId<'UUT'>();
      const registered = await service.registerTestAttempt(ctx, { uutId: ghost, stage: 'IST' });
      assert.ok(!registered.ok && registered.error.code === 'investigation.uut_not_found');
      const ref = createEntityRef('UUT', ghost);
      assert.ok(ref.ok);
      const opened = await service.openCase(ctx, { uut: ref.value });
      assert.ok(!opened.ok && opened.error.code === 'investigation.uut_not_found');
      assert.deepEqual(await counts(), before);
    });

    it('is also enforced by the database: stage vocabulary, UUT foreign keys', async () => {
      const u = await uut();
      assert.equal(
        await rawCode(
          `insert into investigation.test_attempt (id, uut_id, stage, registered_at) values ($1, $2, 'FCT', now())`,
          [newEntityId<'TestAttempt'>(), u.id],
        ),
        RAW_CHECK,
      );
      assert.equal(
        await rawCode(
          `insert into investigation.test_attempt (id, uut_id, stage, registered_at) values ($1, $2, 'IST', now())`,
          [newEntityId<'TestAttempt'>(), newEntityId<'UUT'>()],
        ),
        RAW_FOREIGN_KEY,
      );
      assert.equal(
        await rawCode(
          `insert into investigation.investigation_case (id, uut_id, opened_at) values ($1, $2, now())`,
          [newEntityId<'InvestigationCase'>(), newEntityId<'UUT'>()],
        ),
        RAW_FOREIGN_KEY,
      );
    });

    it('refuses a duplicate id for a UUT and for an attempt, keeping the original', async () => {
      const fixedUut = newEntityId<'UUT'>();
      const module = createInvestigationModule(createPersistenceHandle(target.connection), {
        ...identityOptions(),
        newId: <T extends string>() =>
          fixedUut as unknown as import('@sdris/shared-kernel').EntityId<T>,
      }).service;
      const first = await module.registerUut(ctx, { serialNumber: 'ORIGINAL' });
      assert.ok(first.ok);
      const second = await module.registerUut(ctx, { serialNumber: 'IMPOSTOR' });
      assert.ok(!second.ok && second.error.code === 'investigation.uut_already_exists');
      assert.equal((await read.getUut(first.value.id))?.serialNumber, 'ORIGINAL');

      const fixedAttempt = newEntityId<'TestAttempt'>();
      const attempts = createInvestigationModule(createPersistenceHandle(target.connection), {
        ...identityOptions(),
        newId: <T extends string>() =>
          fixedAttempt as unknown as import('@sdris/shared-kernel').EntityId<T>,
      }).service;
      const firstAttempt = await attempts.registerTestAttempt(ctx, {
        uutId: first.value.id,
        stage: 'IST',
        externalExecutionReference: 'ORIGINAL-RUN',
      });
      assert.ok(firstAttempt.ok);
      const secondAttempt = await attempts.registerTestAttempt(ctx, {
        uutId: first.value.id,
        stage: 'SAT',
        externalExecutionReference: 'IMPOSTOR-RUN',
      });
      assert.ok(
        !secondAttempt.ok && secondAttempt.error.code === 'investigation.attempt_already_exists',
      );
      const kept = await read.getTestAttempt(fixedAttempt);
      assert.equal(kept?.externalExecutionReference, 'ORIGINAL-RUN');
      assert.equal(kept?.stage, 'IST');
    });

    it('keeps UUT, attempt and link rows immutable (database trigger)', async () => {
      const { u, c, a } = await scenario();
      await linkNow({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
      assert.equal(
        await rawCode('update investigation.uut set serial_number = $2 where id = $1', [u.id, 'x']),
        RAW_RESTRICT,
      );
      assert.equal(
        await rawCode("update investigation.test_attempt set stage = 'SAT' where id = $1", [a.id]),
        RAW_RESTRICT,
      );
      assert.equal(
        await rawCode(
          "update investigation.case_test_attempt_link set role = 'CONTEXT' where case_id = $1",
          [c.id],
        ),
        RAW_RESTRICT,
      );
      assert.equal((await read.getUut(u.id))?.serialNumber, undefined, 'nothing was changed');
    });
  });

  describe('linking', () => {
    it('links an attempt, increments the version and reads the link back with its role and linked_at', async () => {
      const { c, a } = await scenario();
      const result = await linkNow({
        caseId: c.id,
        attemptId: a.id,
        role: 'INITIAL_FAILURE',
      });
      assert.ok(result.ok && result.value.version === 2 && result.value.created);
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.version, 2);
      assert.equal(loaded?.links.length, 1);
      const link = loaded!.links[0]!;
      assert.equal(link.attemptId, a.id);
      assert.equal(link.role, 'INITIAL_FAILURE');
      assert.equal(link.linkedAt, result.value.link.linkedAt);
      assert.equal(link.uut.id, c.uut.id);
    });

    it('is idempotent: an identical repeat changes nothing, not even the version or linked_at', async () => {
      const { c, a } = await scenario();
      const command = { caseId: c.id, attemptId: a.id, role: 'RETEST' };
      const first = await linkNow(command);
      assert.ok(first.ok);
      const before = await counts();
      const [rowBefore] = await sql(
        'select * from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      for (let n = 0; n < 3; n += 1) {
        const again = await linkNow(command);
        assert.ok(again.ok && !again.value.created && again.value.version === 2);
        assert.equal(again.value.link.linkedAt, first.value.link.linkedAt);
      }
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 2, 'no unnecessary version increment');
      const [rowAfter] = await sql(
        'select * from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      assert.deepEqual(rowAfter, rowBefore, 'the stored link was not overwritten');
    });

    it('permits several roles for one case-attempt pair and several INITIAL_FAILURE links', async () => {
      const { u, c, a } = await scenario();
      for (const role of ['INITIAL_FAILURE', 'RETEST', 'SUPPORTING', 'CONTEXT']) {
        const r = await linkNow({ caseId: c.id, attemptId: a.id, role });
        assert.ok(r.ok && r.value.created, role);
      }
      const second = await attempt(u);
      const more = await linkNow({
        caseId: c.id,
        attemptId: second.id,
        role: 'INITIAL_FAILURE',
      });
      assert.ok(more.ok && more.value.created);
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.links.length, 5);
      assert.equal(loaded?.links.filter((l) => l.role === 'INITIAL_FAILURE').length, 2);
      assert.equal(loaded?.version, 6);
    });

    it('is many-to-many: one attempt can be linked to several cases and a case to several attempts', async () => {
      const u = await uut();
      const caseA = await open(u);
      const caseB = await open(u);
      const [a1, a2] = [await attempt(u), await attempt(u)];
      for (const c of [caseA, caseB]) {
        for (const a of [a1, a2]) {
          assert.ok((await linkNow({ caseId: c.id, attemptId: a.id, role: 'CONTEXT' })).ok);
        }
      }
      assert.equal((await read.getCase(caseA.id))?.links.length, 2);
      assert.equal((await read.getCase(caseB.id))?.links.length, 2);
    });

    it('returns links in deterministic order: registered_at, then attempt id, then role, even when timestamps are identical', async () => {
      const owner = await uut();
      // Attempts are inserted with explicit instants through SQL (the database accepts them; the service never does),
      // so that two attempts share one `registered_at` exactly.
      const mk = async (instant: string) => {
        const id = newEntityId<'TestAttempt'>();
        await sql(
          `insert into investigation.test_attempt (id, uut_id, stage, registered_at) values ($1, $2, 'IST', $3::timestamptz)`,
          [id, owner.id, instant],
        );
        return id;
      };
      const late = await mk('2026-11-15T09:00:00.000Z');
      const tieOne = await mk('2026-11-15T08:30:00.000Z');
      const tieTwo = await mk('2026-11-15T08:30:00.000Z');
      const [first, second] = [tieOne, tieTwo].sort();
      const opened = await open(owner);
      // Link in a scrambled order, so that insertion order is not the expected order.
      const plan: Array<[string, string]> = [
        [late, 'CONTEXT'],
        [tieTwo, 'SUPPORTING'],
        [tieOne, 'CONTEXT'],
        [tieOne, 'INITIAL_FAILURE'],
        [late, 'INITIAL_FAILURE'],
        [tieTwo, 'RETEST'],
        [tieOne, 'RETEST'],
      ];
      for (const [attemptId, role] of plan) {
        const r = await linkNow({
          caseId: opened.id,
          attemptId: attemptId as never,
          role,
        });
        assert.ok(r.ok, JSON.stringify(r));
      }
      const rank: Record<string, number> = {
        INITIAL_FAILURE: 0,
        RETEST: 1,
        SUPPORTING: 2,
        CONTEXT: 3,
      };
      const expected = [
        ...[first!, second!].flatMap((id) =>
          plan
            .filter(([attempt]) => attempt === id)
            .sort((p, q) => rank[p[1]]! - rank[q[1]]!)
            .map(([attempt, role]) => `${attempt}/${role}`),
        ),
        ...plan
          .filter(([attempt]) => attempt === late)
          .sort((p, q) => rank[p[1]]! - rank[q[1]]!)
          .map(([attempt, role]) => `${attempt}/${role}`),
      ];
      const loaded = await read.getCase(opened.id);
      assert.deepEqual(
        loaded?.links.map((l) => `${l.attemptId}/${l.role}`),
        expected,
      );
      assert.equal(
        (
          await sql(
            'select count(distinct registered_at)::int as n from investigation.test_attempt where uut_id = $1',
            [owner.id],
          )
        )[0].n,
        2,
        'two attempts really share one registered_at',
      );
      const again = await read.getCase(opened.id);
      assert.deepEqual(again?.links, loaded?.links, 'stable across repeated reads');
    });

    it('matching version and identical link: idempotent success, version and stored link untouched', async () => {
      const { c, a } = await scenario();
      const first = await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' });
      assert.ok(first.ok && first.value.created && first.value.version === 2);
      const [rowBefore] = await sql(
        'select * from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      const again = await linkAt(2, { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' });
      assert.ok(again.ok && !again.value.created && again.value.version === 2);
      assert.equal(again.value.link.linkedAt, first.value.link.linkedAt);
      assert.equal(await caseVersion(c.id), 2);
      const [rowAfter] = await sql(
        'select * from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      assert.deepEqual(rowAfter, rowBefore);
    });

    it('stale version beats idempotency: the identical, already existing link still gets concurrency_conflict', async () => {
      const { c, a } = await scenario();
      assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' })).ok);
      const stale = await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(stale.error.details?.expectedVersion, 1);
      assert.equal(stale.error.details?.actualVersion, 2);
      assert.equal(await caseVersion(c.id), 2);
      assert.equal((await read.getCase(c.id))?.links.length, 1);
    });

    it('a stale version for a new link is a conflict that stores nothing; a version from the future is one too', async () => {
      const { u, c, a } = await scenario();
      const b = await attempt(u);
      assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' })).ok);
      const before = await counts();
      const stale = await linkAt(1, { caseId: c.id, attemptId: b.id, role: 'RETEST' });
      const future = await linkAt(9, { caseId: c.id, attemptId: b.id, role: 'RETEST' });
      for (const r of [stale, future]) {
        assert.ok(!r.ok && r.error.code === 'investigation.concurrency_conflict');
      }
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 2);
    });

    it('checks existence and same-UUT ownership before the version: a stale cross-UUT request is uut_mismatch', async () => {
      const { c } = await scenario();
      const foreign = await attempt(await uut());
      const result = await linkAt(99, { caseId: c.id, attemptId: foreign.id, role: 'SUPPORTING' });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.equal(await caseVersion(c.id), 1);
    });

    it('reports an unknown case or attempt and writes nothing', async () => {
      const { c, a } = await scenario();
      const before = await counts();
      const noCase = await linkAt(1, {
        caseId: newEntityId<'InvestigationCase'>(),
        attemptId: a.id,
        role: 'RETEST',
      });
      assert.ok(!noCase.ok && noCase.error.code === 'investigation.case_not_found');
      const noAttempt = await linkNow({
        caseId: c.id,
        attemptId: newEntityId<'TestAttempt'>(),
        role: 'RETEST',
      });
      assert.ok(!noAttempt.ok && noAttempt.error.code === 'investigation.attempt_not_found');
      const badRole = await linkNow({
        caseId: c.id,
        attemptId: a.id,
        role: 'retest',
      });
      assert.ok(!badRole.ok && badRole.error.code === 'investigation.invalid_link_role');
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 1);
    });

    /**
     * Characterisation (S0-06 WP-01, specification 7.2 and 7.5): these pass on the pre-FU-3 service and must still
     * pass afterwards. The earlier checks keep their precedence over any `expectedVersion`, and the behaviour at the
     * maximum stored version of a duplicate and of a stale request does not change.
     */
    it('characterisation: role, case, attempt and same-UUT errors win over any expectedVersion and write nothing', async () => {
      const { c, a } = await scenario();
      const foreign = await attempt(await uut());
      const before = await counts();
      for (const value of [99, Number.NaN, '3', undefined]) {
        const expectedVersion = value as number;
        const badRole = await service.linkAttempt(ctx, {
          caseId: c.id as never,
          attemptId: a.id as never,
          role: 'retest',
          expectedVersion,
        });
        const noCase = await service.linkAttempt(ctx, {
          caseId: newEntityId<'InvestigationCase'>() as never,
          attemptId: a.id as never,
          role: 'RETEST',
          expectedVersion,
        });
        const noAttempt = await service.linkAttempt(ctx, {
          caseId: c.id as never,
          attemptId: newEntityId<'TestAttempt'>() as never,
          role: 'RETEST',
          expectedVersion,
        });
        const crossUut = await service.linkAttempt(ctx, {
          caseId: c.id as never,
          attemptId: foreign.id as never,
          role: 'RETEST',
          expectedVersion,
        });
        assert.ok(!badRole.ok && badRole.error.code === 'investigation.invalid_link_role');
        assert.ok(!noCase.ok && noCase.error.code === 'investigation.case_not_found');
        assert.ok(!noAttempt.ok && noAttempt.error.code === 'investigation.attempt_not_found');
        assert.ok(!crossUut.ok && crossUut.error.code === 'investigation.uut_mismatch');
      }
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 1);
    });

    it('characterisation: at the maximum stored version a matching duplicate is an idempotent success and a stale value is a service-shape conflict', async () => {
      const { c, a } = await scenario();
      assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' })).ok);
      // Test-only SQL on the isolated database: place the case at the largest storable version.
      await sql('update investigation.investigation_case set version = 2147483647 where id = $1', [
        c.id,
      ]);
      const before = await counts();
      const duplicate = await linkAt(2147483647, {
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
      });
      assert.ok(duplicate.ok && !duplicate.value.created && duplicate.value.version === 2147483647);
      const stale = await linkAt(2147483646, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(stale.error.details?.expectedVersion, 2147483646);
      assert.equal(stale.error.details?.actualVersion, 2147483647);
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 2147483647);
    });

    /** S0-06 FU-3 step 5 on real PostgreSQL (specification 7.5.1 and 7.5.2). */
    it('rejects every malformed expectedVersion with the exact contract, writes nothing and echoes nothing', async () => {
      const { c, a } = await scenario();
      const before = await counts();
      const cases: Array<[unknown, string, string]> = [
        ['3', 'not_a_number', 'string'],
        [3n, 'not_a_number', 'bigint'],
        [true, 'not_a_number', 'boolean'],
        [new Number(3), 'not_a_number', 'object'],
        [undefined, 'not_a_number', 'undefined'],
        [null, 'not_a_number', 'null'],
        [Number.NaN, 'not_a_safe_integer', 'number'],
        [Number.POSITIVE_INFINITY, 'not_a_safe_integer', 'number'],
        [2.5, 'not_a_safe_integer', 'number'],
        [Number.MAX_SAFE_INTEGER + 1, 'not_a_safe_integer', 'number'],
        [0, 'out_of_range', 'number'],
        [-1, 'out_of_range', 'number'],
        [2147483648, 'out_of_range', 'number'],
      ];
      for (const [value, reason, actualType] of cases) {
        const result = await service.linkAttempt(ctx, {
          caseId: c.id as never,
          attemptId: a.id as never,
          role: 'RETEST',
          expectedVersion: value as number,
        });
        assert.ok(!result.ok && result.error.code === 'investigation.invalid_expected_version');
        assert.deepEqual(result.error.details, {
          reason,
          minimum: 1,
          maximum: 2147483647,
          actualType,
        });
      }
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 1);
    });

    it('rejects an omitted expectedVersion like undefined, after the earlier checks', async () => {
      const { c, a } = await scenario();
      const omitted = await service.linkAttempt(ctx, {
        caseId: c.id as never,
        attemptId: a.id as never,
        role: 'RETEST',
      } as never);
      assert.ok(!omitted.ok && omitted.error.code === 'investigation.invalid_expected_version');
      assert.equal(
        (omitted.error.details as { actualType: string }).actualType,
        'undefined',
        'the omitted property is reported as undefined',
      );
      const unknownCase = await service.linkAttempt(ctx, {
        caseId: newEntityId<'InvestigationCase'>() as never,
        attemptId: a.id as never,
        role: 'RETEST',
      } as never);
      assert.ok(!unknownCase.ok && unknownCase.error.code === 'investigation.case_not_found');
    });

    it('an invalid value on a valid request is rejected even when the identical link exists; a valid stale value is still a conflict', async () => {
      const { c, a } = await scenario();
      assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' })).ok);
      const invalid = await service.linkAttempt(ctx, {
        caseId: c.id as never,
        attemptId: a.id as never,
        role: 'RETEST',
        expectedVersion: '2' as never,
      });
      assert.ok(!invalid.ok && invalid.error.code === 'investigation.invalid_expected_version');
      const stale = await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
      assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
      assert.equal(await caseVersion(c.id), 2);
    });

    /** S0-06 FU-3 step 8 on real PostgreSQL (specification 7.5.3, 7.5.7a and 7.7). */
    describe('version exhaustion', () => {
      const MAX = 2147483647;
      /** Test-only SQL on the isolated database: place a case at a chosen stored version. */
      const seedVersion = (id: string, version: number) =>
        sql('update investigation.investigation_case set version = $2 where id = $1', [
          id,
          version,
        ]);

      it('refuses a new link at the maximum version before any write; PostgreSQL never raises 22003 and the column is unchanged', async () => {
        const { u, c, a } = await scenario();
        const b = await attempt(u);
        assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' })).ok);
        await seedVersion(c.id, MAX);
        const before = await counts();
        const fresh = await linkAt(MAX, { caseId: c.id, attemptId: b.id, role: 'INITIAL_FAILURE' });
        assert.ok(!fresh.ok && fresh.error.code === 'investigation.version_exhausted');
        assert.deepEqual(fresh.error.details, { actualVersion: MAX, maximumVersion: MAX });
        // a link of the already linked attempt with a different role is also a new link
        const otherRole = await linkAt(MAX, { caseId: c.id, attemptId: a.id, role: 'SUPPORTING' });
        assert.ok(!otherRole.ok && otherRole.error.code === 'investigation.version_exhausted');
        assert.deepEqual(await counts(), before);
        assert.equal(await caseVersion(c.id), MAX);
        const [column] = await sql(
          "select data_type from information_schema.columns where table_schema = 'investigation' and table_name = 'investigation_case' and column_name = 'version'",
        );
        assert.equal(column.data_type, 'integer');
      });

      it('at the maximum a matching duplicate is ok with created false, a stale value is a service-shape conflict, MAX + 1 is invalid input', async () => {
        const { u, c, a } = await scenario();
        const b = await attempt(u);
        assert.ok((await linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' })).ok);
        await seedVersion(c.id, MAX);
        const before = await counts();
        const duplicate = await linkAt(MAX, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
        assert.ok(duplicate.ok && !duplicate.value.created && duplicate.value.version === MAX);
        const stale = await linkAt(MAX - 1, { caseId: c.id, attemptId: b.id, role: 'CONTEXT' });
        assert.ok(!stale.ok && stale.error.code === 'investigation.concurrency_conflict');
        assert.deepEqual(stale.error.details, { expectedVersion: MAX - 1, actualVersion: MAX });
        const tooBig = await linkAt(MAX + 1, { caseId: c.id, attemptId: b.id, role: 'CONTEXT' });
        assert.ok(!tooBig.ok && tooBig.error.code === 'investigation.invalid_expected_version');
        assert.deepEqual(await counts(), before);
        assert.equal(await caseVersion(c.id), MAX);
      });

      it('sequential boundary: MAX - 1 to MAX succeeds, the next different link is exhausted, a repeat of the first request is a conflict', async () => {
        const { u, c, a } = await scenario();
        const b = await attempt(u);
        await seedVersion(c.id, MAX - 1);
        const last = await linkAt(MAX - 1, {
          caseId: c.id,
          attemptId: a.id,
          role: 'INITIAL_FAILURE',
        });
        assert.ok(last.ok && last.value.created && last.value.version === MAX);
        assert.equal(await caseVersion(c.id), MAX);
        const next = await linkAt(MAX, { caseId: c.id, attemptId: b.id, role: 'RETEST' });
        assert.ok(!next.ok && next.error.code === 'investigation.version_exhausted');
        const repeat = await linkAt(MAX - 1, {
          caseId: c.id,
          attemptId: a.id,
          role: 'INITIAL_FAILURE',
        });
        assert.ok(!repeat.ok && repeat.error.code === 'investigation.concurrency_conflict');
        assert.deepEqual(repeat.error.details, { expectedVersion: MAX - 1, actualVersion: MAX });
        assert.equal((await read.getCase(c.id))?.links.length, 1);
      });
    });
  });

  describe('same-UUT protection', () => {
    it('rejects a cross-UUT link through the whole stack and stores nothing', async () => {
      const { c } = await scenario();
      const foreign = await attempt(await uut());
      const before = await counts();
      const result = await linkNow({
        caseId: c.id,
        attemptId: foreign.id,
        role: 'SUPPORTING',
      });
      assert.ok(!result.ok && result.error.code === 'investigation.uut_mismatch');
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 1, 'a rejected link must not advance the version');
    });

    it('is also enforced by the database: forged links with a mismatching UUT violate the composite keys', async () => {
      const { c, a } = await scenario();
      const other = await uut();
      const insert = `insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, 'CONTEXT', now())`;
      // UUT of neither side
      assert.equal(await rawCode(insert, [c.id, a.id, other.id]), RAW_FOREIGN_KEY);
      // attempt of another UUT, case UUT stored on the link
      const foreignAttempt = await attempt(other);
      assert.equal(await rawCode(insert, [c.id, foreignAttempt.id, c.uut.id]), RAW_FOREIGN_KEY);
      // case of another UUT, attempt UUT stored on the link
      const foreignCase = await open(other);
      assert.equal(await rawCode(insert, [foreignCase.id, a.id, c.uut.id]), RAW_FOREIGN_KEY);
      assert.equal((await read.getCase(c.id))?.links.length, 0);
    });

    it('refuses a link whose case or attempt does not exist (foreign keys)', async () => {
      const { c, a } = await scenario();
      const insert = `insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, 'CONTEXT', now())`;
      assert.equal(
        await rawCode(insert, [newEntityId<'InvestigationCase'>(), a.id, c.uut.id]),
        RAW_FOREIGN_KEY,
      );
      assert.equal(
        await rawCode(insert, [c.id, newEntityId<'TestAttempt'>(), c.uut.id]),
        RAW_FOREIGN_KEY,
      );
    });
  });

  describe('link uniqueness and vocabulary (database)', () => {
    it('enforces unique (case_id, attempt_id, role) and the role vocabulary', async () => {
      const { c, a } = await scenario();
      await linkNow({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
      const insert = (role: string) =>
        rawCode(
          'insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, $4, now())',
          [c.id, a.id, c.uut.id, role],
        );
      assert.equal(await insert('RETEST'), RAW_UNIQUE);
      assert.equal(await insert('FINAL'), RAW_CHECK);
      assert.equal(await insert('CONTEXT'), undefined, 'another role for the same pair is allowed');
    });
  });

  describe('transaction commit and rollback', () => {
    it('commits the version bump and the link together', async () => {
      const { c, a } = await scenario();
      await linkNow({ caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' });
      assert.equal(await caseVersion(c.id), 2);
      const links = await sql(
        'select attempt_id from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      assert.equal(links.length, 1);
    });

    it('rolls back everything when the domain rejects the command', async () => {
      const { c } = await scenario();
      const foreign = await attempt(await uut());
      await linkNow({ caseId: c.id, attemptId: foreign.id, role: 'RETEST' });
      assert.equal(await caseVersion(c.id), 1);
      assert.equal((await read.getCase(c.id))?.links.length, 0);
    });

    it('rolls back the version bump when storing the link fails inside the database', async () => {
      const { c, a } = await scenario();
      await sql(
        `create function investigation.reject_link() returns trigger language plpgsql as $$ begin raise exception 'injected link failure'; end $$`,
      );
      await sql(
        'create trigger reject_link before insert on investigation.case_test_attempt_link for each row execute function investigation.reject_link()',
      );
      try {
        await assert.rejects(linkNow({ caseId: c.id, attemptId: a.id, role: 'RETEST' }), (error) =>
          causedBy(error, /injected link failure/),
        );
      } finally {
        await sql('drop trigger reject_link on investigation.case_test_attempt_link');
        await sql('drop function investigation.reject_link()');
      }
      assert.equal(await caseVersion(c.id), 1, 'the bump was rolled back with the failed insert');
      assert.equal((await read.getCase(c.id))?.links.length, 0);
    });

    it('rolls back a failed attempt registration, leaving no attempt behind', async () => {
      const u = await uut();
      const before = await counts();
      await sql(
        `create function investigation.reject_attempt() returns trigger language plpgsql as $$ begin raise exception 'no attempts today'; end $$`,
      );
      await sql(
        'create trigger reject_attempt before insert on investigation.test_attempt for each row execute function investigation.reject_attempt()',
      );
      try {
        await assert.rejects(
          service.registerTestAttempt(ctx, { uutId: u.id, stage: 'IST' }),
          (error) => causedBy(error, /no attempts today/),
        );
      } finally {
        await sql('drop trigger reject_attempt on investigation.test_attempt');
        await sql('drop function investigation.reject_attempt()');
      }
      assert.deepEqual(await counts(), before);
    });
  });

  describe('optimistic concurrency', () => {
    it('lets simultaneous writers succeed only with distinct versions or an explicit conflict, never a silent loss', async () => {
      const { u, c } = await scenario();
      const attempts = await Promise.all(Array.from({ length: 10 }, () => attempt(u)));
      const results = await Promise.all(
        attempts.map((a) => linkNow({ caseId: c.id, attemptId: a.id, role: 'SUPPORTING' })),
      );
      const succeeded = results.filter((r) => r.ok);
      assert.ok(
        results
          .filter((r) => !r.ok)
          .every((r) => !r.ok && r.error.code === 'investigation.concurrency_conflict'),
      );
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.links.length, succeeded.length, 'one stored link per success');
      assert.equal(loaded?.version, 1 + succeeded.length);
      const versions = succeeded.map((r) => (r.ok ? r.value.version : 0)).sort((x, y) => x - y);
      assert.deepEqual(versions, [...new Set(versions)], 'no two successes share a version');
      assert.ok(succeeded.length >= 1);
    });

    it('rejects, deterministically, a writer that decided on an older version', async () => {
      const { c, a } = await scenario();
      const other = await target.connection.pool.connect();
      try {
        await other.query('begin');
        await other.query(
          'update investigation.investigation_case set version = version + 1 where id = $1',
          [c.id],
        );
        const writer = linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
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
      assert.equal(await caseVersion(c.id), 2, 'only the other writer advanced the version');
      assert.equal((await read.getCase(c.id))?.links.length, 0, 'the stale writer stored nothing');
    });

    it('re-reads and re-evaluates on retry: a duplicate that lost the race becomes an idempotent no-op', async () => {
      const { c, a } = await scenario();
      const command = { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' };
      const results = await Promise.all(Array.from({ length: 8 }, () => linkNow(command)));
      for (const r of results) {
        if (!r.ok) assert.equal(r.error.code, 'investigation.concurrency_conflict');
      }
      // the caller retries, re-reading authoritative state
      const retry = await linkNow(command);
      assert.ok(retry.ok && !retry.value.created, 'already linked: idempotent');
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.links.length, 1);
      assert.equal(loaded?.version, 2, 'exactly one version increment for one distinct link');
    });

    it('loses no update when writers retry on conflict', async () => {
      const { u, c } = await scenario();
      const writers = 6;
      const each = 3;
      const retrying = async () => {
        for (let n = 0; n < each;) {
          const a = await attempt(u);
          for (;;) {
            const r = await linkNow({
              caseId: c.id,
              attemptId: a.id,
              role: 'SUPPORTING',
            });
            if (r.ok) break;
            assert.equal(r.error.code, 'investigation.concurrency_conflict');
          }
          n += 1;
        }
      };
      await Promise.all(Array.from({ length: writers }, retrying));
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.links.length, writers * each);
      assert.equal(loaded?.version, 1 + writers * each);
    });

    /**
     * Holds a committed-but-not-yet-visible change: another transaction locks the link table, bumps the case version and
     * inserts a link, and commits only after `read` is blocked on that lock. Under READ COMMITTED a reader that loads the
     * case in two separate statements would see the old version with the new link.
     */
    const readWhileAnotherWriterCommitsALink = async <T>(
      c: InvestigationCase,
      a: TestAttempt,
      read: () => Promise<T>,
    ): Promise<T> => {
      const other = await target.connection.pool.connect();
      try {
        await other.query('begin');
        await other.query(
          'lock table investigation.case_test_attempt_link in access exclusive mode',
        );
        await other.query(
          'update investigation.investigation_case set version = version + 1 where id = $1',
          [c.id],
        );
        await other.query(
          `insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, 'RETEST', now())`,
          [c.id, a.id, c.uut.id],
        );
        const reader = read();
        for (let waited = 0; ; waited += 10) {
          const blocked = await sql(
            "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          if (blocked[0].n >= 1) break;
          assert.ok(waited < 5000, 'the reader never reached the lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await other.query('commit');
        return await reader;
      } finally {
        other.release();
      }
    };

    it('loads the case version and its links from one snapshot (no torn read)', async () => {
      const { c, a } = await scenario();
      const loaded = await readWhileAnotherWriterCommitsALink(c, a, () => read.getCase(c.id));
      assert.ok(loaded);
      assert.equal(
        loaded.version,
        1 + loaded.links.length,
        'the version and the links must describe the same state',
      );
    });

    it('reads one snapshot for the duplicate check: expected version 2 after the racing commit is an idempotent success at version 2', async () => {
      const { c, a } = await scenario();
      const result = await readWhileAnotherWriterCommitsALink(c, a, () =>
        linkAt(2, { caseId: c.id, attemptId: a.id, role: 'RETEST' }),
      );
      assert.ok(
        result.ok && !result.value.created && result.value.version === 2,
        JSON.stringify(result),
      );
      assert.equal(await caseVersion(c.id), 2, 'no increment for the idempotent no-op');
    });

    it('in the same race, the old expected version 1 is a concurrency conflict even though the link now exists', async () => {
      const { c, a } = await scenario();
      const result = await readWhileAnotherWriterCommitsALink(c, a, () =>
        linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' }),
      );
      assert.ok(!result.ok && result.error.code === 'investigation.concurrency_conflict');
      assert.equal(result.error.details?.actualVersion, 2);
      assert.equal(await caseVersion(c.id), 2);
    });

    it('does not suppress an unrelated database error: a unique violation from a racing raw insert is thrown and rolled back', async () => {
      const { c, a } = await scenario();
      const other = await target.connection.pool.connect();
      try {
        // Another session holds an uncommitted link with the same key but does not touch the case version,
        // so the service's version check passes and its insert must wait for, then collide with, that row.
        await other.query('begin');
        await other.query(
          `insert into investigation.case_test_attempt_link (case_id, attempt_id, uut_id, role, linked_at) values ($1, $2, $3, 'RETEST', now())`,
          [c.id, a.id, c.uut.id],
        );
        const writer = linkAt(1, { caseId: c.id, attemptId: a.id, role: 'RETEST' });
        const outcome = writer.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        for (let waited = 0; ; waited += 10) {
          const blocked = await sql(
            "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          if (blocked[0].n >= 1) break;
          assert.ok(waited < 5000, 'the writer never reached the unique key lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await other.query('commit');
        const settled = await outcome;
        assert.ok('error' in settled, 'the unique violation must surface, not become a result');
        assert.equal(pgErrorCode(settled.error), RAW_UNIQUE);
      } finally {
        other.release();
      }
      assert.equal(
        await caseVersion(c.id),
        1,
        'the version bump was rolled back with the failed insert',
      );
      assert.equal(
        (
          await sql(
            'select count(*)::int as n from investigation.case_test_attempt_link where case_id = $1',
            [c.id],
          )
        )[0].n,
        1,
      );
      // after the raw row is committed the same request is a plain idempotent duplicate
      const retry = await linkNow({
        caseId: c.id,
        attemptId: a.id,
        role: 'RETEST',
      });
      assert.ok(retry.ok && !retry.value.created);
    });

    /**
     * Starts the given writers so that every one of them has read the SAME case version before any of them writes:
     * another session holds a row lock on the case, the writers each read (no lock) and then wait at the version
     * UPDATE; releasing the lock lets them proceed one after another. No timing luck is involved.
     */
    const writersBehindARowLock = async <T>(
      c: InvestigationCase,
      writers: Array<() => Promise<T>>,
    ): Promise<T[]> => {
      const holder = await target.connection.pool.connect();
      try {
        await holder.query('begin');
        await holder.query(
          'select id from investigation.investigation_case where id = $1 for update',
          [c.id],
        );
        const running = writers.map((start) => start());
        for (let waited = 0; ; waited += 10) {
          const blocked = await sql(
            "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          if (blocked[0].n >= writers.length) break;
          assert.ok(waited < 5000, 'not every writer reached the version update');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await holder.query('rollback');
        return await Promise.all(running);
      } finally {
        holder.release();
      }
    };

    it('two concurrent identical link requests: exactly one is stored, the other is a stale writer and a retry is idempotent', async () => {
      const { c, a } = await scenario();
      const command = { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' };
      const results = await writersBehindARowLock(c, [
        () => linkAt(1, command),
        () => linkAt(1, command),
      ]);
      const created = results.filter((r) => r.ok && r.value.created);
      const conflicts = results.filter(
        (r) => !r.ok && r.error.code === 'investigation.concurrency_conflict',
      );
      assert.equal(created.length, 1, 'exactly one writer stored the link');
      assert.equal(
        conflicts.length,
        1,
        'the other had decided on a stale version and was rejected',
      );
      assert.equal(await caseVersion(c.id), 2, 'one new link, one version increment');
      // the stale request stays stale: Expected Version takes precedence even though the link now exists
      const stillStale = await linkAt(1, command);
      assert.ok(!stillStale.ok && stillStale.error.code === 'investigation.concurrency_conflict');
      // the loser re-reads the authoritative state (version 2) and re-evaluates: now an idempotent success
      const retry = await linkAt(2, command);
      assert.ok(retry.ok && !retry.value.created && retry.value.version === 2);
      assert.equal((await read.getCase(c.id))?.links.length, 1);
      assert.equal(
        await caseVersion(c.id),
        2,
        'the idempotent retry did not increment the version',
      );
    });

    it('two concurrent different link requests on the same version: one wins, the stale one is rejected and succeeds after a fresh read', async () => {
      const { u, c, a } = await scenario();
      const b = await attempt(u);
      const first = { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' };
      const second = { caseId: c.id, attemptId: b.id, role: 'RETEST' };
      const results = await writersBehindARowLock(c, [
        () => linkAt(1, first),
        () => linkAt(1, second),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const loser = results.findIndex((r) => !r.ok);
      assert.ok(loser >= 0);
      const lost = results[loser]!;
      assert.ok(!lost.ok && lost.error.code === 'investigation.concurrency_conflict');
      assert.equal((await read.getCase(c.id))?.links.length, 1, 'the stale writer stored nothing');
      assert.equal(await caseVersion(c.id), 2);
      const retried = await linkAt(2, loser === 0 ? first : second);
      assert.ok(retried.ok && retried.value.created && retried.value.version === 3);
      const loaded = await read.getCase(c.id);
      assert.equal(loaded?.links.length, 2);
      assert.equal(loaded?.version, 3);
    });

    it('rejects a stale write at the database boundary: the version predicate is atomic', async () => {
      const { c, a } = await scenario();
      await linkNow({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
      const stale = await sql(
        'update investigation.investigation_case set version = version + 1 where id = $1 and version = $2 returning version',
        [c.id, 1],
      );
      assert.equal(stale.length, 0, 'the stale version no longer matches');
      assert.equal(await caseVersion(c.id), 2);
    });

    /** Repository-shape race (specification 7.5.5): both writers pass the service comparison, the UPDATE decides. */
    it('repository-shape conflict: the loser of a concurrent pair carries expectedVersion and no actualVersion', async () => {
      const { u, c, a } = await scenario();
      const b = await attempt(u);
      const results = await writersBehindARowLock(c, [
        () => linkAt(1, { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' }),
        () => linkAt(1, { caseId: c.id, attemptId: b.id, role: 'RETEST' }),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const lost = results.find((r) => !r.ok)!;
      assert.ok(!lost.ok && lost.error.code === 'investigation.concurrency_conflict');
      assert.deepEqual(lost.error.details, { expectedVersion: 1 });
      assert.ok(!('actualVersion' in (lost.error.details ?? {})));
      assert.equal((await read.getCase(c.id))?.links.length, 1);
      assert.equal(await caseVersion(c.id), 2);
    });

    /** Race at the boundary (specification 7.5.7). */
    it('race at the boundary: two concurrent new links at MAX - 1, one reaches MAX and the other conflicts; the next new link is exhausted', async () => {
      const MAX = 2147483647;
      const { u, c, a } = await scenario();
      const [b, d] = [await attempt(u), await attempt(u)];
      await sql('update investigation.investigation_case set version = $2 where id = $1', [
        c.id,
        MAX - 1,
      ]);
      const results = await writersBehindARowLock(c, [
        () => linkAt(MAX - 1, { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' }),
        () => linkAt(MAX - 1, { caseId: c.id, attemptId: b.id, role: 'RETEST' }),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const lost = results.find((r) => !r.ok)!;
      assert.ok(!lost.ok && lost.error.code === 'investigation.concurrency_conflict');
      assert.deepEqual(lost.error.details, { expectedVersion: MAX - 1 });
      assert.equal(await caseVersion(c.id), MAX);
      const next = await linkAt(MAX, { caseId: c.id, attemptId: d.id, role: 'CONTEXT' });
      assert.ok(!next.ok && next.error.code === 'investigation.version_exhausted');
      assert.equal(await caseVersion(c.id), MAX);
    });
  });
});
