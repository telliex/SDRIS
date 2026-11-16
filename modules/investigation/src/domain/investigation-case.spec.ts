import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newEntityId } from '@sdris/shared-kernel';
import { openCase } from './investigation-case';
import { newCase, timestamp, uutRef } from './test-builders.spec';

describe('InvestigationCase aggregate', () => {
  it('opens a case at version 1 with no links and a frozen state', () => {
    const c = newCase();
    assert.equal(c.version, 1);
    assert.deepEqual(c.links, []);
    assert.ok(Object.isFrozen(c));
  });

  it('holds exactly identity, UUT reference, opened_at, version and links: no lifecycle, no description', () => {
    const c = newCase();
    assert.deepEqual(Object.keys(c).sort(), ['id', 'links', 'openedAt', 'uut', 'version']);
  });

  it('records when SDRIS opened the investigation and references exactly one UUT', () => {
    const uut = uutRef();
    const opened = openCase({
      id: newEntityId<'InvestigationCase'>(),
      uut,
      openedAt: timestamp('2026-11-15T10:00:00.000Z'),
    });
    assert.equal(opened.openedAt, '2026-11-15T10:00:00.000Z');
    assert.equal(opened.uut.id, uut.id);
  });
});
