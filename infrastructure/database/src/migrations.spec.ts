import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { checksumOf, loadScripts, MigrationError } from './migrations';
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

describe('committed baseline migration', () => {
  it('creates exactly the schemas in the ownership map and no tables', () => {
    const migrations = loadScripts(path.resolve(__dirname, '..', 'migrations'));
    assert.equal(migrations[0]?.fileName, '0001_create_bounded_context_schemas.sql');
    const sql = migrations.map((m) => m.sql).join('\n');
    const created = [...sql.matchAll(/create schema if not exists (\w+);/g)].map((m) => m[1]);
    assert.deepEqual([...created].sort(), [...SCHEMA_NAMES].sort());
    assert.doesNotMatch(sql, /create\s+table/i, 'S0-04 must not create business tables');
  });
});
