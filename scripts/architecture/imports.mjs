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
