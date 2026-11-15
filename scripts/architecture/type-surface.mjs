import path from 'node:path';
import ts from 'typescript';

/**
 * Public API type-surface verification for a module entrypoint.
 *
 * The lexical import rules cannot see a leak that happens through types alone (a factory whose return type
 * is a concrete adapter class, a parameter typed with a Drizzle database, an inferred return type that
 * drags a private class in). This module asks the TypeScript compiler instead:
 *
 *  1. Type graph: every exported symbol's type is walked (members, call and construct signatures,
 *     parameters, return types, type arguments, base types, constraints, index signatures). A declaration
 *     found in a forbidden file is a leak.
 *  2. Declaration emit: the entrypoint's `.d.ts` is really generated, and its import specifiers are checked.
 *  3. Explicit return types: every exported function declares its return type, so the contract is written
 *     down rather than inferred from whatever the body happens to return.
 *
 * Forbidden: the module's own `src/infrastructure/**`, ORM and driver packages, and any symbol from the
 * database package other than the explicitly approved opaque contracts.
 */

const PERSISTENCE_PACKAGE_DIRS = [
  '/node_modules/drizzle-orm/',
  '/node_modules/drizzle-kit/',
  '/node_modules/pg/',
  '/node_modules/pg-pool/',
  '/node_modules/pg-types/',
  '/node_modules/@types/pg/',
  '/node_modules/kysely/',
  '/node_modules/postgres/',
];
const PERSISTENCE_SPECIFIER =
  /^(drizzle-(orm|kit)|pg|pg-pool|kysely|postgres|typeorm|prisma|knex)(\/|$)/;

const posix = (p) => p.split(path.sep).join('/');

/**
 * @param {{ infrastructureDirs: string[], databaseDirs: string[], approvedDatabaseTypes: string[] }} policy
 * Returns a classifier: (fileName, symbolName) => reason | undefined.
 */
function makeClassifier(policy) {
  const infra = policy.infrastructureDirs.map((d) => posix(d).replace(/\/?$/, '/'));
  const db = policy.databaseDirs.map((d) => posix(d).replace(/\/?$/, '/'));
  const approved = new Set(policy.approvedDatabaseTypes);
  return (fileName, symbolName) => {
    const f = posix(fileName);
    if (infra.some((dir) => f.includes(dir))) return 'Context Infrastructure';
    if (PERSISTENCE_PACKAGE_DIRS.some((dir) => f.includes(dir))) return 'ORM or database driver';
    if (db.some((dir) => f.includes(dir)) && !approved.has(symbolName)) {
      return 'database package (not an approved contract)';
    }
    return undefined;
  };
}

export function createSurfaceProgram(rootNames, options) {
  return ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      ...options,
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
    },
  });
}

const isLibraryFile = (program, sf) =>
  program.isSourceFileDefaultLibrary(sf) ||
  /\/node_modules\/@types\/node\//.test(posix(sf.fileName));

/** Walks one type graph and records declarations that live in forbidden files. */
function walkType(root, rootLabel, ctx) {
  const { checker, program, classify, leaks } = ctx;
  const seen = new Set();
  const budget = { nodes: 0 };

  const record = (symbol, declaration, trail, reason) => {
    const file = declaration.getSourceFile().fileName;
    leaks.push({ symbol: symbol.name, file, reason, trail: trail.join(' -> ') });
  };

  const visit = (type, trail, depth) => {
    if (!type || seen.has(type) || depth > 14 || budget.nodes++ > 20000) return;
    seen.add(type);

    const symbol = type.aliasSymbol ?? type.getSymbol();
    let walkMembers = true;
    if (symbol?.declarations?.length) {
      let forbidden = false;
      for (const declaration of symbol.declarations) {
        const sf = declaration.getSourceFile();
        const reason = classify(sf.fileName, symbol.name);
        if (reason) {
          record(symbol, declaration, trail, reason);
          forbidden = true;
          break;
        }
      }
      if (forbidden) return; // already a leak; do not report everything beneath it
      walkMembers = !symbol.declarations.every((d) => isLibraryFile(program, d.getSourceFile()));
    }

    const next = (t, step) => visit(t, [...trail, step], depth + 1);

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) next(member, 'member');
      return;
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      next(type.getConstraint?.(), `constraint of ${type.symbol?.name ?? 'T'}`);
      next(type.getDefault?.(), `default of ${type.symbol?.name ?? 'T'}`);
    }
    if (type.flags & ts.TypeFlags.Index) next(type.type, 'keyof');
    if (type.flags & ts.TypeFlags.IndexedAccess) {
      next(type.objectType, 'indexed object');
      next(type.indexType, 'indexed key');
    }
    if (type.flags & ts.TypeFlags.Conditional) {
      next(type.checkType, 'conditional check');
      next(type.extendsType, 'conditional extends');
    }

    if (!(type.flags & ts.TypeFlags.Object)) return;
    if (type.objectFlags & ts.ObjectFlags.Reference) {
      for (const arg of checker.getTypeArguments(type)) next(arg, 'type argument');
    }
    if (!walkMembers) return;

    for (const base of type.getBaseTypes?.() ?? []) next(base, 'extends');
    for (const property of checker.getPropertiesOfType(type)) {
      next(checker.getTypeOfSymbolAtLocation(property, ctx.location), `.${property.name}`);
    }
    for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
      for (const signature of checker.getSignaturesOfType(type, kind)) {
        for (const parameter of signature.getParameters()) {
          next(
            checker.getTypeOfSymbolAtLocation(parameter, ctx.location),
            `parameter ${parameter.name}`,
          );
        }
        next(signature.getReturnType(), 'return type');
        for (const typeParameter of signature.typeParameters ?? [])
          next(typeParameter, 'type parameter');
      }
    }
    for (const info of checker.getIndexInfosOfType(type)) {
      next(info.type, 'index signature');
      next(info.keyType, 'index key');
    }
  };

  visit(root, [rootLabel], 0);
}

/** Exported functions must write their return type down. */
function explicitReturnTypeProblems(exportName, symbol) {
  const problems = [];
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isFunctionDeclaration(declaration) && declaration.type === undefined) {
      problems.push(exportName);
    } else if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer)) &&
      declaration.initializer.type === undefined &&
      declaration.type === undefined
    ) {
      problems.push(exportName);
    }
  }
  return problems;
}

/** Specifiers named by a generated declaration file, with the names imported through each. */
function declarationReferences(text) {
  const refs = [];
  for (const m of text.matchAll(
    /(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    const names = [...m[2].matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?/g)].map(
      (n) => n[1],
    );
    refs.push({ specifier: m[3], names: names.filter((n) => n !== 'type') });
  }
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)(?:\.([A-Za-z_$][\w$]*))?/g)) {
    refs.push({ specifier: m[1], names: m[2] ? [m[2]] : [] });
  }
  return refs;
}

function declarationLeaks(text, fileName, policy, approvedNames) {
  const leaks = [];
  const infra = policy.infrastructureDirs.map((d) => posix(d).replace(/\/?$/, '/'));
  for (const { specifier, names } of declarationReferences(text)) {
    if (specifier.startsWith('.')) {
      const resolved = posix(path.resolve(path.dirname(fileName), specifier)) + '/';
      if (infra.some((dir) => resolved.startsWith(dir) || resolved.includes(dir))) {
        leaks.push(`"${specifier}" resolves into Context Infrastructure`);
      }
    } else if (PERSISTENCE_SPECIFIER.test(specifier)) {
      leaks.push(`"${specifier}" is an ORM or database driver`);
    } else if ((policy.databaseSpecifiers ?? []).includes(specifier)) {
      const unapproved = names.filter((n) => !approvedNames.has(n));
      if (names.length === 0 || unapproved.length > 0) {
        leaks.push(
          `"${specifier}" is referenced with ${names.length === 0 ? 'an unnamed or namespace import' : unapproved.join(', ')}, which is not an approved contract`,
        );
      }
    }
  }
  return leaks;
}

/**
 * Analyses one entrypoint.
 * @param {ts.Program} program
 * @param {string} entryFile absolute path
 * @param {{ infrastructureDirs: string[], databaseDirs: string[], databaseSpecifiers?: string[],
 *           approvedDatabaseTypes: string[], requireExplicitReturnTypes?: boolean }} policy
 * @returns {{ leaks: object[], missingReturnTypes: string[], declarationText: string|undefined, declarationLeaks: string[], exports: string[] }}
 */
export function analyzeEntrypoint(program, entryFile, policy) {
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`entrypoint is not part of the program: ${entryFile}`);
  const checker = program.getTypeChecker();
  const classify = makeClassifier(policy);
  const leaks = [];
  const missingReturnTypes = [];
  const ctx = { checker, program, classify, leaks, location: sf };

  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const exportedNames = [];
  for (let symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
    const exportName = symbol.name;
    exportedNames.push(exportName);
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);

    // The exported symbol itself may be forbidden (for example `export { DrizzleRepo }`).
    for (const declaration of symbol.declarations ?? []) {
      const reason = classify(declaration.getSourceFile().fileName, symbol.name);
      if (reason) {
        leaks.push({
          symbol: symbol.name,
          file: declaration.getSourceFile().fileName,
          reason,
          trail: `export ${exportName}`,
        });
      }
    }
    if (policy.requireExplicitReturnTypes !== false) {
      missingReturnTypes.push(...explicitReturnTypeProblems(exportName, symbol));
    }
    if (
      symbol.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Class |
        ts.SymbolFlags.Enum)
    ) {
      walkType(checker.getDeclaredTypeOfSymbol(symbol), `export ${exportName}`, ctx);
    }
    if (symbol.flags & ts.SymbolFlags.Value) {
      walkType(checker.getTypeOfSymbolAtLocation(symbol, sf), `export ${exportName}`, ctx);
    }
  }

  // Declaration emit: what a consumer's compiler would actually read.
  let declarationText;
  program.emit(
    sf,
    (name, text) => {
      if (name.endsWith('.d.ts')) declarationText = text;
    },
    undefined,
    true,
  );
  const approvedNames = new Set(policy.approvedDatabaseTypes);
  const dtsLeaks =
    declarationText === undefined
      ? []
      : declarationLeaks(declarationText, entryFile, policy, approvedNames);

  // De-duplicate identical leaks reached by several routes.
  const unique = new Map(leaks.map((l) => [`${l.symbol}|${l.file}|${l.trail}`, l]));
  return {
    leaks: [...unique.values()],
    missingReturnTypes,
    declarationText,
    declarationLeaks: dtsLeaks,
    exports: exportedNames,
  };
}
