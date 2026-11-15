import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extractImports } from './imports.mjs';
import { resolveAlias, resolveFile } from './resolve.mjs';
import {
  isTestFile,
  listSourceFiles,
  loadWorkspace,
  ownerOf,
  toPosix,
  zoneOf,
} from './workspace.mjs';

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
  // Infrastructure adapters (PROPOSED, S0-04): may use only the framework-free layers. Adapters that
  // implement a module's port need a decision on infrastructure -> module/public; denied until then.
  infrastructure: ['kernel', 'contracts', 'config'],
  app: ['module', 'kernel', 'contracts', 'config', 'infrastructure'],
};
const TEST_ONLY_TARGETS = { module: ['testing'], app: ['testing'] };

/** ORMs, query builders and database drivers: allowed only in infrastructure packages and apps. */
const PERSISTENCE_EXTERNALS = [
  /^(typeorm|prisma|pg|pg-promise|postgres|slonik|knex|kysely|sequelize|mongoose|mysql2)(\/|$)/,
  /^drizzle-(orm|kit)(\/|$)/,
  /^@prisma\//,
  /^@mikro-orm\//,
];
const KERNEL_FORBIDDEN_EXTERNALS = [
  /^@nestjs\//,
  /^next(\/|$)/,
  /^react(-dom)?(\/|$)/,
  ...PERSISTENCE_EXTERNALS,
];
/** Layers that hold domain logic or public contracts and so must stay persistence-independent. */
const PERSISTENCE_FREE_LAYERS = new Set(['kernel', 'contracts', 'config', 'module', 'testing']);

/** Zones of a module package in which persistence libraries may be used (Context Infrastructure). */
const CONTEXT_INFRASTRUCTURE_ZONE = 'infrastructure';

const npmPackageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const isPersistenceExternal = (specifier) => PERSISTENCE_EXTERNALS.some((re) => re.test(specifier));

/**
 * The centralised, explicit dependency policy file (PROPOSED). `moduleDependencies` lists approved
 * module-to-module edges. `contextInfrastructure` lists, per module, the Global Infrastructure workspace
 * packages and the persistence npm packages that module's `src/infrastructure/**` may use. Everything
 * not listed is denied. Source-path restrictions (zones) always apply on top of the list.
 */
function loadPolicy(matrixPath) {
  if (!matrixPath || !existsSync(matrixPath))
    return { moduleDependencies: {}, contextInfrastructure: {} };
  const raw = JSON.parse(readFileSync(matrixPath, 'utf8'));
  return {
    moduleDependencies: raw.moduleDependencies ?? {},
    contextInfrastructure: raw.contextInfrastructure ?? {},
  };
}

/** Rejects a malformed allowlist so a typo cannot silently grant or deny access. Throws (exit 2). */
function validatePolicy(policy, packages) {
  const fail = (message) => {
    throw new Error(`invalid dependency policy: ${message}`);
  };
  const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  for (const [name, entry] of Object.entries(policy.contextInfrastructure)) {
    const owner = packages.find((p) => p.name === name);
    if (!owner || owner.layer !== 'module')
      fail(`contextInfrastructure key "${name}" is not a module package`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      fail(`contextInfrastructure["${name}"] must be an object`);
    for (const key of Object.keys(entry)) {
      if (key !== 'workspacePackages' && key !== 'externalPackages')
        fail(`contextInfrastructure["${name}"] has unknown property "${key}"`);
      if (!isStringArray(entry[key]))
        fail(`contextInfrastructure["${name}"].${key} must be a string array`);
    }
    for (const dep of entry.workspacePackages ?? []) {
      const target = packages.find((p) => p.name === dep);
      if (!target || target.layer !== 'infrastructure')
        fail(
          `"${dep}" (allowed for ${name}) is not a Global Infrastructure package under infrastructure/*`,
        );
    }
    for (const dep of entry.externalPackages ?? []) {
      if (!isPersistenceExternal(dep))
        fail(
          `"${dep}" (allowed for ${name}) is not a recognised persistence package; nothing to allow`,
        );
    }
  }
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
      `no workspace packages found under ${root} (expected apps/*, modules/*, packages/*, infrastructure/*)`,
    );
  }
  const policy = loadPolicy(matrixPath);
  validatePolicy(policy, packages);
  const matrix = policy.moduleDependencies;
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
    if (PERSISTENCE_FREE_LAYERS.has(pkg.layer)) {
      const forbidden = pkg.layer === 'kernel' ? KERNEL_FORBIDDEN_EXTERNALS : PERSISTENCE_EXTERNALS;
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(pkg.manifest[field] ?? {})) {
          const internal = pkg.layer === 'kernel' && dep.startsWith('@sdris/');
          const allowlisted =
            pkg.layer === 'module' &&
            (policy.contextInfrastructure[pkg.name]?.externalPackages ?? []).includes(dep);
          if (!allowlisted && (internal || forbidden.some((re) => re.test(dep)))) {
            violate(
              'dependency/manifest',
              manifestFile,
              1,
              pkg.layer === 'kernel'
                ? `Shared Kernel must not declare ${field}.${dep}.`
                : `${pkg.name} (${pkg.layer}) must stay persistence-independent; it declares ${field}.${dep}.`,
              {
                from: pkg.name,
                to: dep,
                hint:
                  pkg.layer === 'module'
                    ? 'Add it to contextInfrastructure in the dependency policy (needs an ADR); do not edit around the check.'
                    : undefined,
              },
            );
          }
          const depPackage = byName.get(dep);
          if (
            pkg.layer === 'module' &&
            depPackage?.layer === 'infrastructure' &&
            !(policy.contextInfrastructure[pkg.name]?.workspacePackages ?? []).includes(dep)
          ) {
            violate(
              'dependency/manifest',
              manifestFile,
              1,
              `${pkg.name} declares ${field}.${dep} (Global Infrastructure) but is not in the context-infrastructure allowlist.`,
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
          } else if (
            pkg.layer !== 'kernel' &&
            PERSISTENCE_FREE_LAYERS.has(pkg.layer) &&
            isPersistenceExternal(imp.specifier)
          ) {
            const zone = pkg.layer === 'module' ? zoneOf(pkg, file) : undefined;
            const allowed =
              zone === CONTEXT_INFRASTRUCTURE_ZONE &&
              (policy.contextInfrastructure[pkg.name]?.externalPackages ?? []).includes(
                npmPackageName(imp.specifier),
              );
            if (!allowed) {
              violate(
                'dependency/forbidden-external',
                rel(file),
                imp.line,
                pkg.layer === 'module'
                  ? `${pkg.name} may use "${imp.specifier}" only from src/infrastructure/** and only if allowlisted; this file is in zone "${zone}"${zone === CONTEXT_INFRASTRUCTURE_ZONE ? ' and the package is not allowlisted' : ''}.`
                  : `${pkg.name} (${pkg.layer}) must stay persistence-independent; it imports "${imp.specifier}".`,
                {
                  specifier: imp.specifier,
                  from: pkg.name,
                  hint: 'ORM, query-builder and driver code belongs in Context Infrastructure (modules/<context>/src/infrastructure/**, allowlisted) or Global Infrastructure (infrastructure/*), behind a port.',
                },
              );
            }
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
        if (target.owner === pkg) {
          if (pkg.layer === 'module' && target.resolvedFile !== undefined) {
            const from = zoneOf(pkg, file);
            if (
              from !== CONTEXT_INFRASTRUCTURE_ZONE &&
              zoneOf(pkg, target.resolvedFile, { ignoreCase: true }) === CONTEXT_INFRASTRUCTURE_ZONE
            ) {
              violate(
                'boundary/infrastructure-inversion',
                rel(file),
                imp.line,
                `${from === 'other' ? 'Code outside the named zones' : from + ' code'} in ${pkg.name} imports its own Context Infrastructure (${rel(target.resolvedFile)}); dependencies must point inward.`,
                {
                  specifier: imp.specifier,
                  from: pkg.name,
                  hint: 'Only src/infrastructure/** may import it. Depend on a port in src/application and let the adapter implement it; a barrel elsewhere cannot re-export infrastructure.',
                },
              );
            }
          }
          continue;
        }
        edges.push(edge(pkg, target.owner, file, imp, rel));
        const denial = directionDenial(
          pkg,
          target.owner,
          isTestFile(file),
          matrix,
          policy,
          zoneOf(pkg, file),
        );
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
  if (owner === pkg) return { owner, resolvedFile: resolveFile(abs) ?? abs };

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

function directionDenial(from, to, testFile, matrix, policy, zone) {
  if (from.layer === undefined || to.layer === undefined) return undefined; // reported elsewhere
  if (from.layer === 'module' && to.layer === 'infrastructure') {
    // Context Infrastructure only: a source-path restriction plus the explicit allowlist.
    if (zone !== CONTEXT_INFRASTRUCTURE_ZONE) {
      return `${from.name} code outside src/infrastructure/** (zone "${zone}") may not depend on Global Infrastructure (${to.name}).`;
    }
    return (policy.contextInfrastructure[from.name]?.workspacePackages ?? []).includes(to.name)
      ? undefined
      : `${to.name} (Global Infrastructure) is not in the context-infrastructure allowlist for ${from.name}.`;
  }
  if (from.layer === 'infrastructure' && to.layer === 'module') {
    return `Global Infrastructure (${from.name}) may not import business module ${to.name}; there is no default exception.`;
  }
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
