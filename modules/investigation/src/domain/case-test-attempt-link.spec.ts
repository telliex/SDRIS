import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LINK_ROLES, linkTestAttempt, parseLinkRole } from './investigation-case';
import { newAttempt, newCase, timestamp, uutRef } from './test-builders.spec';

const at = timestamp('2026-11-15T10:30:00.000Z');

describe('CaseTestAttemptLink (domain)', () => {
  it('knows exactly the four roles, in retrieval order', () => {
    assert.deepEqual([...LINK_ROLES], ['INITIAL_FAILURE', 'RETEST', 'SUPPORTING', 'CONTEXT']);
    for (const role of LINK_ROLES) assert.ok(parseLinkRole(role).ok);
  });

  it('rejects an unknown role without inferring or normalising one', () => {
    for (const bad of ['retest', 'FINAL', '', ' RETEST', undefined, 3]) {
      const parsed = parseLinkRole(bad);
      assert.ok(!parsed.ok && parsed.error.code === 'investigation.invalid_link_role', String(bad));
    }
  });

  it('links an attempt of the same UUT without mutating the original case', () => {
    const c = newCase();
    const attempt = newAttempt(c.uut);
    const result = linkTestAttempt(c, attempt, 'INITIAL_FAILURE', at);
    assert.ok(result.ok && result.value.created);
    assert.equal(result.value.investigationCase.links.length, 1);
    assert.equal(result.value.link.attemptId, attempt.id);
    assert.equal(result.value.link.caseId, c.id);
    assert.equal(result.value.link.uut.id, c.uut.id);
    assert.equal(result.value.link.linkedAt, at);
    assert.equal(c.links.length, 0, 'the input case is unchanged');
    assert.equal(
      result.value.investigationCase.version,
      c.version,
      'the version changes only when persisted',
    );
  });

  it('refuses an attempt of another UUT and attaches nothing', () => {
    const c = newCase();
    const foreign = newAttempt(uutRef());
    const result = linkTestAttempt(c, foreign, 'SUPPORTING', at);
    assert.ok(!result.ok);
    assert.equal(result.error.code, 'investigation.uut_mismatch');
    assert.equal(result.error.details?.expected, c.uut.id);
    assert.equal(result.error.details?.actual, foreign.uut.id);
    assert.equal(c.links.length, 0);
  });

  it('is idempotent for an identical link: same case instance, original linkedAt kept, nothing overwritten', () => {
    const c = newCase();
    const attempt = newAttempt(c.uut);
    const first = linkTestAttempt(c, attempt, 'RETEST', at);
    assert.ok(first.ok);
    const later = timestamp('2026-11-15T12:00:00.000Z');
    const again = linkTestAttempt(first.value.investigationCase, attempt, 'RETEST', later);
    assert.ok(again.ok && !again.value.created);
    assert.equal(again.value.investigationCase, first.value.investigationCase);
    assert.equal(again.value.link.linkedAt, at, 'the original link is returned, not overwritten');
    assert.equal(again.value.investigationCase.links.length, 1);
  });

  it('permits several roles for the same case and attempt, each as its own link', () => {
    const c = newCase();
    const attempt = newAttempt(c.uut);
    let current = c;
    for (const role of LINK_ROLES) {
      const result = linkTestAttempt(current, attempt, role, at);
      assert.ok(result.ok && result.value.created, role);
      current = result.value.investigationCase;
    }
    assert.equal(current.links.length, 4);
  });

  it('permits several INITIAL_FAILURE links on one case', () => {
    const c = newCase();
    let current = c;
    for (let n = 0; n < 3; n += 1) {
      const result = linkTestAttempt(current, newAttempt(c.uut), 'INITIAL_FAILURE', at);
      assert.ok(result.ok && result.value.created);
      current = result.value.investigationCase;
    }
    assert.equal(current.links.filter((l) => l.role === 'INITIAL_FAILURE').length, 3);
  });

  it('allows one attempt to be linked to many cases of the same UUT (many-to-many)', () => {
    const uut = uutRef();
    const attempt = newAttempt(uut);
    const caseA = newCase(uut);
    const caseB = newCase(uut);
    assert.ok(linkTestAttempt(caseA, attempt, 'CONTEXT', at).ok);
    assert.ok(linkTestAttempt(caseB, attempt, 'CONTEXT', at).ok);
  });

  it('records a RETEST as a relationship only: no status, no closure, no effectiveness', () => {
    const c = newCase();
    const result = linkTestAttempt(c, newAttempt(c.uut, 'SAT'), 'RETEST', at);
    assert.ok(result.ok);
    const updated = result.value.investigationCase;
    assert.deepEqual(Object.keys(updated).sort(), [
      'id',
      'links',
      'observations',
      'openedAt',
      'uut',
      'version',
    ]);
  });
});
