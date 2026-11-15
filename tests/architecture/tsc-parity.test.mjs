import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { checkArchitecture } from '../../scripts/architecture/check.mjs';
import { loadWorkspace, ownerOf } from '../../scripts/architecture/workspace.mjs';
import { MODULES, buildScenario, scenarios } from './helpers.mjs';

/**
 * Cross-checks the checker against the real TypeScript resolver. The synthetic workspace gets
 * pnpm-style `node_modules/@sdris/*` links (as a real install would), TypeScript resolves the
 * import with the app's tsconfig, and we require the checker to agree on the owning package and on
 * whether the target is that package's published entrypoint.
 */
const API_FILE = 'apps/api/src/composition.ts';

const cases = [
  // [fixture kind, fixture name prefix, specifier, expected outcome]
  ['invalid', '17-', '@sdris/evidence/src/domain/model', 'private'],
  ['invalid', '18-', 'modules/evidence/src/domain/model', 'private'],
  ['invalid', '05-', '@inv/domain/model', 'private'],
  ['invalid', '05b-', '@sdris/evidence', 'private'],
  ['valid', '07-', '@inv', 'public'],
  ['valid', '11-', 'local', 'local'],
  ['valid', '11-', '@sdris/evidence', 'public'],
  ['valid', '12-', 'modules/evidence/src/public', 'public'],
  ['invalid', '19-', 'modules/evidence/src/public', 'private'],
  ['invalid', '20-', 'modules/evidence/src/domain', 'private'],
  ['valid', '14-', 'modules/evidence', 'public'],
  ['valid', '01-', '@sdris/investigation', 'public'],
];

function linkWorkspacePackages(root) {
  const scope = path.join(root, 'apps/api/node_modules/@sdris');
  mkdirSync(scope, { recursive: true });
  for (const name of MODULES) {
    symlinkSync(path.join(root, 'modules', name), path.join(scope, name), 'dir');
  }
}

function tscResolve(root, file, specifier) {
  const tsconfigPath = path.join(root, 'apps/api/tsconfig.json');
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const options = read.error
    ? {}
    : ts.parseJsonConfigFileContent(
        { ...read.config, include: [], files: [] },
        ts.sys,
        path.dirname(tsconfigPath),
      ).options;
  options.moduleResolution = ts.ModuleResolutionKind.Node10;
  const { resolvedModule } = ts.resolveModuleName(specifier, file, options, ts.sys);
  return resolvedModule?.resolvedFileName;
}

for (const [kind, prefix, specifier, expected] of cases) {
  const scenario = scenarios(kind).find((s) => s.name.startsWith(prefix));
  test(`tsc parity: ${kind}/${prefix} "${specifier}" is ${expected}`, () => {
    const built = buildScenario(scenario.dir);
    const { matrixPath, cleanup } = built;
    // TypeScript returns real paths; normalise the temp root (e.g. /var -> /private/var on macOS).
    const root = realpathSync(built.root);
    try {
      linkWorkspacePackages(root);
      const file = path.join(root, API_FILE);
      const resolved = tscResolve(root, file, specifier);
      assert.ok(resolved, `TypeScript could not resolve "${specifier}"`);

      const packages = loadWorkspace(root);
      const owner = ownerOf(packages, resolved);
      assert.ok(owner, `TypeScript target ${resolved} is outside the workspace`);
      const isEntry = owner.entryFiles.has(resolved);

      const { violations } = checkArchitecture({ root, matrixPath });
      const privateImports = violations.filter(
        (v) => v.rule === 'boundary/private-import' && v.file === API_FILE,
      );

      if (expected === 'private') {
        assert.notEqual(owner.name, '@sdris/api');
        assert.equal(isEntry, false, 'TypeScript target should be internal code');
        assert.equal(privateImports.length, 1, JSON.stringify(violations));
        assert.equal(privateImports[0].to, owner.name, 'checker and tsc disagree on the owner');
      } else if (expected === 'public') {
        assert.equal(isEntry, true, 'TypeScript target should be a published entrypoint');
        assert.deepEqual(violations, []);
      } else {
        assert.equal(owner.name, '@sdris/api', 'TypeScript target should be app-local');
        assert.deepEqual(violations, []);
      }
    } finally {
      cleanup();
    }
  });
}
