import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extractImports } from './imports.mjs';
import { resolveAlias, resolveFile } from './resolve.mjs';
import { isTestFile, listSourceFiles, loadWorkspace, ownerOf, toPosix } from './workspace.mjs';

/**
 * Layer dependency policy. A layer may import only the listed layers (always via the target
 * package's published entrypoint). Module -> module is governed by the dependency matrix instead.
 * `testing` is additionally allowed from test files of modules and apps (see TEST_ONLY_TARGETS).
 */
const ALLOWED_LAYERS = {
  kernel: [],
  contracts: ['kernel'],
  config: ['kernel'],
  testing: ['kernel', 'contracts'],
  module: ['kernel', 'contracts'],
  app: ['module', 'kernel', 'contracts', 'config'],
};
const TEST_ONLY_TARGETS = { module: ['testing'], app: ['testing'] };

const KERNEL_FORBIDDEN_EXTERNALS = [
  /^@nestjs\//,
  /^next(\/|$)/,
  /^react(-dom)?(\/|$)/,
  /^(typeorm|prisma|pg|knex|sequelize|mongoose|mysql2|drizzle-orm)(\/|$)/,
  /^@prisma\//,
  /^@mikro-orm\//,
];

function loadMatrix(matrixPath) {
  if (!matrixPath || !existsSync(matrixPath)) return {};
  return JSON.parse(readFileSync(matrixPath, 'utf8')).moduleDependencies ?? {};
}

/**
 * Checks architectural boundaries for the workspace rooted at `root`.
 * @returns {{ violations: object[], notes: object[], stats: object }}
 */
export function checkArchitecture({ root, matrixPath } = {}) {
  root = path.resolve(root);
  const packages = loadWorkspace(root);
  if (packages.length === 0) {
    throw new Error(
      `no workspace packages found under ${root} (expected apps/*, modules/*, packages/*)`,
    );
  }
  const matrix = loadMatrix(matrixPath);
  const byName = new Map(packages.map((p) => [p.name, p]));
  const violations = [];
  const notes = [];
  const edges = [];
  const rel = (abs) => toPosix(path.relative(root, abs));
  const violate = (rule, file, line, message, extra = {}) =>
    violations.push({ rule, file, line, message, ...extra });

  // ---- Package-level rules -------------------------------------------------------------------
  for (const pkg of packages) {
    const manifestFile = rel(pkg.manifestPath);
    if (pkg.layer === undefined) {
      violate(
        'workspace/unclassified-package',
        manifestFile,
        1,
        `${pkg.name} is under packages/ but has no declared responsibility, so no dependency policy applies.`,
        { hint: 'Add it to the layer policy via an ADR; do not guess its permissions.' },
      );
    }
    for (const pattern of pkg.unsupportedPatterns) {
      violate(
        'package/unsupported-exports-pattern',
        manifestFile,
        1,
        `${pkg.name} exports pattern "${pattern}" cannot be analysed.`,
        { hint: 'Use exact subpath exports so the boundary can be enforced.' },
      );
    }
    if (pkg.layer === 'module') {
      const publicDir = path.join(pkg.dir, 'src', 'public') + path.sep;
      for (const file of pkg.entryFiles) {
        if (!file.startsWith(publicDir)) {
          violate(
            'package/entrypoint-location',
            manifestFile,
            1,
            `${pkg.name} publishes ${rel(file)}, which is outside src/public/.`,
            { hint: 'Module entrypoints must live in src/public/ (AGENTS.md section 5).' },
          );
        }
      }
    }
    if (pkg.layer === 'kernel') {
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(pkg.manifest[field] ?? {})) {
          if (dep.startsWith('@sdris/') || KERNEL_FORBIDDEN_EXTERNALS.some((re) => re.test(dep))) {
            violate(
              'dependency/manifest',
              manifestFile,
              1,
              `Shared Kernel must not declare ${field}.${dep}.`,
              { from: pkg.name, to: dep },
            );
          }
        }
      }
    }
  }

  // ---- Import-level rules --------------------------------------------------------------------
  let filesScanned = 0;
  for (const pkg of packages) {
    for (const file of listSourceFiles(pkg)) {
      filesScanned += 1;
      const { imports, unanalyzable } = extractImports(readFileSync(file, 'utf8'), file);
      for (const u of unanalyzable) {
        notes.push({
          file: rel(file),
          line: u.line,
          message: `Non-literal ${u.kind} cannot be analysed.`,
        });
      }
      for (const imp of imports) {
        const ctx = { pkg, file, imp, root };
        const target = classify(ctx, packages, byName);
        if (target.external) {
          if (
            pkg.layer === 'kernel' &&
            KERNEL_FORBIDDEN_EXTERNALS.some((re) => re.test(imp.specifier))
          ) {
            violate(
              'dependency/forbidden-external',
              rel(file),
              imp.line,
              `Shared Kernel must stay framework-independent; it imports "${imp.specifier}".`,
              { specifier: imp.specifier, from: pkg.name },
            );
          }
          continue;
        }
        if (target.problem) {
          violate(target.problem.rule, rel(file), imp.line, target.problem.message, {
            specifier: imp.specifier,
            from: pkg.name,
            to: target.owner?.name,
            hint: target.problem.hint,
          });
          if (target.owner) edges.push(edge(pkg, target.owner, file, imp, rel));
          continue;
        }
        if (target.owner === pkg) continue;
        edges.push(edge(pkg, target.owner, file, imp, rel));
        const denial = directionDenial(pkg, target.owner, isTestFile(file), matrix);
        if (denial) {
          violate('dependency/direction', rel(file), imp.line, denial, {
            specifier: imp.specifier,
            from: pkg.name,
            to: target.owner.name,
            hint:
              pkg.layer === 'module' && target.owner.layer === 'module'
                ? 'Module-to-module dependencies need an approved entry in the dependency matrix (via ADR).'
                : undefined,
          });
        }
      }
    }
  }

  // ---- Cross-package cycles ------------------------------------------------------------------
  for (const cycle of findCycles(edges)) {
    const first = cycle.edges[0];
    const kind = cycle.edges.every((e) => e.typeOnly) ? ' (type-only)' : '';
    violate(
      'cycle/cross-package',
      first.file,
      first.line,
      `Dependency cycle${kind}: ${[...cycle.members, cycle.members[0]].join(' -> ')}`,
      {
        from: first.from,
        to: first.to,
        hint: cycle.edges.map((e) => `${e.from} -> ${e.to} at ${e.file}:${e.line}`).join('; '),
      },
    );
  }

  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return {
    violations,
    notes,
    stats: { packages: packages.length, files: filesScanned, imports: edges.length },
  };
}

const edge = (pkg, owner, file, imp, rel) => ({
  from: pkg.name,
  to: owner.name,
  file: rel(file),
  line: imp.line,
  typeOnly: imp.typeOnly,
});

/**
 * Works out what an import specifier points at. Aliases are resolved through tsconfig `paths`,
 * relative imports by path, and `@sdris/*` names through the workspace; classification is always
 * by the resolved owning package and target file, never by looking for the word "public".
 */
function classify({ pkg, file, imp, root }, packages, byName) {
  const { specifier } = imp;
  let abs = resolveAlias(specifier, file, root);
  let via = abs === undefined ? undefined : 'alias';

  if (abs === undefined && (specifier.startsWith('.') || path.isAbsolute(specifier))) {
    abs = path.resolve(path.dirname(file), specifier);
    via = 'relative';
  }

  if (abs === undefined) {
    if (!specifier.startsWith('@sdris/')) return { external: true };
    const [scope, name, ...rest] = specifier.split('/');
    const owner = byName.get(`${scope}/${name}`);
    if (!owner) {
      return {
        problem: {
          rule: 'boundary/unknown-workspace-package',
          message: `"${specifier}" is not a workspace package.`,
        },
      };
    }
    const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`;
    if (owner !== pkg && !owner.entries.has(subpath)) {
      return {
        owner,
        problem: {
          rule: 'boundary/private-import',
          message: `"${specifier}" reaches into ${owner.name}, which does not publish "${subpath}".`,
          hint: `Import from "${owner.name}" or an exported subpath instead.`,
        },
      };
    }
    return { owner };
  }

  const owner = ownerOf(packages, abs);
  if (!owner) {
    return {
      problem: {
        rule: 'boundary/outside-workspace',
        message: `Import resolves outside any workspace package (${toPosix(path.relative(root, abs))}).`,
      },
    };
  }
  if (owner === pkg) return { owner };

  // Compare the one file the import actually resolves to. An unresolvable target is not published.
  const resolvedFile = resolveFile(abs);
  const isEntry = resolvedFile !== undefined && owner.entryFiles.has(resolvedFile);
  const shown = toPosix(path.relative(root, resolvedFile ?? abs));
  if (!isEntry) {
    return {
      owner,
      problem: {
        rule: 'boundary/private-import',
        message: `${via === 'alias' ? 'Alias' : 'Relative'} import "${specifier}" reaches ${owner.name} internals (${shown}).`,
        hint: `Import from the published entrypoint "${owner.name}" instead.`,
      },
    };
  }
  if (via === 'relative') {
    return {
      owner,
      problem: {
        rule: 'boundary/package-specifier-required',
        message: `Relative import "${specifier}" crosses into ${owner.name}; cross-package imports must use the package name.`,
        hint: `Use "${owner.name}".`,
      },
    };
  }
  return { owner };
}

function directionDenial(from, to, testFile, matrix) {
  if (from.layer === undefined || to.layer === undefined) return undefined; // reported elsewhere
  if (from.layer === 'module' && to.layer === 'module') {
    return (matrix[from.name] ?? []).includes(to.name)
      ? undefined
      : `${from.name} may not depend on ${to.name}: no approved module-to-module dependency.`;
  }
  if (ALLOWED_LAYERS[from.layer].includes(to.layer)) return undefined;
  if (testFile && (TEST_ONLY_TARGETS[from.layer] ?? []).includes(to.layer)) return undefined;
  return `A ${from.layer} (${from.name}) may not depend on a ${to.layer} (${to.name}).`;
}

/** Tarjan's algorithm over package-level edges; returns strongly connected components > 1. */
function findCycles(edges) {
  const graph = new Map();
  for (const e of edges) {
    if (!graph.has(e.from)) graph.set(e.from, new Set());
    graph.get(e.from).add(e.to);
    if (!graph.has(e.to)) graph.set(e.to, new Set());
  }
  let index = 0;
  const stack = [];
  const info = new Map();
  const components = [];
  const connect = (v) => {
    info.set(v, { index, low: index, onStack: true });
    index += 1;
    stack.push(v);
    for (const w of graph.get(v)) {
      if (!info.has(w)) {
        connect(w);
        info.get(v).low = Math.min(info.get(v).low, info.get(w).low);
      } else if (info.get(w).onStack) {
        info.get(v).low = Math.min(info.get(v).low, info.get(w).index);
      }
    }
    if (info.get(v).low === info.get(v).index) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        info.get(w).onStack = false;
        component.push(w);
      } while (w !== v);
      if (component.length > 1) components.push(component.sort());
    }
  };
  for (const v of [...graph.keys()].sort()) if (!info.has(v)) connect(v);
  return components.map((members) => ({
    members,
    edges: edges
      .filter((e) => members.includes(e.from) && members.includes(e.to))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  }));
}
