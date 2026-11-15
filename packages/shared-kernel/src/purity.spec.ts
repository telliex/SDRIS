import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kernel from './index';

const here = __dirname;
const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

test('shared kernel has no framework, ORM or cross-context imports', () => {
  const forbidden =
    /from\s+['"](@nestjs|typeorm|@prisma|prisma|pg|mikro-orm|knex|drizzle|@sdris\/)/;
  for (const file of sources) {
    const text = readFileSync(join(here, file), 'utf8');
    assert.doesNotMatch(text, forbidden, file);
  }
});

test('public entry point exports exactly the intended runtime API', () => {
  assert.deepEqual(Object.keys(kernel).sort(), [
    'createEntityIdGenerator',
    'createEntityRef',
    'createError',
    'createRevisionRef',
    'entityRefEquals',
    'err',
    'getEntityIdTimestampMs',
    'isEntityId',
    'isEntityType',
    'isErr',
    'isErrorCode',
    'isOk',
    'isTimestamp',
    'newEntityId',
    'ok',
    'parseAuditMetadata',
    'parseCorrelationId',
    'parseEntityId',
    'parseEntityRef',
    'parseEventMetadata',
    'parseRevision',
    'parseRevisionRef',
    'parseTimestamp',
    'revisionEquals',
    'revisionRefEquals',
    'timestampFromDate',
    'timestampToDate',
  ]);
});
