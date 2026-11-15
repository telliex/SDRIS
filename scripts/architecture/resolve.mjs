import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * All files a path specifier could refer to (as TypeScript/Node would try them): the path itself,
 * with each extension, as a directory index, and `.js`-style imports mapped to their TS source.
 */
export function candidateFiles(abs) {
  const out = new Set([abs]);
  const stripped = abs.replace(/\.[cm]?[jt]sx?$/, '');
  for (const base of new Set([abs, stripped])) {
    for (const ext of EXTENSIONS) out.add(base + ext);
    for (const ext of EXTENSIONS) out.add(path.join(base, 'index' + ext));
  }
  return [...out];
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export function resolveExisting(abs) {
  return candidateFiles(abs).find(isFile);
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
 * absolute target path, or undefined when no alias or baseUrl lookup resolves.
 */
export function resolveAlias(specifier, importerFile, root) {
  const tsconfig = findTsconfig(path.dirname(importerFile), root);
  const config = tsconfig && loadModuleConfig(tsconfig);
  if (!config) return undefined;

  const viaPaths = pathsTargets(specifier, config).find((t) => resolveExisting(t));
  if (viaPaths) return viaPaths;

  if (config.baseUrl && !specifier.startsWith('.') && !path.isAbsolute(specifier)) {
    const viaBaseUrl = path.resolve(config.baseUrl, specifier);
    if (resolveExisting(viaBaseUrl)) return viaBaseUrl;
  }
  return undefined;
}
