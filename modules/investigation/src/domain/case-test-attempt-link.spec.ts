import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LINK_ROLES, linkTestAttempt, parseLinkRole } from './investigation-case';
import { afterStoring, newAttempt, newCase, uutRef } from './test-builders.spec';

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

  it('decides to create a link for an attempt of the same UUT, without any timestamp (the database generates it)', () => {
    const c = newCase();
    const attempt = newAttempt(c.uut);
    const result = linkTestAttempt(c, attempt, 'INITIAL_FAILURE');
    assert.ok(result.ok && result.value.created);
    assert.equal(result.value.link.attemptId, attempt.id);
    assert.equal(result.value.link.caseId, c.id);
    assert.equal(result.value.link.uut.id, c.uut.id);
    assert.ok(
      !('linkedAt' in result.value.link),
      'a new link carries no caller-supplied timestamp',
    );
    assert.equal(c.links.length, 0, 'the input case is unchanged');
    assert.equal(c.version, 1, 'the version changes only when the repository stores the link');
  });

  it('refuses an attempt of another UUT and creates nothing', () => {
    const c = newCase();
    const foreign = newAttempt(uutRef());
    const result = linkTestAttempt(c, foreign, 'SUPPORTING');
    assert.ok(!result.ok);
    assert.equal(result.error.code, 'investigation.uut_mismatch');
    assert.equal(result.error.details?.expected, c.uut.id);
    assert.equal(result.error.details?.actual, foreign.uut.id);
  });

  it('is idempotent for an identical link: the stored link, with its original linkedAt, is returned', () => {
    const c = newCase();
    const attempt = newAttempt(c.uut);
    const first = linkTestAttempt(c, attempt, 'RETEST');
    assert.ok(first.ok && first.value.created);
    const stored = afterStoring(c, first.value.link, '2026-11-15T10:30:00.000Z');
    const again = linkTestAttempt(stored, attempt, 'RETEST');
    assert.ok(again.ok && !again.value.created);
    assert.equal(again.value.link, stored.links[0], 'the stored link, not a new one');
    assert.equal(again.value.link.linkedAt, '2026-11-15T10:30:00.000Z');
  });

  it('permits several roles for the same case and attempt, each as its own link', () => {
    const attempt = newAttempt(newCase().uut);
    let current = newCase(attempt.uut);
    for (const role of LINK_ROLES) {
      const result = linkTestAttempt(current, attempt, role);
      assert.ok(result.ok && result.value.created, role);
      current = afterStoring(current, result.value.link);
    }
    assert.equal(current.links.length, 4);
    assert.equal(current.version, 5);
  });

  it('permits several INITIAL_FAILURE links on one case', () => {
    const c = newCase();
    let current = c;
    for (let n = 0; n < 3; n += 1) {
      const result = linkTestAttempt(current, newAttempt(c.uut), 'INITIAL_FAILURE');
      assert.ok(result.ok && result.value.created);
      current = afterStoring(current, result.value.link);
    }
    assert.equal(current.links.filter((l) => l.role === 'INITIAL_FAILURE').length, 3);
  });

  it('allows one attempt to be linked to many cases of the same UUT (many-to-many)', () => {
    const uut = uutRef();
    const attempt = newAttempt(uut);
    assert.ok(linkTestAttempt(newCase(uut), attempt, 'CONTEXT').ok);
    assert.ok(linkTestAttempt(newCase(uut), attempt, 'CONTEXT').ok);
  });

  it('records a RETEST as a relationship only: no status, no closure, no effectiveness', () => {
    const c = newCase();
    const result = linkTestAttempt(c, newAttempt(c.uut, 'SAT'), 'RETEST');
    assert.ok(result.ok && result.value.created);
    assert.deepEqual(Object.keys(afterStoring(c, result.value.link)).sort(), [
      'id',
      'links',
      'openedAt',
      'uut',
      'version',
    ]);
  });
});
