import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  analyzeEntrypoint,
  createSurfaceProgram,
} from '../../scripts/architecture/type-surface.mjs';
import { workspaceSourcePaths } from '../../scripts/architecture/surfaces.mjs';
import { loadWorkspace } from '../../scripts/architecture/workspace.mjs';
import { buildScenario, repoRoot, runCli, scenarios } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(here, 'type-surface');
const drizzle = realpathSync(
  path.join(repoRoot, 'infrastructure/database/node_modules/drizzle-orm'),
);

function analyse(
  entry,
  { stub = 'database.ts', approved = ['PersistenceHandle'], explicit = true } = {},
) {
  const program = createSurfaceProgram([entry], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: {
      '@sdris/database': [path.join(base, 'stubs', stub)],
      'drizzle-orm': [path.join(drizzle, 'index.d.ts')],
      'drizzle-orm/*': [path.join(drizzle, '*')],
    },
  });
  return analyzeEntrypoint(program, entry, {
    infrastructureDirs: [path.join(base, 'module/src/infrastructure')],
    databaseDirs: [path.join(base, 'stubs')],
    databaseSpecifiers: ['@sdris/database'],
    approvedDatabaseTypes: approved,
    requireExplicitReturnTypes: explicit,
  });
}
const composition = (name, options) =>
  analyse(path.join(base, 'module/src/composition/cases', `${name}.ts`), options);
const publicEntry = (name) =>
  analyse(path.join(base, 'module/src/public/cases', `${name}.ts`), {
    approved: [],
    explicit: false,
  });

// name -> [leaks the type graph must find (symbol, or null when none), missing explicit return types]
const COMPOSITION_CASES = {
  'ok-factory': { leak: null },
  'ok-reexported-port': { leak: null },
  'leak-concrete-return': { leak: 'DrizzleRepo' },
  'leak-property': { leak: 'DrizzleRepo' },
  'leak-drizzle-parameter': { leak: 'NodePgDatabase' },
  'leak-inferred-return': { leak: 'DrizzleRepo', missing: ['create'] },
  'missing-return-type-but-no-leak': { leak: null, missing: ['create'] },
  'leak-const-alias': { leak: 'DrizzleRepo' },
  'leak-orm-type-alias': { leak: 'TableConfig' },
  'leak-generic-constraint': { leak: 'DrizzleRepo' },
  'leak-class-member': { leak: 'DrizzleRepo' },
  'leak-unapproved-database-type': { leak: 'UnitOfWork' },
  'leak-through-promise': { leak: 'DrizzleRepo' },
  'leak-through-array': { leak: 'DrizzleRepo' },
  'leak-through-return-type-utility': { leak: 'DrizzleRepo' },
  'leak-drizzle-table-value': { leak: 'PgTableWithColumns' },
  'leak-reexported-adapter': { leak: 'DrizzleRepo' },
  'leak-nonopaque-handle': { leak: 'NodePgDatabase', stub: 'leaky-database.ts' },
};

test('every composition surface case is covered by an expectation', () => {
  const files = readdirSync(path.join(base, 'module/src/composition/cases')).map((f) =>
    f.replace(/\.ts$/, ''),
  );
  assert.deepEqual(files.sort(), Object.keys(COMPOSITION_CASES).sort());
});

for (const [name, expected] of Object.entries(COMPOSITION_CASES)) {
  test(`composition type surface: ${name}`, () => {
    const result = composition(name, { stub: expected.stub });
    if (expected.leak === null) {
      assert.deepEqual(result.leaks, [], JSON.stringify(result.leaks, null, 2));
      assert.deepEqual(result.declarationLeaks, []);
    } else {
      assert.ok(
        result.leaks.some((l) => l.symbol === expected.leak),
        `expected a leak of ${expected.leak}, got ${JSON.stringify(result.leaks, null, 2)}`,
      );
    }
    assert.deepEqual(result.missingReturnTypes, expected.missing ?? []);
  });
}

test('declaration generation: a clean factory emits a declaration that names no infrastructure or ORM', () => {
  const { declarationText, declarationLeaks } = composition('ok-factory');
  assert.ok(declarationText, 'a .d.ts must really be generated');
  assert.match(
    declarationText,
    /export declare function createInvestigationModule\(_p: PersistenceHandle\): InvestigationModule;/,
  );
  assert.match(declarationText, /from ['"]@sdris\/database['"]/);
  assert.doesNotMatch(declarationText, /infrastructure|drizzle|DrizzleRepo/);
  assert.deepEqual(declarationLeaks, []);
});

test('declaration generation: leaking signatures show up in the emitted declaration', () => {
  for (const name of [
    'leak-concrete-return',
    'leak-drizzle-parameter',
    'leak-property',
    'leak-through-promise',
  ]) {
    const { declarationText, declarationLeaks } = composition(name);
    assert.ok(declarationText, name);
    assert.ok(declarationLeaks.length > 0, `${name}: ${declarationText}`);
  }
});

test('the type graph catches a leak the generated declaration cannot show (a non-opaque handle)', () => {
  const result = composition('leak-nonopaque-handle', { stub: 'leaky-database.ts' });
  assert.deepEqual(result.declarationLeaks, [], 'the declaration only names the approved handle');
  assert.ok(result.leaks.some((l) => l.symbol === 'NodePgDatabase' && /\.db/.test(l.trail)));
});

test('only the named database contracts are approved: an unapproved name is refused even when approvals are empty', () => {
  assert.ok(
    composition('ok-factory', { approved: [] }).leaks.some((l) => l.symbol === 'PersistenceHandle'),
  );
});

test('public type surface: a clean public entrypoint passes; any database or adapter type is refused', () => {
  assert.deepEqual(publicEntry('ok-public').leaks, []);
  assert.ok(publicEntry('leak-public-handle').leaks.some((l) => l.symbol === 'PersistenceHandle'));
  assert.ok(publicEntry('leak-public-adapter').leaks.some((l) => l.symbol === 'DrizzleRepo'));
  assert.ok(publicEntry('leak-public-adapter').declarationLeaks.length > 0);
});

// ---- The same checks, through the CLI that CI runs -------------------------------------------------
function cliOnVariant(composition, extraFiles = {}) {
  const dir = scenarios('valid').find((s) => s.name.startsWith('20-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    writeFileSync(path.join(root, 'modules/investigation/src/composition/index.ts'), composition);
    for (const [file, text] of Object.entries(extraFiles))
      writeFileSync(path.join(root, file), text);
    return runCli(['--root', root, '--matrix', matrixPath]);
  } finally {
    cleanup();
  }
}

test('CLI: the clean composition workspace passes, type surfaces included', () => {
  const dir = scenarios('valid').find((s) => s.name.startsWith('20-')).dir;
  const { root, matrixPath, cleanup } = buildScenario(dir);
  try {
    const cli = runCli(['--root', root, '--matrix', matrixPath]);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /public type surfaces/);
  } finally {
    cleanup();
  }
});

test('CLI: a factory that returns the concrete adapter class fails with composition/type-surface-leak', () => {
  const cli = cliOnVariant(
    "import type { PersistenceHandle } from '@sdris/database';\nimport { DrizzleRepo } from '../infrastructure/persistence/adapter';\n" +
      'export function createInvestigationModule(_p: PersistenceHandle): DrizzleRepo { return new DrizzleRepo(); }\n',
  );
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /composition\/type-surface-leak/);
  assert.match(cli.stderr, /DrizzleRepo/);
});

test('CLI: an exported factory without an explicit return type fails with composition/explicit-return-type', () => {
  const cli = cliOnVariant(
    "import type { PersistenceHandle } from '@sdris/database';\n" +
      'export function createInvestigationModule(_p: PersistenceHandle) { return 1; }\n',
  );
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /composition\/explicit-return-type/);
});

test('CLI: a public entrypoint that exposes the adapter fails with public/type-surface-leak', () => {
  const cli = cliOnVariant(
    "import type { PersistenceHandle } from '@sdris/database';\nexport function createInvestigationModule(_p: PersistenceHandle): number { return 1; }\n",
    {
      'modules/investigation/src/public/index.ts':
        "import type { DrizzleRepo } from '../infrastructure/persistence/adapter';\nexport type Exposed = DrizzleRepo;\n",
    },
  );
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /public\/type-surface-leak/);
});

// ---- The real Investigation entrypoints ------------------------------------------------------------
test('the real Investigation composition entrypoint has a clean, fully typed surface and a real declaration', () => {
  const entry = path.join(repoRoot, 'modules/investigation/src/composition/index.ts');
  const program = createSurfaceProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    paths: workspaceSourcePaths(loadWorkspace(repoRoot)),
  });
  const result = analyzeEntrypoint(program, entry, {
    infrastructureDirs: [path.join(repoRoot, 'modules/investigation/src/infrastructure')],
    databaseDirs: [path.join(repoRoot, 'infrastructure/database')],
    databaseSpecifiers: ['@sdris/database'],
    approvedDatabaseTypes: ['PersistenceHandle'],
    requireExplicitReturnTypes: true,
  });
  assert.ok(
    program
      .getSourceFiles()
      .some((f) => f.fileName.endsWith('infrastructure/database/src/persistence-handle.ts')),
    'the database package must resolve to its source, otherwise the analysis is blind',
  );
  assert.ok(
    program
      .getSourceFiles()
      .some((f) => f.fileName.endsWith('packages/shared-kernel/src/index.ts')),
    'the shared kernel must resolve to its source',
  );
  assert.deepEqual(result.leaks, [], JSON.stringify(result.leaks, null, 2));
  assert.deepEqual(result.missingReturnTypes, []);
  assert.deepEqual(result.declarationLeaks, []);
  // S0-06 WP-02 widened this list deliberately and additively: the internal resolver port and its outcome types
  // (specification 2.4) are exported as types only, so the application's issuer can implement them without
  // importing Investigation internals. They are not part of `src/public`.
  // S0-06 WP-03 adds the Security Log port and its event types (specification 4.7), again types only, for the
  // application's logger adapter, and makes the module options required.
  assert.deepEqual([...result.exports].sort(), [
    'ActorResolution',
    'ActorResolver',
    'GuardedCommand',
    'InvestigationModule',
    'InvestigationModuleOptions',
    'SecurityEvent',
    'SecurityLog',
    'VerifiedActor',
    'createInvestigationModule',
  ]);
  assert.match(
    result.declarationText,
    /export declare function createInvestigationModule\(persistence: PersistenceHandle, options: InvestigationModuleOptions\): InvestigationModule;/,
  );
  // Comments may mention these words; the declared types must not.
  const code = result.declarationText.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /infrastructure|drizzle|pg-core|UnitOfWork|executorOf/i);
});

test('the real Investigation public entrypoint names no persistence type at all', () => {
  const entry = path.join(repoRoot, 'modules/investigation/src/public/index.ts');
  const program = createSurfaceProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    paths: workspaceSourcePaths(loadWorkspace(repoRoot)),
  });
  const result = analyzeEntrypoint(program, entry, {
    infrastructureDirs: [path.join(repoRoot, 'modules/investigation/src/infrastructure')],
    databaseDirs: [path.join(repoRoot, 'infrastructure/database')],
    databaseSpecifiers: ['@sdris/database'],
    approvedDatabaseTypes: [],
    requireExplicitReturnTypes: false,
  });
  assert.deepEqual(result.leaks, [], JSON.stringify(result.leaks, null, 2));
  assert.deepEqual(result.declarationLeaks, []);
  assert.doesNotMatch(result.declarationText ?? '', /PersistenceHandle|drizzle|infrastructure/i);
  // S0-06 WP-03: the public surface gains exactly the request context and the access error (specification 3.3)
  // beside the opaque ActorHandle of WP-02. The resolver port, the Security Log port and the guard are internal
  // and must not leak through the public entrypoint (they are types of the composition entrypoint only).
  const exported = [...result.exports];
  for (const name of ['ActorHandle', 'RequestContext', 'AccessError', 'InvestigationService']) {
    assert.ok(exported.includes(name), `${name} must be public`);
  }
  for (const name of [
    'ActorResolver',
    'ActorResolution',
    'VerifiedActor',
    'SecurityLog',
    'SecurityEvent',
    'GuardedCommand',
    'AccessGuard',
    'createAccessGuard',
    'REQUIRED_PERMISSION',
    'createInvestigationService',
  ]) {
    assert.ok(!exported.includes(name), `${name} must not be public`);
  }
});
