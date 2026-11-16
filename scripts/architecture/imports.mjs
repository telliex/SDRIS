import ts from 'typescript';

/**
 * Extracts every module reference from a source file using the TypeScript parser (not regexes), so
 * comments and strings never produce false positives.
 *
 * Covered: import declarations, re-exports (`export ... from`), `import x = require()`,
 * `require()` and dynamic `import()` with a literal argument, and `import('x').T` type nodes.
 * Not analyzable: dynamic `import()`/`require()` whose argument is not a string literal.
 */
export function extractImports(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
  const imports = [];
  const unanalyzable = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const add = (node, specifier, kind, typeOnly) =>
    imports.push({ specifier, kind, typeOnly, line: lineOf(node) });

  const allTypeOnly = (elements) => elements.length > 0 && elements.every((e) => e.isTypeOnly);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            allTypeOnly(clause.namedBindings.elements)));
      add(node, node.moduleSpecifier.text, 'import', typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause !== undefined &&
          ts.isNamedExports(node.exportClause) &&
          allTypeOnly(node.exportClause.elements));
      add(node, node.moduleSpecifier.text, 're-export', typeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node, node.moduleReference.expression.text, 'import-equals', node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const arg = node.arguments[0];
      if ((dynamic || isRequire) && arg !== undefined) {
        if (ts.isStringLiteralLike(arg)) {
          add(node, arg.text, dynamic ? 'dynamic-import' : 'require', false);
        } else {
          unanalyzable.push({ line: lineOf(node), kind: dynamic ? 'dynamic-import' : 'require' });
        }
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node, node.argument.literal.text, 'import-type', true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, unanalyzable };
}

/**
 * Finds names that a file imports and then exports without a module specifier, such as
 * `import { Adapter } from '../infrastructure/a'; export { Adapter };` or `export default Adapter`.
 * `extractImports` cannot see these because the export statement has no `from` clause, yet they expose
 * the imported binding exactly like `export { Adapter } from '../infrastructure/a'` does.
 * Returns `{ specifier, name, line }` for each such name.
 */
export function extractLocalReexports(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
  const bindings = new Map(); // local name -> module specifier
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (!clause) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name) bindings.set(clause.name.text, specifier);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, specifier);
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) bindings.set(element.name.text, specifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      bindings.set(statement.name.text, statement.moduleReference.expression.text);
    }
  }

  const found = [];
  for (const statement of sf.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (bindings.has(local)) {
          found.push({ specifier: bindings.get(local), name: local, line: lineOf(element) });
        }
      }
    } else if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression) &&
      bindings.has(statement.expression.text)
    ) {
      found.push({
        specifier: bindings.get(statement.expression.text),
        name: statement.expression.text,
        line: lineOf(statement),
      });
    }
  }
  return found;
}
