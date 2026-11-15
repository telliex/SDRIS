import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkArchitecture } from '../../scripts/architecture/check.mjs';
import { buildScenario, readExpect, repoRoot, runCli, scenarios } from './helpers.mjs';

const keyOf = (v) => `${v.rule} @ ${v.file}`;

for (const { name, dir } of scenarios('invalid')) {
  test(`invalid/${name} is rejected with the expected rule`, () => {
    const expected = readExpect(dir);
    const { root, matrixPath, cleanup } = buildScenario(dir);
    try {
      const { violations } = checkArchitecture({ root, matrixPath });
      const actual = violations.map(keyOf).sort();
      const wanted = expected.violations.map(keyOf).sort();
      assert.deepEqual(actual, wanted, JSON.stringify(violations, null, 2));
      if (expected.messageIncludes) {
        assert.ok(
          violations.some((v) => v.message.includes(expected.messageIncludes)),
          `no message includes "${expected.messageIncludes}"`,
        );
      }

      // The CLI must fail with a non-zero exit code and name the rule and file.
      const cli = runCli(['--root', root, '--matrix', matrixPath]);
      assert.equal(cli.status, 1, cli.stdout + cli.stderr);
      for (const v of expected.violations) {
        assert.ok(cli.stderr.includes(v.rule), `stderr missing rule ${v.rule}`);
        assert.ok(cli.stderr.includes(v.file), `stderr missing file ${v.file}`);
      }
    } finally {
      cleanup();
    }
  });
}

for (const { name, dir } of scenarios('valid')) {
  test(`valid/${name} is accepted`, () => {
    const expected = readExpect(dir);
    const { root, matrixPath, cleanup } = buildScenario(dir);
    try {
      const { violations, notes } = checkArchitecture({ root, matrixPath });
      assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
      assert.equal(notes.length, expected.notes ?? 0);
      const cli = runCli(['--root', root, '--matrix', matrixPath]);
      assert.equal(cli.status, 0, cli.stdout + cli.stderr);
      assert.match(cli.stdout, /^PASS/);
    } finally {
      cleanup();
    }
  });
}

test('diagnostics identify importing file, line, specifier, target package and rule', () => {
  const dir = scenarios('invalid').find((s) => s.name.startsWith('01-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    const [v] = checkArchitecture({ root, matrixPath }).violations;
    assert.equal(v.rule, 'boundary/private-import');
    assert.equal(v.file, 'modules/investigation/src/application/open-case.ts');
    assert.equal(v.line, 1);
    assert.equal(v.specifier, '@sdris/evidence/src/domain/model');
    assert.equal(v.from, '@sdris/investigation');
    assert.equal(v.to, '@sdris/evidence');
    assert.ok(v.hint);
  } finally {
    cleanup();
  }
});

test('the real repository complies and the command runs from a clean checkout', () => {
  const cli = runCli([]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /PASS: architecture boundaries hold \(16 packages/);
  const { violations } = checkArchitecture({ root: repoRoot });
  assert.deepEqual(violations, []);
});

test('the default matrix grants no module-to-module dependency', async () => {
  const { default: matrix } = await import('../../scripts/architecture/dependency-matrix.json', {
    with: { type: 'json' },
  });
  assert.deepEqual(matrix.moduleDependencies, {});
});

test('CLI exits 2 when it cannot analyse the root', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'sdris-arch-empty-'));
  try {
    const cli = runCli(['--root', empty]);
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /no workspace packages/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('CLI --json emits machine-readable violations', () => {
  const dir = scenarios('invalid').find((s) => s.name.startsWith('04-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    const cli = runCli(['--root', root, '--matrix', matrixPath, '--json']);
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stdout).violations[0].rule, 'boundary/private-import');
  } finally {
    cleanup();
  }
});

// ---- Documented limitations: these tests pin the current behaviour ------------------------------

test('limitation: non-literal dynamic imports are not violations, only notes', () => {
  const dir = scenarios('valid').find((s) => s.name.startsWith('10-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    const result = checkArchitecture({ root, matrixPath });
    assert.deepEqual(result.violations, []);
    assert.equal(result.notes.length, 1);
    assert.match(result.notes[0].message, /cannot be analysed/);
  } finally {
    cleanup();
  }
});

test('limitation: import cycles inside one package are allowed', () => {
  const dir = scenarios('valid').find((s) => s.name.startsWith('04-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    assert.deepEqual(checkArchitecture({ root, matrixPath }).violations, []);
  } finally {
    cleanup();
  }
});
