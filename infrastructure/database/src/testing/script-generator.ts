/**
 * Deterministic generator of migration-script text for scanner and runner tests. Every script starts by
 * creating a uniquely named marker schema `m<n>`, so a test can tell from the database alone whether any
 * part of the script was committed. Fragments deliberately include the constructs that have defeated the
 * transaction-control scanner before (CR/LF/CRLF comments, `begin atomic` lookalikes, backslash strings).
 */
export const mulberry32 = (seed: number) => () => {
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

interface Fragment {
  once?: string;
  sql: string;
}

function benignFragments(n: number): Fragment[] {
  return [
    { sql: `create table t${n}_a (id int);` },
    { sql: `create table t${n}_b (begin int, atomic int, "commit" int);` },
    { sql: `select 'commit; end; rollback;';` },
    { sql: `select E'it\\'s; commit; end;';` },
    { sql: `select 'it''s; commit';` },
    // plain strings containing backslashes: their meaning depends on standard_conforming_strings
    { sql: `select 'a\\';` },
    { sql: `select 'a\\'';` },
    { sql: `select 'back\\\\slash; commit;';` },
    { sql: `select 'a\\'';\nCOMMIT;\nselect 'x';` },
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
    { once: 'lookalike', sql: `create table t${n}_c (begin atomic);` },
    { once: 'quoted', sql: `create table "end" (x int);` },
  ];
}

export interface GeneratedScript {
  readonly sql: string;
  /** Marker schema created by the first statement. */
  readonly marker: string;
  /** True when a control statement was deliberately inserted. */
  readonly hasControl: boolean;
}

export function generateScript(random: () => number, n: number): GeneratedScript {
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!;
  const marker = `m${n}`;
  const statements: string[] = [];
  const pool = benignFragments(n);
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
  // a statement that fails at run time, so side effects committed before it are the only evidence
  if (random() < 0.35) statements.push(`select * from no_such_table_${n};`);
  statements.unshift(`create schema ${marker};`);
  let sql = '';
  for (const statement of statements) sql += statement + pick(SEPARATORS);
  return { sql, marker, hasControl };
}
