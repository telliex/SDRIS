import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { checksumOf, findTransactionControl, loadScripts, MigrationError } from './migrations';
import { SCHEMA_NAMES } from './schemas';

const dirWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdris-mig-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof MigrationError ? error.code : `other: ${error}`;
  }
  return 'no error';
};

describe('loadScripts', () => {
  it('orders by version and ignores non-SQL files', () => {
    const dir = dirWith({ '0002_b.sql': 'select 2;', '0001_a.sql': 'select 1;', 'README.md': 'x' });
    assert.deepEqual(
      loadScripts(dir).map((f) => f.fileName),
      ['0001_a.sql', '0002_b.sql'],
    );
  });

  it('rejects badly named files and duplicate versions', () => {
    assert.equal(
      code(() => loadScripts(dirWith({ 'add_thing.sql': 'x' }))),
      'INVALID_FILE_NAME',
    );
    assert.equal(
      code(() => loadScripts(dirWith({ '1_a.sql': 'x' }))),
      'INVALID_FILE_NAME',
    );
    assert.equal(
      code(() => loadScripts(dirWith({ '0001_Upper.sql': 'x' }))),
      'INVALID_FILE_NAME',
    );
    assert.equal(
      code(() => loadScripts(dirWith({ '0001_a.sql': 'x', '0001_b.sql': 'y' }))),
      'DUPLICATE_VERSION',
    );
  });

  it('checksums ignore line-ending style but detect content changes', () => {
    assert.equal(checksumOf('a\r\nb'), checksumOf('a\nb'));
    assert.notEqual(checksumOf('select 1;'), checksumOf('select 2;'));
  });

  it('treats a missing directory as no scripts', () => {
    assert.deepEqual(loadScripts(path.join(tmpdir(), 'sdris-does-not-exist')), []);
  });
});

describe('committed migrations', () => {
  const migrations = loadScripts(path.resolve(__dirname, '..', 'migrations'));

  it('the baseline creates exactly the schemas in the ownership map and no tables', () => {
    assert.equal(migrations[0]?.fileName, '0001_create_bounded_context_schemas.sql');
    const created = [...migrations[0]!.sql.matchAll(/create schema if not exists (\w+);/g)].map(
      (m) => m[1],
    );
    assert.deepEqual([...created].sort(), [...SCHEMA_NAMES].sort());
    assert.doesNotMatch(
      migrations[0]!.sql,
      /create\s+table/i,
      'the baseline must not create business tables',
    );
  });

  it('every later table is created inside an existing owner schema, never unqualified', () => {
    for (const migration of migrations.slice(1)) {
      const tables = [...migration.sql.matchAll(/create\s+table\s+([\w.]+)/gi)].map((m) => m[1]!);
      for (const table of tables) {
        const [schema, name] = table.split('.');
        assert.ok(name, `${migration.fileName}: ${table} must be schema-qualified`);
        assert.ok(
          (SCHEMA_NAMES as readonly string[]).includes(schema!),
          `${migration.fileName}: unknown schema ${schema}`,
        );
      }
    }
  });

  it('the Investigation tables live only in the investigation schema', () => {
    const sql = migrations.map((m) => m.sql).join('\n');
    assert.match(sql, /create table investigation\.investigation_case/);
    assert.match(sql, /create table investigation\.failure_observation/);
    assert.match(
      sql,
      /foreign key \(case_id, uut_id\) references investigation\.investigation_case \(id, uut_id\)/,
    );
  });
});

describe('findTransactionControl', () => {
  const found = (sql: string) => findTransactionControl(sql)?.keyword;

  it('detects statements that end or restart the runner-owned transaction', () => {
    assert.equal(found('create schema a; commit; select 1;'), 'COMMIT');
    assert.equal(found('create schema a;\nCOMMIT'), 'COMMIT');
    assert.equal(found('select 1; Rollback;'), 'ROLLBACK');
    assert.equal(found('begin; create schema a;'), 'BEGIN');
    assert.equal(found('start transaction; select 1;'), 'START TRANSACTION');
    assert.equal(found('select 1; end;'), 'END');
    assert.equal(found('select 1; abort;'), 'ABORT');
    assert.equal(found("prepare transaction 'x';"), 'PREPARE TRANSACTION');
    assert.equal(found("commit prepared 'x';"), 'COMMIT');
    assert.equal(found('select 1\n;\n  COMMIT  \n;'), 'COMMIT');
    assert.equal(found('commit and chain; select 1;'), 'COMMIT');
  });

  it('ignores the same words in comments, strings, identifiers and dollar-quoted bodies', () => {
    assert.equal(found('-- commit;\nselect 1;'), undefined);
    assert.equal(found('/* commit; /* nested commit; */ rollback; */ select 1;'), undefined);
    assert.equal(found("select 'commit; rollback;';"), undefined);
    assert.equal(found("select 'it''s; commit; fine';"), undefined);
    assert.equal(found("select E'back\\'; commit; slash';"), undefined);
    assert.equal(found('create table "commit" (id int);'), undefined);
    assert.equal(found('do $$ begin perform 1; end $$;'), undefined);
    assert.equal(found('do $body$ begin commit; end $body$;'), undefined);
  });

  it('does not flag ordinary statements that merely start with similar words', () => {
    assert.equal(found('prepare p as select 1;'), undefined);
    assert.equal(found('create table commit_log (id int);'), undefined);
    assert.equal(found('savepoint a; rollback to savepoint a; release savepoint a;'), undefined);
    assert.equal(
      found('create function f() returns int language sql begin atomic select 1; end;'),
      undefined,
    );
  });

  it('still detects control statements after a SQL-standard function body', () => {
    assert.equal(
      found('create function f() returns int language sql begin atomic select 1; end; commit;'),
      'COMMIT',
    );
  });

  it('ends a line comment at LF, CR or CRLF, exactly as PostgreSQL does (review bypass 1)', () => {
    for (const eol of ['\n', '\r', '\r\n']) {
      assert.equal(
        found(`create schema atomicity_probe; -- comment${eol}COMMIT;${eol}select 1;`),
        'COMMIT',
        JSON.stringify(eol),
      );
    }
    assert.equal(found('select 1; -- commit;\rselect 2;'), undefined);
    assert.equal(found('select 1; -- commit;\r\nselect 2;'), undefined);
  });

  it('does not mistake ordinary DDL for a function body (review bypass 2)', () => {
    const lookalike = [
      'create schema atomicity_probe;',
      'create domain atomic as integer;',
      'create table atomicity_probe.t (begin atomic);',
      'COMMIT;',
      'select * from no_such_review_table;',
    ].join('\n');
    assert.equal(found(lookalike), 'COMMIT');
    assert.equal(found('create table t (begin atomic); commit;'), 'COMMIT');
    assert.equal(found('create table t (begin atomic); end; select 1;'), 'END');
    assert.equal(found('create type begin_atomic as (begin atomic); rollback;'), 'ROLLBACK');
    // a parameter named begin of type atomic is not a body either
    assert.equal(
      found('create function f(begin atomic) returns int language sql as $$select 1$$; commit;'),
      'COMMIT',
    );
    assert.equal(found('alter table t add column begin atomic; commit;'), 'COMMIT');
  });

  it('keeps checking after a genuine function body, and inside it', () => {
    const body =
      'create or replace procedure p() language sql begin atomic select 1; select 2; end;';
    assert.equal(found(body), undefined);
    assert.equal(found(`${body} commit;`), 'COMMIT');
    assert.equal(found(`${body} end;`), 'END');
    assert.equal(found(`${body}\n${body}`), undefined);
    assert.equal(
      found('create function f() returns int language sql begin atomic select 1; commit; end;'),
      'COMMIT',
    );
    assert.equal(
      found(
        'create function f() returns int language sql begin atomic select case when true then 1 else 2 end; end;',
      ),
      undefined,
    );
  });

  it('reports an unterminated function body instead of trusting everything after it', () => {
    assert.match(
      found('create function f() returns int language sql begin atomic select 1; commit;') ?? '',
      /COMMIT/,
    );
    assert.match(
      found('create function f() returns int language sql begin atomic select 1;') ?? '',
      /BEGIN ATOMIC/,
    );
  });

  it('is enforced when scripts are loaded, before anything can run', () => {
    const dir = dirWith({ '0001_leaky.sql': 'create schema leaked;\ncommit;\nselect 1;' });
    assert.equal(
      code(() => loadScripts(dir)),
      'TRANSACTION_CONTROL',
    );
  });
});
