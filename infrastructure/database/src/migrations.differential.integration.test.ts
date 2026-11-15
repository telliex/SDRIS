import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { findTransactionControl } from './migrations';
import { createIsolatedDatabase, type IsolatedDatabase } from './testing/isolated-database';

/**
 * Differential test: real PostgreSQL is the ground truth for "does this script end the transaction the
 * runner opened?". A sentinel set with SET LOCAL disappears if the script commits, rolls back or ends the
 * transaction. Every script that really escapes MUST be flagged by findTransactionControl; scripts with
 * no control statement must NOT be flagged. (The scanner may additionally flag harmless statements such as
 * BEGIN, which PostgreSQL treats as a no-op inside a transaction; that is deliberate conservatism.)
 */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SEPARATORS = [
  '\n',
  '\r',
  '\r\n',
  ' ',
  '\t',
  ' /* c */ ',
  ' -- c\n',
  ' -- c\r',
  ' -- c\r\n',
  '\n\n',
];
const CONTROL = [
  'commit',
  'COMMIT',
  'Commit work',
  'commit transaction',
  'commit and chain',
  'end',
  'END',
  'end work',
  'rollback',
  'ROLLBACK',
  'rollback work',
  'rollback and chain',
  'abort',
  'ABORT',
  'begin',
  'BEGIN',
  'start transaction',
  'START TRANSACTION',
];
const NEUTRAL_CONTROL = [
  'savepoint sp',
  'savepoint sp; release savepoint sp',
  'savepoint sp; rollback to savepoint sp',
];

function benignPool(n: number): { once?: string; sql: string }[] {
  return [
    { sql: `create table t${n}_a (id int);` },
    { sql: `create table t${n}_b (begin int, atomic int, "commit" int);` },
    { sql: `select 'commit; end; rollback;';` },
    { sql: `select E'it\\'s; commit; end;';` },
    { sql: `select 'it''s; commit';` },
    { sql: `do $$ begin perform 1; end $$;` },
    { sql: `do $tag$ begin perform 1; /* commit; */ end $tag$;` },
    { sql: `/* commit; */ select 1;` },
    { sql: `/* a /* nested commit; */ rollback; */ select 2;` },
    { sql: `-- commit; end;\nselect 3;` },
    { sql: `create function f${n}_a() returns int language sql begin atomic select 1; end;` },
    {
      sql: `create or replace procedure p${n}() language sql begin atomic select 1; select 2; end;`,
    },
    {
      sql: `create function f${n}_b() returns int language sql begin atomic select case when true then 1 else 2 end; end;`,
    },
    { sql: `create function f${n}_c(begin integer) returns int language sql as $$ select 1 $$;` },
    { once: 'domain', sql: `create domain atomic as integer;` },
    { once: 'lookalike', sql: `create table t${n}_c (begin atomic);` }, // needs the domain; added together below
    { once: 'quoted', sql: `create table "end" (x int);` },
  ];
}

function generate(random: () => number, n: number): { sql: string; hasControl: boolean } {
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!;
  const statements: string[] = [];
  const pool = benignPool(n);
  const used = new Set<string>();
  const count = 1 + Math.floor(random() * 5);
  for (let k = 0; k < count; k += 1) {
    const item = pick(pool);
    if (item.once) {
      if (used.has(item.once)) continue;
      used.add(item.once);
      if (item.once === 'lookalike' && !used.has('domain')) {
        used.add('domain');
        statements.push('create domain atomic as integer;');
      }
    }
    statements.push(item.sql);
  }
  const hasControl = random() < 0.75;
  if (hasControl)
    statements.splice(Math.floor(random() * (statements.length + 1)), 0, `${pick(CONTROL)};`);
  else if (random() < 0.3) statements.push(`${pick(NEUTRAL_CONTROL)};`);
  let sql = '';
  for (const statement of statements) sql += statement + pick(SEPARATORS);
  return { sql, hasControl };
}

describe('transaction-control scanner vs PostgreSQL (differential)', () => {
  let target: IsolatedDatabase;
  before(async () => {
    target = await createIsolatedDatabase();
  });
  after(async () => {
    await target.drop();
  });

  it('flags every generated script that PostgreSQL lets escape its transaction', async () => {
    const random = mulberry32(Number(process.env.SDRIS_FUZZ_SEED ?? 20261115));
    const iterations = Number(process.env.SDRIS_FUZZ_ITERATIONS ?? 700);
    const client = await target.connection.pool.connect();
    let escaped = 0;
    let invalid = 0;
    let cleanChecked = 0;
    try {
      for (let n = 0; n < iterations; n += 1) {
        const { sql, hasControl } = generate(random, n);
        const flagged = findTransactionControl(sql) !== undefined;
        let escapedByPostgres = false;
        try {
          await client.query('begin');
          await client.query("select set_config('sdris.probe', 'inside', true)");
          await client.query(sql);
          const probe = await client.query("select current_setting('sdris.probe', true) as v");
          escapedByPostgres = probe.rows[0].v !== 'inside';
        } catch {
          invalid += 1; // PostgreSQL rejected the generated script; it proves nothing either way
          await client.query('rollback').catch(() => undefined);
          continue;
        }
        await client.query('rollback').catch(() => undefined);
        if (escapedByPostgres) {
          escaped += 1;
          assert.ok(
            flagged,
            `PostgreSQL let this script escape its transaction but the scanner did not flag it:\n${JSON.stringify(sql)}`,
          );
        }
        if (!hasControl) {
          cleanChecked += 1;
          assert.ok(
            !flagged,
            `scanner rejected a script with no transaction control:\n${JSON.stringify(sql)}`,
          );
        }
        // drop anything a committing script left behind so later scripts start clean
        await client.query('drop schema public cascade; create schema public');
      }
    } finally {
      client.release();
    }
    assert.ok(
      escaped >= 150,
      `generator too weak: only ${escaped} escaping scripts (invalid: ${invalid})`,
    );
    assert.ok(
      cleanChecked >= iterations * 0.14,
      `generator too weak: only ${cleanChecked} control-free scripts`,
    );
  });
});
