import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

/**
 * Version-controlled SQL script runner used for both migrations and seeds.
 *
 * - Files are `NNNN_snake_case.sql`, applied in ascending numeric order, each in its own transaction.
 * - Applied scripts are recorded with a SHA-256 checksum. Editing an applied script, deleting it, or
 *   adding a script numbered below one already applied is an error: history is append-only.
 *   (Neither Drizzle's nor Kysely's migrator detects an edited applied migration.)
 * - A session advisory lock serialises concurrent runners, so re-running or racing is safe.
 * - The transaction-control scanner reads string literals the way PostgreSQL does when
 *   standard_conforming_strings is ON (a backslash in a plain string is an ordinary character). The
 *   session may start with it OFF (connection option, role or database default, or an earlier migration
 *   that set it), so every script's transaction begins with `SET LOCAL standard_conforming_strings = on`.
 *   PostgreSQL lexes a whole query string once, under the value in force when it is sent, so this makes
 *   the scanner and the server agree for that script, and the next script starts from the same pin
 *   again however the previous one left the session.
 * - Scripts must not contain their own transaction control (BEGIN, COMMIT, ROLLBACK, END, ...). A script
 *   that committed early would leave its changes behind without a tracking row (non-atomic), so such
 *   files are rejected before any script runs.
 */
export type ScriptKind = 'migration' | 'seed';

const TRACKING_TABLE: Record<ScriptKind, string> = {
  migration: 'system.schema_migrations',
  seed: 'system.schema_seeds',
};
/** Arbitrary constant identifying SDRIS's script-runner advisory lock. */
const ADVISORY_LOCK_KEY = 7204051;
/** The one lexical session setting the scanner depends on; see the header comment. */
const LEXICAL_PIN = 'set local standard_conforming_strings = on';
const FILE_NAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export type MigrationErrorCode =
  | 'INVALID_FILE_NAME'
  | 'DUPLICATE_VERSION'
  | 'CHECKSUM_MISMATCH'
  | 'MISSING_FILE'
  | 'OUT_OF_ORDER'
  | 'TRANSACTION_CONTROL'
  | 'SCRIPT_FAILED';

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

// ---- Transaction-control detection ---------------------------------------------------------

/**
 * Replaces comments, string literals, quoted identifiers and dollar-quoted bodies with a space so that
 * only SQL structure remains. This is a lexical scan, not a parser. It only removes text PostgreSQL
 * itself treats as non-code; it never skips a statement.
 */
function stripNonCode(sql: string): string {
  const out: string[] = [];
  const isIdentChar = (c: string | undefined) => c !== undefined && /[\w$\u0080-\uffff]/.test(c);
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      // PostgreSQL ends a line comment at either LF or CR (its lexer's non_newline is [^\n\r]).
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i += 1;
      out.push(' ');
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out.push(' ');
    } else if (c === "'") {
      const escapeString = /[eE]/.test(sql[i - 1] ?? '') && !isIdentChar(sql[i - 2]);
      i += 1;
      while (i < sql.length) {
        if (escapeString && sql[i] === '\\') i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      i += 1;
      out.push(' ');
    } else if (c === '"') {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') break;
        else i += 1;
      }
      i += 1;
      out.push(' ');
    } else if (c === '$' && !isIdentChar(sql[i - 1])) {
      const tag = /^\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? sql.length : close + tag[0].length;
        out.push(' ');
      } else {
        out.push(c);
        i += 1;
      }
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

export interface TransactionControl {
  readonly keyword: string;
  /** 1-based index of the offending statement within the script. */
  readonly statement: number;
}

/** Blanks everything inside parentheses, so only text at nesting depth 0 remains. */
function topLevelOnly(statement: string): string {
  let depth = 0;
  let out = '';
  for (const c of statement) {
    if (c === '(') {
      depth += 1;
      out += ' ';
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      out += ' ';
    } else {
      out += depth === 0 ? c : ' ';
    }
  }
  return out;
}

/**
 * True only for a statement that really opens a SQL-standard function body:
 * `CREATE [OR REPLACE] FUNCTION|PROCEDURE ... BEGIN ATOMIC` with `BEGIN ATOMIC` outside any parentheses.
 * A column, type or parameter that merely happens to be called `begin`/`atomic` does not qualify.
 */
function opensAtomicBody(words: string[], statement: string): boolean {
  const head = words[1] === 'or' && words[2] === 'replace' ? words[3] : words[1];
  if (words[0] !== 'create' || (head !== 'function' && head !== 'procedure')) return false;
  return /\bbegin\s+atomic\b/.test(topLevelOnly(statement).toLowerCase());
}

/**
 * Finds a statement that would end or restart the transaction the runner wraps around a script.
 * SAVEPOINT / ROLLBACK TO / RELEASE and a plain PREPARE are allowed: they stay inside the transaction.
 *
 * Every statement is checked, including those inside a `BEGIN ATOMIC ... END` function body; the only
 * thing a body changes is that a lone `END` closes it instead of being reported. A body that is never
 * closed is reported rather than trusted, because everything after it would otherwise be unchecked.
 */
export function findTransactionControl(sql: string): TransactionControl | undefined {
  const statements = stripNonCode(sql).split(';');
  let inAtomicBody = false;
  const at = (keyword: string, index: number): TransactionControl => ({
    keyword,
    statement: index + 1,
  });
  for (let index = 0; index < statements.length; index += 1) {
    const text = statements[index]!;
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const [first, second] = words;
    if (first === undefined) continue;
    if (inAtomicBody && words.length === 1 && first === 'end') {
      inAtomicBody = false;
      continue;
    }
    if (first === 'start' && second === 'transaction') return at('START TRANSACTION', index);
    if (first === 'prepare' && second === 'transaction') return at('PREPARE TRANSACTION', index);
    if (['begin', 'commit', 'end', 'rollback', 'abort'].includes(first)) {
      if (first === 'rollback' && second === 'to') continue;
      return at(first.toUpperCase(), index);
    }
    if (!inAtomicBody && opensAtomicBody(words, text)) inAtomicBody = true;
  }
  return inAtomicBody ? at('BEGIN ATOMIC without a closing END', statements.length - 1) : undefined;
}

export interface ScriptFile {
  readonly version: string;
  readonly name: string;
  readonly fileName: string;
  readonly checksum: string;
  readonly sql: string;
}

export type ScriptState = 'applied' | 'pending' | 'modified' | 'missing';

export interface ScriptStatus {
  readonly version: string;
  readonly fileName: string;
  readonly state: ScriptState;
  readonly appliedAt?: Date;
}

/** Line endings are normalised so a Windows checkout does not look like an edit. */
export const checksumOf = (sql: string): string =>
  createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

export function loadScripts(dir: string): ScriptFile[] {
  if (!existsSync(dir)) return [];
  const files: ScriptFile[] = [];
  for (const fileName of readdirSync(dir).sort()) {
    if (fileName.startsWith('.') || !fileName.endsWith('.sql')) continue;
    const match = FILE_NAME.exec(fileName);
    if (!match) {
      throw new MigrationError(
        'INVALID_FILE_NAME',
        `"${fileName}" does not match NNNN_snake_case.sql (for example 0002_add_thing.sql).`,
        fileName,
      );
    }
    const sql = readFileSync(path.join(dir, fileName), 'utf8');
    const control = findTransactionControl(sql);
    if (control) {
      throw new MigrationError(
        'TRANSACTION_CONTROL',
        `${fileName} contains ${control.keyword} (statement ${control.statement}). The runner wraps every script and its ` +
          'tracking row in one transaction; a script that ends or restarts it can leave changes applied but unrecorded. ' +
          'Remove the transaction-control statement.',
        fileName,
      );
    }
    files.push({ version: match[1]!, name: match[2]!, fileName, checksum: checksumOf(sql), sql });
  }
  const seen = new Map<string, string>();
  for (const file of files) {
    const previous = seen.get(file.version);
    if (previous) {
      throw new MigrationError(
        'DUPLICATE_VERSION',
        `Version ${file.version} is used by both "${previous}" and "${file.fileName}".`,
        file.fileName,
      );
    }
    seen.set(file.version, file.fileName);
  }
  return files;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

async function ensureTracking(client: PoolClient, kind: ScriptKind): Promise<void> {
  await client.query('create schema if not exists system');
  await client.query(
    `create table if not exists ${TRACKING_TABLE[kind]} (
       version    text primary key,
       name       text not null,
       checksum   text not null,
       applied_at timestamptz not null default now()
     )`,
  );
}

async function readApplied(client: PoolClient, kind: ScriptKind): Promise<AppliedRow[]> {
  const result = await client.query<AppliedRow>(
    `select version, name, checksum, applied_at from ${TRACKING_TABLE[kind]} order by version`,
  );
  return result.rows;
}

function classify(files: ScriptFile[], applied: AppliedRow[]): ScriptStatus[] {
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));
  const statuses: ScriptStatus[] = files.map((file) => {
    const row = appliedByVersion.get(file.version);
    if (!row) return { version: file.version, fileName: file.fileName, state: 'pending' };
    return {
      version: file.version,
      fileName: file.fileName,
      state: row.checksum === file.checksum ? 'applied' : 'modified',
      appliedAt: row.applied_at,
    };
  });
  const onDisk = new Set(files.map((file) => file.version));
  for (const row of applied) {
    if (!onDisk.has(row.version)) {
      statuses.push({
        version: row.version,
        fileName: `${row.version}_${row.name}.sql`,
        state: 'missing',
        appliedAt: row.applied_at,
      });
    }
  }
  return statuses.sort((a, b) => a.version.localeCompare(b.version));
}

function assertHistoryIntact(statuses: ScriptStatus[]): void {
  const modified = statuses.find((s) => s.state === 'modified');
  if (modified) {
    throw new MigrationError(
      'CHECKSUM_MISMATCH',
      `${modified.fileName} was modified after it was applied. Applied scripts are immutable: ` +
        'restore the original content and add a new numbered script for the change.',
      modified.fileName,
    );
  }
  const missing = statuses.find((s) => s.state === 'missing');
  if (missing) {
    throw new MigrationError(
      'MISSING_FILE',
      `${missing.fileName} is recorded as applied but its file is missing.`,
      missing.fileName,
    );
  }
  let highestApplied = '';
  for (const s of statuses)
    if (s.state === 'applied' && s.version > highestApplied) highestApplied = s.version;
  const late = statuses.find((s) => s.state === 'pending' && s.version < highestApplied);
  if (late) {
    throw new MigrationError(
      'OUT_OF_ORDER',
      `${late.fileName} is pending but a later version (${highestApplied}) is already applied. ` +
        'Renumber it above the latest applied version.',
      late.fileName,
    );
  }
}

async function withLock<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      return await work(client);
    } finally {
      await client
        .query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Reports the state of every script without changing any database object except tracking tables. */
export async function scriptStatus(
  pool: Pool,
  kind: ScriptKind,
  dir: string,
): Promise<ScriptStatus[]> {
  const files = loadScripts(dir);
  return withLock(pool, async (client) => {
    await ensureTracking(client, kind);
    return classify(files, await readApplied(client, kind));
  });
}

/** Applies pending scripts in order. Returns the file names applied by this call. */
export async function applyScripts(pool: Pool, kind: ScriptKind, dir: string): Promise<string[]> {
  const files = loadScripts(dir);
  return withLock(pool, async (client) => {
    await ensureTracking(client, kind);
    const statuses = classify(files, await readApplied(client, kind));
    assertHistoryIntact(statuses);

    const done: string[] = [];
    for (const file of files) {
      if (statuses.find((s) => s.version === file.version)?.state !== 'pending') continue;
      try {
        await client.query('begin');
        await client.query(LEXICAL_PIN);
        await client.query(file.sql);
        await client.query(
          `insert into ${TRACKING_TABLE[kind]} (version, name, checksum) values ($1, $2, $3)`,
          [file.version, file.name, file.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new MigrationError(
          'SCRIPT_FAILED',
          `${file.fileName} failed and was rolled back: ${reason}`,
          file.fileName,
        );
      }
      done.push(file.fileName);
    }
    return done;
  });
}
