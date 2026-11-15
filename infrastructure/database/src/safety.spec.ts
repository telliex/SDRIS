import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertDisposableLocalTarget, describeTarget, UnsafeDatabaseTargetError } from './safety';

const ok = (url: string, env: { NODE_ENV?: string } = { NODE_ENV: 'development' }) =>
  assertDisposableLocalTarget(url, 'reset the database', env);
const refused = (url: string, env: { NODE_ENV?: string } = { NODE_ENV: 'development' }) =>
  assert.throws(() => ok(url, env), UnsafeDatabaseTargetError);

describe('assertDisposableLocalTarget', () => {
  it('accepts local development and test databases', () => {
    assert.equal(ok('postgresql://u:p@localhost:5432/sdris_local').database, 'sdris_local');
    assert.equal(ok('postgresql://u:p@127.0.0.1:5432/sdris_test').database, 'sdris_test');
    assert.equal(
      ok('postgresql://u:p@[::1]:5432/sdris_test_ab12cd34').database,
      'sdris_test_ab12cd34',
    );
    assert.equal(ok('postgres://u:p@localhost/sdris_local', {}).port, '5432');
  });

  it('rejects database names outside the allow-list', () => {
    for (const name of [
      'sdris_prod',
      'sdris',
      'postgres',
      'sdris_local_x-y',
      'sdris_staging',
      'prod_sdris_local',
      'SDRIS_LOCAL',
    ]) {
      refused(`postgresql://u:p@localhost:5432/${name}`);
    }
  });

  it('rejects non-local hosts even when the database name is allowed', () => {
    refused('postgresql://u:p@db.example.com:5432/sdris_local');
    refused('postgresql://u:p@10.0.0.5:5432/sdris_test');
    refused('postgresql://u:p@localhost.example.com/sdris_local');
    refused('postgresql://u:p@/sdris_local'); // empty host would fall back to PGHOST
  });

  it('rejects URL parameters that redirect the connection to another host', () => {
    refused('postgresql://u:p@localhost/sdris_local?host=db.example.com');
    refused('postgresql://u:p@localhost/sdris_local?hostaddr=10.0.0.5');
    refused('postgresql://u:p@localhost/sdris_local?service=prod');
  });

  it('rejects production regardless of the target', () => {
    refused('postgresql://u:p@localhost:5432/sdris_local', { NODE_ENV: 'production' });
  });

  it('rejects unparseable URLs and other protocols', () => {
    refused('not a url');
    refused('mysql://u:p@localhost/sdris_local');
  });

  it('names the action and never echoes the password', () => {
    try {
      ok('postgresql://admin:s3cret@db.example.com/sdris_prod');
      assert.fail('expected refusal');
    } catch (error) {
      assert.ok(error instanceof UnsafeDatabaseTargetError);
      assert.match(error.message, /reset the database/);
      assert.doesNotMatch(error.message, /s3cret/);
    }
  });
});

describe('describeTarget', () => {
  it('omits the password', () => {
    const target = describeTarget('postgresql://admin:s3cret@localhost:5433/sdris_local');
    assert.deepEqual(target, {
      host: 'localhost',
      port: '5433',
      database: 'sdris_local',
      user: 'admin',
    });
  });
});
