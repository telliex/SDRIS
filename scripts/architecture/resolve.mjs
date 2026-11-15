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

function loadPathsConfig(tsconfigPath) {
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
    if (paths) result = { paths, base: baseUrl ?? pathsBasePath ?? path.dirname(tsconfigPath) };
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

/**
 * Resolves `specifier` through the nearest tsconfig's `paths` (including `extends`). Returns the
 * absolute target path, or undefined when no alias pattern matches. Longest prefix wins, as in tsc.
 */
export function resolveAlias(specifier, importerFile, root) {
  const tsconfig = findTsconfig(path.dirname(importerFile), root);
  const config = tsconfig && loadPathsConfig(tsconfig);
  if (!config) return undefined;
  const patterns = Object.keys(config.paths)
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
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const match = patterns[0];
  if (!match) return undefined;
  const captured = match.exact
    ? ''
    : specifier.slice(match.prefix.length, specifier.length - match.suffix.length);
  const targets = config.paths[match.pattern].map((t) =>
    path.resolve(config.base, t.replace('*', captured)),
  );
  return targets.find((t) => resolveExisting(t)) ?? targets[0];
}
