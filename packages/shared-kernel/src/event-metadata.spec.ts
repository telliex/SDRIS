import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditMetadata, parseEventMetadata, type DomainEventEnvelope } from './index';
import { FIXED_TIMESTAMP, UUID_A, UUID_B, fixedGenerator } from './test-support';

const generator = fixedGenerator();
const eventId = generator.next<'DomainEvent'>();
const auditId = generator.next<'AuditRecord'>();
const causationId = generator.next<'DomainEvent'>();

function validEvent(): Record<string, unknown> {
  return {
    eventId,
    eventType: 'investigation.case_opened',
    schemaVersion: 1,
    occurredAt: FIXED_TIMESTAMP,
    aggregate: { entityType: 'InvestigationCase', id: UUID_B },
    correlationId: 'corr-synthetic-1',
  };
}

function validAudit(): Record<string, unknown> {
  return {
    auditId,
    action: 'investigation.case_viewed',
    schemaVersion: 1,
    occurredAt: FIXED_TIMESTAMP,
    actor: { entityType: 'Actor', id: UUID_A },
    subject: { entityType: 'InvestigationCase', id: UUID_B },
    correlationId: 'corr-synthetic-1',
  };
}

test('event metadata: minimal valid input parses and is frozen', () => {
  const result = parseEventMetadata(validEvent());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.eventType, 'investigation.case_opened');
  assert.equal(result.value.recordedAt, undefined);
  assert.equal('recordedAt' in result.value, false);
  assert.ok(Object.isFrozen(result.value));
});

test('event metadata: optional fields are carried through', () => {
  const result = parseEventMetadata({
    ...validEvent(),
    recordedAt: '2023-11-14T22:13:21.250Z',
    actor: { entityType: 'Actor', id: UUID_A },
    causationId,
    executionContext: { source: 'api', environment: 'local', attributes: { requestId: 'r-1' } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.recordedAt, '2023-11-14T22:13:21.250Z');
  assert.equal(result.value.actor?.id, UUID_A);
  assert.equal(result.value.causationId, causationId);
  assert.deepEqual(result.value.executionContext, {
    source: 'api',
    environment: 'local',
    attributes: { requestId: 'r-1' },
  });
});

test('event metadata: occurrence time is distinct from processing time', () => {
  const result = parseEventMetadata({
    ...validEvent(),
    occurredAt: '2023-11-14T22:00:00.000Z',
    recordedAt: '2023-11-14T22:13:20.000Z',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.value.occurredAt, result.value.recordedAt);
});

test('event metadata: every required field is enforced', () => {
  for (const field of [
    'eventId',
    'eventType',
    'schemaVersion',
    'occurredAt',
    'aggregate',
    'correlationId',
  ]) {
    const input = validEvent();
    delete input[field];
    const result = parseEventMetadata(input);
    assert.equal(result.ok, false, `missing ${field}`);
    if (!result.ok) assert.ok(result.error.code.startsWith('shared_kernel.'), field);
  }
});

test('event metadata: rejects malformed identifiers and timestamps', () => {
  const mutations: [string, unknown][] = [
    ['eventId', 'not-a-uuid'],
    ['eventId', '550e8400-e29b-41d4-a716-446655440000'],
    ['eventType', 'Investigation.CaseOpened'],
    ['eventType', ''],
    ['schemaVersion', 0],
    ['schemaVersion', 1.5],
    ['schemaVersion', '1'],
    ['occurredAt', '2026-02-30T00:00:00Z'],
    ['occurredAt', '2026-11-14T10:00:00+08:00'],
    ['occurredAt', 1_700_000_000_000],
    ['recordedAt', 'yesterday'],
    ['correlationId', 'has space'],
    ['causationId', 'abc'],
    ['aggregate', { entityType: 'InvestigationCase', id: 'bad' }],
    ['actor', 'someone'],
    ['executionContext', { source: '' }],
    ['executionContext', { source: 'api', attributes: { k: 1 } }],
    ['executionContext', 'api'],
  ];
  for (const [field, value] of mutations) {
    const result = parseEventMetadata({ ...validEvent(), [field]: value });
    assert.equal(result.ok, false, `${field}=${JSON.stringify(value)}`);
  }
  assert.equal(parseEventMetadata(null).ok, false);
  assert.equal(parseEventMetadata('x').ok, false);
});

test('event metadata: reports which field failed', () => {
  const result = parseEventMetadata({ ...validEvent(), occurredAt: 'nope' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.details?.field, 'occurredAt');
});

test('event metadata: expected event type narrows the result type', () => {
  const ok = parseEventMetadata(validEvent(), 'investigation.case_opened');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    const type: 'investigation.case_opened' = ok.value.eventType;
    assert.equal(type, 'investigation.case_opened');
  }
  assert.equal(parseEventMetadata(validEvent(), 'investigation.case_closed').ok, false);
});

test('event metadata: copies input and does not alias mutable context', () => {
  const attributes = { requestId: 'r-1' };
  const result = parseEventMetadata({
    ...validEvent(),
    executionContext: { source: 'api', attributes },
  });
  attributes.requestId = 'tampered';
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.executionContext?.attributes?.requestId, 'r-1');
});

test('event envelope pairs metadata with a context-owned payload', () => {
  const metadata = parseEventMetadata(validEvent(), 'investigation.case_opened');
  if (!metadata.ok) throw new Error('expected ok');
  const envelope: DomainEventEnvelope<'investigation.case_opened', { title: string }> = {
    metadata: metadata.value,
    payload: { title: 'Synthetic case' },
  };
  assert.equal(envelope.payload.title, 'Synthetic case');
});

test('audit metadata: valid input parses', () => {
  const result = parseAuditMetadata(validAudit());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.action, 'investigation.case_viewed');
  assert.equal(result.value.actor.id, UUID_A);
  assert.ok(Object.isFrozen(result.value));
});

test('audit metadata: actor and subject are required, unlike for events', () => {
  for (const field of ['auditId', 'action', 'actor', 'subject', 'occurredAt', 'correlationId']) {
    const input = validAudit();
    delete input[field];
    assert.equal(parseAuditMetadata(input).ok, false, `missing ${field}`);
  }
});

test('audit metadata: rejects malformed identifiers and timestamps', () => {
  const mutations: [string, unknown][] = [
    ['auditId', 'abc'],
    ['action', 'Bad Action'],
    ['occurredAt', 'tomorrow'],
    ['recordedAt', '2026-13-01T00:00:00Z'],
    ['actor', { entityType: 'Actor', id: 'abc' }],
    ['subject', null],
  ];
  for (const [field, value] of mutations) {
    assert.equal(parseAuditMetadata({ ...validAudit(), [field]: value }).ok, false, field);
  }
});
