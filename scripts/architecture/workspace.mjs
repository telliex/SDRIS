import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
  const abs = (rel) => path.resolve(dir, rel);
  const pick = (value) => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') {
      return Object.values(value).flatMap(pick);
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
      entries.set(subpath, new Set(pick(target).map(abs)));
    }
  } else {
    const files = [manifest.main, manifest.types].filter((f) => typeof f === 'string');
    entries.set('.', new Set((files.length > 0 ? files : ['src/index.ts']).map(abs)));
  }
  return { entries, unsupportedPatterns: issues };
}

export function loadWorkspace(root) {
  const packages = [];
  for (const group of ['apps', 'modules', 'packages']) {
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
            : SHARED_PACKAGE_LAYERS[entry.name];
      const { entries, unsupportedPatterns } = readEntrypoints(dir, manifest);
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
        unsupportedPatterns,
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
