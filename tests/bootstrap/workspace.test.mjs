import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('S0-01 workspace structure is valid', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-workspace.mjs'], {
    encoding: 'utf8',
  });
  assert.match(output, /PASS: 3 apps, 9 modules, 4 shared packages/);
});
