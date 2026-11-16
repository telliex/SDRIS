import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newEntityId } from '@sdris/shared-kernel';
import { openCase } from './investigation-case';
import { newCase, uutRef } from './test-builders.spec';

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

  it('opens a draft with only identity and UUT: no timestamp (PostgreSQL generates opened_at)', () => {
    const uut = uutRef();
    const draft = openCase({ id: newEntityId<'InvestigationCase'>(), uut });
    assert.deepEqual(Object.keys(draft).sort(), ['id', 'uut']);
    assert.equal(draft.uut.id, uut.id);
  });
});
