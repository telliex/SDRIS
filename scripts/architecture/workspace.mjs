import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveFile } from './resolve.mjs';

/** Layers recognised by the dependency policy. Unknown shared packages are reported, not guessed. */
const SHARED_PACKAGE_LAYERS = {
  'shared-kernel': 'kernel',
  contracts: 'contracts',
  config: 'config',
  testing: 'testing',
};

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

export const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Resolves the public entrypoints a package publishes: its `exports` map when present (exact
 * subpaths only), otherwise `main`/`types`. Returns subpath -> absolute files, plus any issues.
 */
function readEntrypoints(dir, manifest) {
  const entries = new Map();
  const issues = [];
  // Entrypoints are compared by the file they resolve to, so `./src/public` and `src/public/index.ts` match.
  const abs = (rel) => {
    const absolute = path.resolve(dir, rel);
    return resolveFile(absolute) ?? absolute;
  };
  const conditionIssues = [];
  const SOURCE_CONDITION = 'sdris-source';
  /**
   * An entrypoint written as `{ "sdris-source": "./src/x.ts", "types": "./dist/x.d.ts", "default": "./dist/x.js" }`
   * is judged by its source target. `types` and `default` are what TypeScript consumers and plain Node actually
   * load, so each must be the exact dist mirror of the source target; otherwise a compiled private file could
   * become the real public entrypoint while the checker looks only at the source.
   */
  const pickConditional = (subpath, value) => {
    const source = value[SOURCE_CONDITION];
    const mirror = typeof source === 'string' ? source.replace(/^\.\/src\//, './dist/') : undefined;
    const expected = {
      types: mirror?.replace(/\.[cm]?tsx?$/, '.d.ts'),
      default: mirror?.replace(/\.[cm]?tsx?$/, '.js'),
    };
    if (typeof source !== 'string' || !source.startsWith('./src/')) {
      conditionIssues.push(`"${subpath}": "${SOURCE_CONDITION}" must be a path under ./src/`);
      return [];
    }
    for (const key of Object.keys(value)) {
      if (key !== SOURCE_CONDITION && key !== 'types' && key !== 'default') {
        conditionIssues.push(
          `"${subpath}": condition "${key}" is not supported (only ${SOURCE_CONDITION}, types, default)`,
        );
      }
    }
    for (const key of ['types', 'default']) {
      if (value[key] === undefined) {
        conditionIssues.push(`"${subpath}": missing "${key}" (expected ${expected[key]})`);
      } else if (value[key] !== expected[key]) {
        conditionIssues.push(
          `"${subpath}": "${key}" is ${JSON.stringify(value[key])} but must be the dist mirror of "${source}" (${expected[key]})`,
        );
      }
    }
    return [source];
  };
  const pick = (value, subpath = '.') => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') {
      if (SOURCE_CONDITION in value) return pickConditional(subpath, value);
      return Object.values(value).flatMap((v) => pick(v, subpath));
    }
    return [];
  };

  if (manifest.exports !== undefined) {
    const exp = manifest.exports;
    const isSubpathMap =
      exp && typeof exp === 'object' && Object.keys(exp).some((k) => k.startsWith('.'));
    const map = isSubpathMap ? exp : { '.': exp };
    for (const [subpath, target] of Object.entries(map)) {
      if (subpath.includes('*')) {
        issues.push(subpath);
        continue;
      }
      entries.set(subpath, new Set(pick(target, subpath).map(abs)));
    }
  } else {
    const files = [manifest.main, manifest.types].filter((f) => typeof f === 'string');
    entries.set('.', new Set((files.length > 0 ? files : ['src/index.ts']).map(abs)));
  }
  return { entries, unsupportedPatterns: issues, conditionIssues };
}

export function loadWorkspace(root) {
  const packages = [];
  for (const group of ['apps', 'modules', 'packages', 'infrastructure']) {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(groupDir, entry.name);
      const manifestPath = path.join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const layer =
        group === 'apps'
          ? 'app'
          : group === 'modules'
            ? 'module'
            : group === 'infrastructure'
              ? 'infrastructure'
              : SHARED_PACKAGE_LAYERS[entry.name];
      const { entries, unsupportedPatterns, conditionIssues } = readEntrypoints(dir, manifest);
      packages.push({
        name: manifest.name,
        short: entry.name,
        group,
        layer, // undefined => unclassified
        dir,
        relDir: `${group}/${entry.name}`,
        manifest,
        manifestPath,
        entries,
        entryFiles: new Set([...entries.values()].flatMap((s) => [...s])),
        compositionFiles: entries.get('./composition') ?? new Set(),
        unsupportedPatterns,
        conditionIssues,
      });
    }
  }
  return packages;
}

export function ownerOf(packages, absPath) {
  let best;
  for (const pkg of packages) {
    if (absPath === pkg.dir || absPath.startsWith(pkg.dir + path.sep)) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

/** Source files belonging to a package. Config files and Next.js generated typings are tooling. */
export function listSourceFiles(pkg) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.'))
          walk(path.join(dir, entry.name));
      } else if (
        SOURCE_EXTENSIONS.test(entry.name) &&
        !/\.config\.[cm]?[jt]s$/.test(entry.name) &&
        entry.name !== 'next-env.d.ts'
      ) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(pkg.dir);
  return files.sort();
}

export const isTestFile = (file) =>
  /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file) || file.split(path.sep).includes('__tests__');

/**
 * Architectural zone of a file inside a module package, by source path: `src/public`, `src/domain`,
 * `src/application`, `src/infrastructure` (Context Infrastructure), `src/composition` (the dedicated
 * composition entry zone) or `other`.
 * `ignoreCase` is used for import *targets*: on a case-insensitive file system `../Infrastructure/x` resolves
 * to the same directory, so a target must never escape the zone by spelling. An importing file is matched
 * exactly, so a directory merely spelled `Infrastructure` is not granted infrastructure rights.
 */
export function zoneOf(pkg, file, { ignoreCase = false } = {}) {
  const rel = toPosix(path.relative(pkg.dir, file));
  const m = new RegExp(
    '^src/(public|domain|application|infrastructure|composition)(/|$)',
    ignoreCase ? 'i' : '',
  ).exec(rel);
  return m ? m[1].toLowerCase() : 'other';
}
