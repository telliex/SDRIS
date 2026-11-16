import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { analyzeEntrypoint, createSurfaceProgram } from './type-surface.mjs';
import { loadWorkspace, toPosix } from './workspace.mjs';

/**
 * TypeScript `paths` that map every workspace package (and each published subpath) to its source entry.
 * Resolution then does not depend on node_modules links, export conditions or whether `dist` was built,
 * so the type surface is always analysed with full type information.
 */
export function workspaceSourcePaths(packages) {
  const paths = {};
  for (const pkg of packages) {
    for (const [subpath, files] of pkg.entries) {
      const file = [...files][0];
      if (file && existsSync(file))
        paths[subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`] = [file];
    }
  }
  return paths;
}

/** Opaque contracts a composition entrypoint may name from the database package. Nothing else. */
export const APPROVED_DATABASE_CONTRACTS = ['PersistenceHandle'];

/**
 * Verifies the public type surface of every module entrypoint under `root`:
 *  - `.` (src/public): no Context Infrastructure, no ORM or driver, nothing from the database package.
 *  - `./composition` (src/composition/index.ts): the same, except the approved opaque contracts, and every
 *    exported function declares its return type.
 * @returns {{ violations: object[], checked: number }}
 */
export function checkModuleSurfaces({ root }) {
  root = path.resolve(root);
  const packages = loadWorkspace(root);
  const modules = packages.filter((p) => p.layer === 'module');
  const infraPackages = packages.filter((p) => p.layer === 'infrastructure');
  const databaseSpecifiers = infraPackages.map((p) => p.name);
  const databaseDirs = infraPackages.map((p) => p.dir);

  const targets = [];
  for (const pkg of modules) {
    for (const [subpath, files] of pkg.entries) {
      for (const file of files) {
        if (!existsSync(file)) continue;
        if (subpath === '.') targets.push({ pkg, file, kind: 'public' });
        else if (subpath === './composition') targets.push({ pkg, file, kind: 'composition' });
      }
    }
  }
  if (targets.length === 0) return { violations: [], checked: 0 };

  const baseConfig = path.join(root, 'tsconfig.base.json');
  const base = existsSync(baseConfig)
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(baseConfig, (f) => readFileSync(f, 'utf8')).config ?? {},
        ts.sys,
        root,
      ).options
    : {};
  const program = createSurfaceProgram([...new Set(targets.map((t) => t.file))], {
    ...base,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: false,
    paths: workspaceSourcePaths(packages),
  });

  const violations = [];
  for (const { pkg, file, kind } of targets) {
    const result = analyzeEntrypoint(program, file, {
      infrastructureDirs: [path.join(pkg.dir, 'src', 'infrastructure')],
      databaseDirs,
      databaseSpecifiers,
      approvedDatabaseTypes: kind === 'composition' ? APPROVED_DATABASE_CONTRACTS : [],
      requireExplicitReturnTypes: kind === 'composition',
    });
    const rel = toPosix(path.relative(root, file));
    const where = kind === 'composition' ? `${pkg.name}/composition` : pkg.name;
    for (const leak of result.leaks) {
      violations.push({
        rule: `${kind}/type-surface-leak`,
        file: rel,
        line: 1,
        message: `${where} exposes "${leak.symbol}" (${leak.reason}) through ${leak.trail}; declared in ${toPosix(path.relative(root, leak.file))}.`,
        hint: 'Expose a contract declared in src/application (or an approved opaque contract), never an adapter, ORM or driver type.',
      });
    }
    for (const name of result.missingReturnTypes) {
      violations.push({
        rule: 'composition/explicit-return-type',
        file: rel,
        line: 1,
        message: `${where} exports "${name}" without an explicit return type; factories must declare their public contract type.`,
      });
    }
    for (const leak of result.declarationLeaks) {
      violations.push({
        rule: `${kind}/declaration-leak`,
        file: rel,
        line: 1,
        message: `The generated declaration of ${where} references ${leak}.`,
      });
    }
  }
  return { violations, checked: targets.length };
}
