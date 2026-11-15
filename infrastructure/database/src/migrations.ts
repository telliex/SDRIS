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
 */
export type ScriptKind = 'migration' | 'seed';

const TRACKING_TABLE: Record<ScriptKind, string> = {
  migration: 'system.schema_migrations',
  seed: 'system.schema_seeds',
};
/** Arbitrary constant identifying SDRIS's script-runner advisory lock. */
const ADVISORY_LOCK_KEY = 7204051;
const FILE_NAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export type MigrationErrorCode =
  | 'INVALID_FILE_NAME'
  | 'DUPLICATE_VERSION'
  | 'CHECKSUM_MISMATCH'
  | 'MISSING_FILE'
  | 'OUT_OF_ORDER'
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
