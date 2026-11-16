import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Compiled-runtime smoke test. A passing TypeScript build is not enough: this builds the workspace packages,
 * then runs the compiled Investigation composition in a plain `node` process (no tsx) against real PostgreSQL.
 * Needs the local PostgreSQL container (`pnpm db:up`).
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const childScript = path.join(repo, 'tests', 'runtime', 'compiled-runtime.child.cjs');

test(
  'builds the required workspace packages from a clean state (dependencies first)',
  { timeout: 300_000 },
  () => {
    const packages = [
      ['shared-kernel', 'packages/shared-kernel'],
      ['database', 'infrastructure/database'],
      ['investigation', 'modules/investigation'],
      ['api', 'apps/api'],
    ];
    // Start from nothing, so a stale dist can never make this pass.
    for (const [, dir] of packages)
      rmSync(path.join(repo, dir, 'dist'), { recursive: true, force: true });

    const build = spawnSync('pnpm', ['--filter', '@sdris/api...', 'run', 'build'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(build.status, 0, build.stdout + build.stderr);

    // Judged by files, not by console output (pnpm's verbosity depends on how it was started).
    const entries = {
      'shared-kernel': 'packages/shared-kernel/dist/index.js',
      database: 'infrastructure/database/dist/index.js',
      investigation: 'modules/investigation/dist/composition/index.js',
      api: 'apps/api/dist/composition/investigation.composition.js',
    };
    const modified = packages.map(([name]) => {
      const file = path.join(repo, entries[name]);
      assert.ok(existsSync(file), `${name} should have been built: ${file}`);
      return statSync(file).mtimeMs;
    });
    assert.deepEqual(
      modified,
      [...modified].sort((a, b) => a - b),
      'dependencies are built before their dependants',
    );
  },
);

test('TypeScript consumers resolve declarations; the source condition resolves source', () => {
  const containing = path.join(repo, 'apps', 'api', 'src', 'composition', 'consumer.ts');
  const resolve = (specifier, customConditions) =>
    ts.resolveModuleName(
      specifier,
      containing,
      {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        ...(customConditions ? { customConditions } : {}),
      },
      ts.sys,
    ).resolvedModule?.resolvedFileName;
  const expectations = {
    '@sdris/shared-kernel': [
      'packages/shared-kernel/dist/index.d.ts',
      'packages/shared-kernel/src/index.ts',
    ],
    '@sdris/database': [
      'infrastructure/database/dist/index.d.ts',
      'infrastructure/database/src/index.ts',
    ],
    '@sdris/database/testing': [
      'infrastructure/database/dist/testing/index.d.ts',
      'infrastructure/database/src/testing/index.ts',
    ],
    '@sdris/investigation': [
      'modules/investigation/dist/public/index.d.ts',
      'modules/investigation/src/public/index.ts',
    ],
    '@sdris/investigation/composition': [
      'modules/investigation/dist/composition/index.d.ts',
      'modules/investigation/src/composition/index.ts',
    ],
  };
  for (const [specifier, [declaration, source]] of Object.entries(expectations)) {
    const external = resolve(specifier);
    assert.ok(external?.endsWith(declaration), `${specifier} -> ${external}`);
    const inRepo = resolve(specifier, ['sdris-source']);
    assert.ok(inRepo?.endsWith(source), `${specifier} (sdris-source) -> ${inRepo}`);
  }
});

test('plain Node resolves package names to compiled JavaScript', () => {
  const apiRequire = createRequire(path.join(repo, 'apps', 'api', 'package.json'));
  for (const [specifier, suffix] of Object.entries({
    '@sdris/shared-kernel': 'packages/shared-kernel/dist/index.js',
    '@sdris/database': 'infrastructure/database/dist/index.js',
    '@sdris/database/testing': 'infrastructure/database/dist/testing/index.js',
    '@sdris/investigation': 'modules/investigation/dist/public/index.js',
    '@sdris/investigation/composition': 'modules/investigation/dist/composition/index.js',
  })) {
    assert.ok(apiRequire.resolve(specifier).endsWith(suffix), specifier);
  }
});

test(
  'the compiled composition root drives PostgreSQL in a plain node process',
  { timeout: 180_000 },
  () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS; // nothing may inject tsx or a loader
    const child = spawnSync(process.execPath, [childScript], {
      cwd: repo,
      env,
      encoding: 'utf8',
      timeout: 170_000,
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, child.stdout);
    const { checks, nodeVersion } = JSON.parse(line.slice('RESULT '.length));
    assert.match(nodeVersion, /^v(22|23|24)\./, 'a supported Node.js (engines: >=22 <25)');
    const expected = [
      'no tsx or loader flags',
      'no NODE_OPTIONS',
      'no .ts extension handler registered',
      'composition returns a service',
      'register UUT keeps the serial number as given',
      'register test attempt',
      'invalid stage rejected',
      'open case',
      'round trip',
      'link test attempt',
      'commit persisted both writes',
      'identical link is idempotent',
      'idempotent repeat changed nothing',
      'cross-UUT rejected',
      'cross-UUT stored nothing',
      'database composite foreign keys reject cross-UUT rows',
      'rollback restored the version',
      'rollback stored nothing',
      'stale writer gets a concurrency conflict',
      'stale writer stored nothing',
      'links are returned in the approved order',
      'no TypeScript source was loaded',
      'workspace code came from dist',
      'no tsx module is loaded',
    ];
    for (const name of expected) assert.equal(checks[name], true, name);
  },
);
