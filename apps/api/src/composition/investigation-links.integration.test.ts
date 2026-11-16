import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { applyScripts, createPersistenceHandle, pgErrorCode } from '@sdris/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '@sdris/database/testing';
import type {
  InvestigationCase,
  InvestigationService,
  TestAttempt,
  Uut,
} from '@sdris/investigation';
import { createInvestigationModule } from '@sdris/investigation/composition';
import { createEntityRef, newEntityId, parseTimestamp } from '@sdris/shared-kernel';
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
    const result = await service.registerUut(attributes);
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const refOf = (u: Uut) => {
    const ref = createEntityRef('UUT', u.id);
    if (!ref.ok) throw new Error('bad ref');
    return ref.value;
  };
  const attempt = async (u: Uut, stage = 'IST') => {
    const result = await service.registerTestAttempt({ uutId: u.id, stage });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const open = async (u: Uut): Promise<InvestigationCase> => {
    const result = await service.openCase({ uut: refOf(u) });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  /** A fresh UUT with one case and one attempt of that UUT. */
  const scenario = async () => {
    const u = await uut();
    return { u, c: await open(u), a: await attempt(u) };
  };

  before(async () => {
    target = await createIsolatedDatabase();
    await applyScripts(target.connection.pool, 'migration', MIGRATIONS);
    service = composeInvestigation(target.connection).service;
  });
  after(async () => {
    await target.drop();
  });

  describe('UUT and TestAttempt persistence', () => {
    it('stores external identifiers exactly as supplied, and allows duplicates (not unique)', async () => {
      const a = await uut({ serialNumber: '  Sn-001 ', hostname: 'HostA' });
      const b = await uut({ serialNumber: '  Sn-001 ', hostname: 'HostA' });
      assert.notEqual(a.id, b.id);
      const loaded = await service.getUut(a.id);
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
      assert.equal((await service.getUut(bare.id))?.serialNumber, undefined);
      const empty = await uut({ serialNumber: '' });
      assert.equal((await service.getUut(empty.id))?.serialNumber, '');
    });

    it('records created_at, returns undefined for an unknown UUT and keeps timestamps as UTC instants', async () => {
      const u = await uut();
      assert.equal((await service.getUut(u.id))?.createdAt, u.createdAt);
      assert.equal(await service.getUut(newEntityId<'UUT'>()), undefined);
      const [row] = await sql(
        'select created_at = $2::timestamptz as same, pg_typeof(created_at)::text as type from investigation.uut where id = $1',
        [u.id, u.createdAt],
      );
      assert.equal(row.same, true);
      assert.equal(row.type, 'timestamp with time zone');
    });

    it('registers an attempt with stage and an optional, non-unique external execution reference', async () => {
      const u = await uut();
      const first = await service.registerTestAttempt({
        uutId: u.id,
        stage: 'SAT',
        externalExecutionReference: ' run-1 ',
      });
      const second = await service.registerTestAttempt({
        uutId: u.id,
        stage: 'SAT',
        externalExecutionReference: ' run-1 ',
      });
      assert.ok(first.ok && second.ok);
      assert.notEqual(first.value.id, second.value.id);
      const loaded = await service.getTestAttempt(first.value.id);
      assert.deepEqual(loaded, first.value);
      assert.equal(loaded?.externalExecutionReference, ' run-1 ');
      assert.equal(loaded?.uut.id, u.id);
      assert.equal(await service.getTestAttempt(newEntityId<'TestAttempt'>()), undefined);
    });

    it('rejects an invalid stage before anything is written', async () => {
      const u = await uut();
      const before = await counts();
      const result = await service.registerTestAttempt({ uutId: u.id, stage: 'FCT' });
      assert.ok(!result.ok && result.error.code === 'investigation.invalid_test_stage');
      assert.deepEqual(await counts(), before);
    });

    it('reports an unknown UUT for an attempt or a case and writes nothing', async () => {
      const before = await counts();
      const ghost = newEntityId<'UUT'>();
      const registered = await service.registerTestAttempt({ uutId: ghost, stage: 'IST' });
      assert.ok(!registered.ok && registered.error.code === 'investigation.uut_not_found');
      const ref = createEntityRef('UUT', ghost);
      assert.ok(ref.ok);
      const opened = await service.openCase({ uut: ref.value });
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
        newId: <T extends string>() =>
          fixedUut as unknown as import('@sdris/shared-kernel').EntityId<T>,
      }).service;
      const first = await module.registerUut({ serialNumber: 'ORIGINAL' });
      assert.ok(first.ok);
      const second = await module.registerUut({ serialNumber: 'IMPOSTOR' });
      assert.ok(!second.ok && second.error.code === 'investigation.uut_already_exists');
      assert.equal((await service.getUut(first.value.id))?.serialNumber, 'ORIGINAL');

      const fixedAttempt = newEntityId<'TestAttempt'>();
      const attempts = createInvestigationModule(createPersistenceHandle(target.connection), {
        newId: <T extends string>() =>
          fixedAttempt as unknown as import('@sdris/shared-kernel').EntityId<T>,
      }).service;
      const firstAttempt = await attempts.registerTestAttempt({
        uutId: first.value.id,
        stage: 'IST',
        externalExecutionReference: 'ORIGINAL-RUN',
      });
      assert.ok(firstAttempt.ok);
      const secondAttempt = await attempts.registerTestAttempt({
        uutId: first.value.id,
        stage: 'SAT',
        externalExecutionReference: 'IMPOSTOR-RUN',
      });
      assert.ok(
        !secondAttempt.ok && secondAttempt.error.code === 'investigation.attempt_already_exists',
      );
      const kept = await service.getTestAttempt(fixedAttempt);
      assert.equal(kept?.externalExecutionReference, 'ORIGINAL-RUN');
      assert.equal(kept?.stage, 'IST');
    });

    it('keeps UUT, attempt and link rows immutable (database trigger)', async () => {
      const { u, c, a } = await scenario();
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
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
      assert.equal((await service.getUut(u.id))?.serialNumber, undefined, 'nothing was changed');
    });
  });

  describe('linking', () => {
    it('links an attempt, increments the version and reads the link back with its role and linked_at', async () => {
      const { c, a } = await scenario();
      const result = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'INITIAL_FAILURE',
      });
      assert.ok(result.ok && result.value.version === 2 && result.value.created);
      const loaded = await service.getCase(c.id);
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
      const first = await service.linkTestAttempt(command);
      assert.ok(first.ok);
      const before = await counts();
      const [rowBefore] = await sql(
        'select * from investigation.case_test_attempt_link where case_id = $1',
        [c.id],
      );
      for (let n = 0; n < 3; n += 1) {
        const again = await service.linkTestAttempt(command);
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
        const r = await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role });
        assert.ok(r.ok && r.value.created, role);
      }
      const second = await attempt(u);
      const more = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: second.id,
        role: 'INITIAL_FAILURE',
      });
      assert.ok(more.ok && more.value.created);
      const loaded = await service.getCase(c.id);
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
          assert.ok(
            (await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'CONTEXT' })).ok,
          );
        }
      }
      assert.equal((await service.getCase(caseA.id))?.links.length, 2);
      assert.equal((await service.getCase(caseB.id))?.links.length, 2);
    });

    it('returns links in deterministic order: registered_at, then attempt id, then role', async () => {
      let clock = Date.UTC(2026, 10, 15, 8, 0, 0, 0);
      const stamp = () => {
        const parsed = parseTimestamp(new Date(clock).toISOString());
        if (!parsed.ok) throw new Error('bad clock');
        return parsed.value;
      };
      const timed = createInvestigationModule(createPersistenceHandle(target.connection), {
        now: stamp,
      }).service;
      const owner = await timed.registerUut({});
      assert.ok(owner.ok);
      const make = async (at: number) => {
        clock = at;
        const r = await timed.registerTestAttempt({ uutId: owner.value.id, stage: 'IST' });
        assert.ok(r.ok);
        return r.value;
      };
      const late = await make(Date.UTC(2026, 10, 15, 9, 0, 0, 0));
      const earlyOne = await make(Date.UTC(2026, 10, 15, 8, 30, 0, 0));
      const earlyTwo = await make(Date.UTC(2026, 10, 15, 8, 30, 0, 0)); // same instant: id decides
      const ref = createEntityRef('UUT', owner.value.id);
      assert.ok(ref.ok);
      const opened = await timed.openCase({ uut: ref.value });
      assert.ok(opened.ok);
      // Link in a scrambled order, so that insertion order is not the expected order.
      const plan: Array<[TestAttempt, string]> = [
        [late, 'CONTEXT'],
        [earlyTwo, 'SUPPORTING'],
        [earlyOne, 'CONTEXT'],
        [earlyOne, 'INITIAL_FAILURE'],
        [late, 'INITIAL_FAILURE'],
        [earlyTwo, 'RETEST'],
        [earlyOne, 'RETEST'],
      ];
      for (const [a, role] of plan) {
        assert.ok(
          (await timed.linkTestAttempt({ caseId: opened.value.id, attemptId: a.id, role })).ok,
        );
      }
      const roleRank: Record<string, number> = {
        INITIAL_FAILURE: 0,
        RETEST: 1,
        SUPPORTING: 2,
        CONTEXT: 3,
      };
      const byRegistration = (x: TestAttempt, y: TestAttempt) =>
        x.registeredAt.localeCompare(y.registeredAt) || (x.id === y.id ? 0 : x.id < y.id ? -1 : 1);
      const expected = plan
        .map(([a, role]) => ({ a, role }))
        .sort((p, q) => byRegistration(p.a, q.a) || roleRank[p.role]! - roleRank[q.role]!)
        .map(({ a, role }) => `${a.id}/${role}`);
      const loaded = await timed.getCase(opened.value.id);
      assert.deepEqual(
        loaded?.links.map((l) => `${l.attemptId}/${l.role}`),
        expected,
      );
      // and it is stable across repeated reads
      const again = await timed.getCase(opened.value.id);
      assert.deepEqual(again?.links, loaded?.links);
      assert.equal(loaded?.links[0]?.attemptId, [earlyOne, earlyTwo].sort(byRegistration)[0]!.id);
      assert.equal(loaded?.links.at(-1)?.attemptId, late.id);
    });

    it('reports an unknown case or attempt and writes nothing', async () => {
      const { c, a } = await scenario();
      const before = await counts();
      const noCase = await service.linkTestAttempt({
        caseId: newEntityId<'InvestigationCase'>(),
        attemptId: a.id,
        role: 'RETEST',
      });
      assert.ok(!noCase.ok && noCase.error.code === 'investigation.case_not_found');
      const noAttempt = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: newEntityId<'TestAttempt'>(),
        role: 'RETEST',
      });
      assert.ok(!noAttempt.ok && noAttempt.error.code === 'investigation.attempt_not_found');
      const badRole = await service.linkTestAttempt({
        caseId: c.id,
        attemptId: a.id,
        role: 'retest',
      });
      assert.ok(!badRole.ok && badRole.error.code === 'investigation.invalid_link_role');
      assert.deepEqual(await counts(), before);
      assert.equal(await caseVersion(c.id), 1);
    });
  });

  describe('same-UUT protection', () => {
    it('rejects a cross-UUT link through the whole stack and stores nothing', async () => {
      const { c } = await scenario();
      const foreign = await attempt(await uut());
      const before = await counts();
      const result = await service.linkTestAttempt({
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
      assert.equal((await service.getCase(c.id))?.links.length, 0);
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
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
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
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' });
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
      await service.linkTestAttempt({ caseId: c.id, attemptId: foreign.id, role: 'RETEST' });
      assert.equal(await caseVersion(c.id), 1);
      assert.equal((await service.getCase(c.id))?.links.length, 0);
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
        await assert.rejects(
          service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' }),
          (error) => causedBy(error, /injected link failure/),
        );
      } finally {
        await sql('drop trigger reject_link on investigation.case_test_attempt_link');
        await sql('drop function investigation.reject_link()');
      }
      assert.equal(await caseVersion(c.id), 1, 'the bump was rolled back with the failed insert');
      assert.equal((await service.getCase(c.id))?.links.length, 0);
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
        await assert.rejects(service.registerTestAttempt({ uutId: u.id, stage: 'IST' }), (error) =>
          causedBy(error, /no attempts today/),
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
        attempts.map((a) =>
          service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'SUPPORTING' }),
        ),
      );
      const succeeded = results.filter((r) => r.ok);
      assert.ok(
        results
          .filter((r) => !r.ok)
          .every((r) => !r.ok && r.error.code === 'investigation.concurrency_conflict'),
      );
      const loaded = await service.getCase(c.id);
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
        const writer = service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
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
      assert.equal(
        (await service.getCase(c.id))?.links.length,
        0,
        'the stale writer stored nothing',
      );
    });

    it('re-reads and re-evaluates on retry: a duplicate that lost the race becomes an idempotent no-op', async () => {
      const { c, a } = await scenario();
      const command = { caseId: c.id, attemptId: a.id, role: 'INITIAL_FAILURE' };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.linkTestAttempt(command)),
      );
      for (const r of results) {
        if (!r.ok) assert.equal(r.error.code, 'investigation.concurrency_conflict');
      }
      // the caller retries, re-reading authoritative state
      const retry = await service.linkTestAttempt(command);
      assert.ok(retry.ok && !retry.value.created, 'already linked: idempotent');
      const loaded = await service.getCase(c.id);
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
            const r = await service.linkTestAttempt({
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
      const loaded = await service.getCase(c.id);
      assert.equal(loaded?.links.length, writers * each);
      assert.equal(loaded?.version, 1 + writers * each);
    });

    it('rejects a stale write at the database boundary: the version predicate is atomic', async () => {
      const { c, a } = await scenario();
      await service.linkTestAttempt({ caseId: c.id, attemptId: a.id, role: 'RETEST' });
      const stale = await sql(
        'update investigation.investigation_case set version = version + 1 where id = $1 and version = $2 returning version',
        [c.id, 1],
      );
      assert.equal(stale.length, 0, 'the stale version no longer matches');
      assert.equal(await caseVersion(c.id), 2);
    });
  });
});
