import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

const stat = (p) => {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
};
const isFile = (p) => stat(p)?.isFile() === true;
const isDirectory = (p) => stat(p)?.isDirectory() === true;

/** Files a specifier could name as a *file*: itself, with each extension, and `.js` -> TS source. */
function fileCandidates(abs) {
  const stripped = abs.replace(/\.[cm]?[jt]sx?$/, '');
  const out = [abs];
  for (const base of new Set([abs, stripped])) for (const ext of EXTENSIONS) out.push(base + ext);
  return out;
}

/**
 * Resolves a path the way TypeScript's node resolution does, and returns the single file it lands
 * on (or undefined): (1) a file, with extension variants; (2) for a directory, the entry named by
 * its package.json `types`/`typings`/`main`; (3) the directory's `index` file. A file always wins
 * over a directory of the same name, so `public.ts` shadows `public/index.ts`.
 */
export function resolveFile(abs, depth = 0) {
  const file = fileCandidates(abs).find(isFile);
  if (file) return file;
  if (!isDirectory(abs)) return undefined;

  const manifestPath = path.join(abs, 'package.json');
  if (depth < 3 && isFile(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const field of [manifest.types, manifest.typings, manifest.main]) {
        if (typeof field !== 'string') continue;
        const resolved = resolveFile(path.resolve(abs, field), depth + 1);
        if (resolved) return resolved;
      }
    } catch {
      // An unreadable manifest is treated as absent, as TypeScript does.
    }
  }
  return EXTENSIONS.map((ext) => path.join(abs, 'index' + ext)).find(isFile);
}

const tsconfigCache = new Map();

/** Reads `paths` and `baseUrl` (including values inherited through `extends`) from a tsconfig. */
function loadModuleConfig(tsconfigPath) {
  if (tsconfigCache.has(tsconfigPath)) return tsconfigCache.get(tsconfigPath);
  let result = null;
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (!read.error) {
    // Empty file lists stop the parser from scanning the whole package; we only need the options.
    const parsed = ts.parseJsonConfigFileContent(
      { ...read.config, include: [], files: [] },
      ts.sys,
      path.dirname(tsconfigPath),
    );
    const { paths, baseUrl, pathsBasePath } = parsed.options;
    if (paths || baseUrl) {
      result = {
        paths,
        baseUrl,
        pathsBase: baseUrl ?? pathsBasePath ?? path.dirname(tsconfigPath),
      };
    }
  }
  tsconfigCache.set(tsconfigPath, result);
  return result;
}

function findTsconfig(fromDir, root) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    if (dir === root || path.dirname(dir) === dir) return undefined;
    dir = path.dirname(dir);
  }
}

/** Existing targets of the longest-prefix matching `paths` pattern (as tsc picks it). */
function pathsTargets(specifier, { paths, pathsBase }) {
  if (!paths) return [];
  const match = Object.keys(paths)
    .map((pattern) => {
      const star = pattern.indexOf('*');
      return star < 0
        ? { pattern, prefix: pattern, suffix: '', exact: true }
        : {
            pattern,
            prefix: pattern.slice(0, star),
            suffix: pattern.slice(star + 1),
            exact: false,
          };
    })
    .filter(({ prefix, suffix, exact }) =>
      exact
        ? specifier === prefix
        : specifier.length >= prefix.length + suffix.length &&
          specifier.startsWith(prefix) &&
          specifier.endsWith(suffix),
    )
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!match) return [];
  const captured = match.exact
    ? ''
    : specifier.slice(match.prefix.length, specifier.length - match.suffix.length);
  return paths[match.pattern].map((t) => path.resolve(pathsBase, t.replace('*', captured)));
}

/**
 * Mirrors TypeScript's module resolution order for non-relative specifiers: tsconfig `paths`, then
 * `baseUrl`. A candidate only counts if the file actually exists; otherwise resolution falls
 * through (to workspace-package or external classification), exactly as tsc does. Returns the
 * resolved target *file*, or undefined when no alias or baseUrl lookup resolves.
 */
export function resolveAlias(specifier, importerFile, root) {
  const tsconfig = findTsconfig(path.dirname(importerFile), root);
  const config = tsconfig && loadModuleConfig(tsconfig);
  if (!config) return undefined;

  for (const target of pathsTargets(specifier, config)) {
    const resolved = resolveFile(target);
    if (resolved) return resolved;
  }

  if (config.baseUrl && !specifier.startsWith('.') && !path.isAbsolute(specifier)) {
    return resolveFile(path.resolve(config.baseUrl, specifier));
  }
  return undefined;
}
