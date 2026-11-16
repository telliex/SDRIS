import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.match(cli.stdout, /PASS: architecture boundaries hold \(17 packages/);
  const { violations } = checkArchitecture({
    root: repoRoot,
    matrixPath: path.join(repoRoot, 'scripts/architecture/dependency-matrix.json'),
  });
  assert.deepEqual(violations, []);
});

test('the default matrix grants no module-to-module dependency', async () => {
  const { default: matrix } = await import('../../scripts/architecture/dependency-matrix.json', {
    with: { type: 'json' },
  });
  assert.deepEqual(matrix.moduleDependencies, {});
});

test('the committed policy authorises only the Investigation context, and nothing else', async () => {
  const { default: matrix } = await import('../../scripts/architecture/dependency-matrix.json', {
    with: { type: 'json' },
  });
  assert.deepEqual(matrix.moduleDependencies, {});
  assert.deepEqual(matrix.contextInfrastructure, {
    '@sdris/investigation': {
      workspacePackages: ['@sdris/database'],
      externalPackages: ['drizzle-orm'],
    },
  });
});

test('the committed policy authorises exactly apps/api/src/composition/** for Investigation, and no worker', async () => {
  const { default: matrix } = await import('../../scripts/architecture/dependency-matrix.json', {
    with: { type: 'json' },
  });
  assert.deepEqual(matrix.compositionRoots, {
    '@sdris/investigation': { packages: ['@sdris/api'], paths: ['apps/api/src/composition/**'] },
  });
  assert.ok(!JSON.stringify(matrix.compositionRoots).includes('worker'));
});

const MALFORMED_COMPOSITION_ROOTS = {
  'a key that is not a module': {
    '@sdris/api': { packages: ['@sdris/api'], paths: ['apps/api/src/composition/**'] },
  },
  'a key that does not exist': {
    '@sdris/unknown': { packages: ['@sdris/api'], paths: ['apps/api/src/c/**'] },
  },
  'an unknown property': {
    '@sdris/investigation': { packages: ['@sdris/api'], paths: ['apps/api/src/c/**'], x: 1 },
  },
  'an empty package list': {
    '@sdris/investigation': { packages: [], paths: ['apps/api/src/c/**'] },
  },
  'an empty path list': { '@sdris/investigation': { packages: ['@sdris/api'], paths: [] } },
  'a business module as composition root': {
    '@sdris/investigation': { packages: ['@sdris/evidence'], paths: ['modules/evidence/src/**'] },
  },
  'a non-app package as composition root': {
    '@sdris/investigation': {
      packages: ['@sdris/database'],
      paths: ['infrastructure/database/src/**'],
    },
  },
  'a path outside the listed app': {
    '@sdris/investigation': { packages: ['@sdris/api'], paths: ['apps/web/src/**'] },
  },
  'a path with a wildcard in the middle': {
    '@sdris/investigation': { packages: ['@sdris/api'], paths: ['apps/api/**/composition'] },
  },
  'a non-string path': { '@sdris/investigation': { packages: ['@sdris/api'], paths: [1] } },
};
for (const [label, compositionRoots] of Object.entries(MALFORMED_COMPOSITION_ROOTS)) {
  test(`a malformed composition-root allowlist (${label}) cannot be analysed`, () => {
    const dir = scenarios('valid').find((s) => s.name.startsWith('20-')).dir;
    const { root, matrixPath, cleanup } = buildScenario(dir);
    try {
      writeFileSync(
        matrixPath,
        JSON.stringify({ moduleDependencies: {}, contextInfrastructure: {}, compositionRoots }),
      );
      assert.throws(() => checkArchitecture({ root, matrixPath }), /invalid dependency policy/);
      assert.equal(runCli(['--root', root, '--matrix', matrixPath]).status, 2);
    } finally {
      cleanup();
    }
  });
}

test('the committed policy protects @sdris/database/testing and approves no other test infrastructure', async () => {
  const { default: matrix } = await import('../../scripts/architecture/dependency-matrix.json', {
    with: { type: 'json' },
  });
  assert.deepEqual(matrix.testOnlyEntrypoints, {
    '@sdris/database': { subpaths: ['./testing'], approvedPaths: [] },
  });
});

const MALFORMED_TEST_ONLY = {
  'a key that is not a workspace package': { '@sdris/unknown': { subpaths: ['./testing'] } },
  'an unknown property': { '@sdris/database': { subpaths: ['./testing'], x: 1 } },
  'a missing subpath list': { '@sdris/database': {} },
  'an empty subpath list': { '@sdris/database': { subpaths: [] } },
  'a non-array subpath list': { '@sdris/database': { subpaths: './testing' } },
  'a subpath the package does not export': { '@sdris/database': { subpaths: ['./nothing'] } },
  'the root entrypoint': { '@sdris/database': { subpaths: ['.'] } },
  'a non-array approved path list': {
    '@sdris/database': { subpaths: ['./testing'], approvedPaths: 'x' },
  },
  'a non-string approved path': {
    '@sdris/database': { subpaths: ['./testing'], approvedPaths: [1] },
  },
  'an approved path with a wildcard in the middle': {
    '@sdris/database': { subpaths: ['./testing'], approvedPaths: ['apps/**/x'] },
  },
  'an entry that is not an object': { '@sdris/database': ['./testing'] },
};
for (const [label, testOnlyEntrypoints] of Object.entries(MALFORMED_TEST_ONLY)) {
  test(`a malformed testOnlyEntrypoints policy (${label}) cannot be analysed`, () => {
    const dir = scenarios('valid').find((s) => s.name.startsWith('30-')).dir;
    const { root, matrixPath, cleanup } = buildScenario(dir);
    try {
      writeFileSync(matrixPath, JSON.stringify({ moduleDependencies: {}, testOnlyEntrypoints }));
      assert.throws(() => checkArchitecture({ root, matrixPath }), /invalid dependency policy/);
      assert.equal(runCli(['--root', root, '--matrix', matrixPath]).status, 2);
    } finally {
      cleanup();
    }
  });
}

test('V5: the composition wiring adds no dependency cycle and the expected package edges', () => {
  const dir = scenarios('valid').find((s) => s.name.startsWith('20-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    const { violations, stats } = checkArchitecture({ root, matrixPath });
    assert.deepEqual(violations, []);
    assert.ok(!violations.some((v) => v.rule === 'cycle/cross-package'));
    const edges = new Set(stats.edges.map((e) => `${e.from} -> ${e.to}`));
    assert.ok(edges.has('@sdris/api -> @sdris/investigation'), [...edges].join('\n'));
    assert.ok(edges.has('@sdris/investigation -> @sdris/database'), [...edges].join('\n'));
    assert.ok(!edges.has('@sdris/database -> @sdris/investigation'));
    assert.ok(!edges.has('@sdris/investigation -> @sdris/api'));
  } finally {
    cleanup();
  }
});

const MALFORMED_POLICIES = {
  'a key that is not a module': { '@sdris/database': { workspacePackages: ['@sdris/database'] } },
  'a key that does not exist': { '@sdris/unknown': { externalPackages: ['drizzle-orm'] } },
  'an unknown property': { '@sdris/investigation': { manifest: ['x'] } },
  'a non-array list': { '@sdris/investigation': { workspacePackages: '@sdris/database' } },
  'a business module listed as infrastructure': {
    '@sdris/investigation': { workspacePackages: ['@sdris/evidence'] },
  },
  'a workspace package that does not exist': {
    '@sdris/investigation': { workspacePackages: ['@sdris/nothing'] },
  },
  'an external package that is not a persistence library': {
    '@sdris/investigation': { externalPackages: ['lodash'] },
  },
  'an entry that is not an object': { '@sdris/investigation': ['drizzle-orm'] },
};
for (const [label, contextInfrastructure] of Object.entries(MALFORMED_POLICIES)) {
  test(`a malformed allowlist (${label}) cannot be analysed, so it never silently grants access`, () => {
    const dir = scenarios('valid').find((s) => s.name.startsWith('18-')).dir;
    const { root, matrixPath, cleanup } = buildScenario(dir);
    try {
      writeFileSync(matrixPath, JSON.stringify({ moduleDependencies: {}, contextInfrastructure }));
      assert.throws(() => checkArchitecture({ root, matrixPath }), /invalid dependency policy/);
      const cli = runCli(['--root', root, '--matrix', matrixPath]);
      assert.equal(cli.status, 2, cli.stdout + cli.stderr);
      assert.match(cli.stderr, /invalid dependency policy/);
    } finally {
      cleanup();
    }
  });
}

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
